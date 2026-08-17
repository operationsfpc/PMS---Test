import { academicStandingFrom, type SemesterRecord } from "@domain/academics";
import type { DriveReadiness } from "@domain/drive-lifecycle";
import type { EligibilityCriteria } from "@domain/eligibility";
import type { Offer } from "@domain/offers";
import type { AcademicProfile, DriveStatus, DriveType, RoleCategory } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PublishCandidate,
  PublishDrive,
  PublishInput,
  PublishView,
  TargetingOptions,
} from "./daf-publish";
import { createSupabasePublishRepository, type GetActorId } from "./publish-repository";

/** PostgREST returns an embedded to-one relation as an object; the types say array. */
const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

const name = (value: unknown): string => one<{ name: string }>(value)?.name ?? "";

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const PUBLISH_DRIVE_COLUMNS = `
  id, company_name, role_title, role_category, job_description, work_locations,
  status, drive_type, offer_category, ctc_min_lpa, ctc_max_lpa,
  application_start, application_end, on_hold,
  min_overall_cgpa, min_overall_marks, min_overall_cgpa_scale,
  min_tenth_percentage, min_twelfth_percentage,
  arrears_policy, round_count,
  drive_rounds(id, sequence, name),
  drive_eligible_degrees(degrees(name)),
  drive_eligible_branches(branches(name)),
  drive_target_campuses(campuses(name, cities(name)))
`;

/** Exported so src/db/query-contract.test.ts can prove it against the real schema. */
export const PUBLISH_COHORT_COLUMNS = `
  id, full_name, srf_status, participation_status, passing_year,
  overall_cgpa, tenth_percentage, twelfth_percentage,
  current_arrears, history_of_arrears,
  degrees(name), branches(name), campuses(name, cities(name)),
  offers(id, drive_id, drive_type, offer_category, ctc_lpa, declared_at, source),
  student_role_preferences(category),
  student_semesters(semester_number, cgpa, current_arrears, history_of_arrears, status)
`;

/** Names out of an embedded link table, e.g. drive_eligible_degrees(degrees(name)). */
function linkedNames(rows: unknown, key: string): readonly string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => one<{ name?: string }>((row as Record<string, unknown>)[key])?.name)
    .filter((value): value is string => typeof value === "string" && value !== "");
}

/** A targeted campus carries its city, which is how R2 matches cities. */
function targetedCities(rows: unknown): readonly string[] {
  if (!Array.isArray(rows)) return [];
  return [
    ...new Set(
      rows
        .map(
          (row) =>
            one<{ name?: string }>(
              one<{ cities?: unknown }>((row as Record<string, unknown>).campuses)?.cities,
            )?.name,
        )
        .filter((value): value is string => typeof value === "string" && value !== ""),
    ),
  ];
}

function ctcLabel(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  return max === null ? `₹${min} LPA` : `₹${min}–${max} LPA`;
}

/** Everything under the drive title, assembled from what is actually set. */
function subtitleFor(row: Record<string, unknown>): string {
  return [
    row.role_title as string | null,
    (row.offer_category as string | null)?.replaceAll("_", " "),
    ctcLabel(row.ctc_min_lpa as number | null, row.ctc_max_lpa as number | null),
    (row.drive_type as string | null)?.replaceAll("_", " "),
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
}

function toCandidate(row: Record<string, unknown>): PublishCandidate {
  /**
   * §7.2: eligibility is judged on the LATEST VERIFIED SEMESTER, and the
   * student's own drive list has judged it that way since 0031. This screen
   * read `students.overall_cgpa` instead - a column the registration form
   * DELIBERATELY never writes, because an overall CGPA is not the student's to
   * declare. It is null for every real student, `?? 0` made that a CGPA of
   * zero, and so every cutoff excluded the entire roster: the coordinator was
   * told nobody matched, about students who plainly qualified.
   *
   * The roster figures stay as the fallback, exactly as in the student's view:
   * locking out a cohort nobody has verified yet is a worse answer than the
   * number the coordinator imported.
   */
  const semesters = ((row.student_semesters ?? []) as Array<Record<string, unknown>>).map(
    (s): SemesterRecord => ({
      semesterNumber: Number(s.semester_number),
      cgpa: Number(s.cgpa),
      currentArrears: Number(s.current_arrears ?? 0),
      historyOfArrears: Number(s.history_of_arrears ?? 0),
      verified: s.status === "verified",
    }),
  );

  const standing = academicStandingFrom(semesters);

  const academics: AcademicProfile = {
    degree: name(row.degrees),
    branch: name(row.branches),
    passingYear: (row.passing_year as number | null) ?? 0,
    overallCgpa: standing?.cgpa ?? Number(row.overall_cgpa ?? 0),
    tenthPercentage: (row.tenth_percentage as number | null) ?? 0,
    twelfthPercentage: (row.twelfth_percentage as number | null) ?? 0,
    currentArrears: standing?.currentArrears ?? Number(row.current_arrears ?? 0),
    historyOfArrears: standing?.historyOfArrears ?? Number(row.history_of_arrears ?? 0),
    city: name(one<{ cities: unknown }>(row.campuses)?.cities),
    campus: name(row.campuses),
  };

  const offers = (Array.isArray(row.offers) ? row.offers : []) as Array<Record<string, unknown>>;

  return {
    id: row.id as string,
    name: row.full_name as string,
    srfStatus: row.srf_status as PublishCandidate["srfStatus"],
    // The audience a drive is published to is the audience that can apply, so
    // the area preference has to be counted here too - or the number on the
    // screen is a promise the apply gate will not keep.
    roleCategories: ((row.student_role_preferences ?? []) as Array<Record<string, unknown>>).map(
      (p) => p.category as RoleCategory,
    ),
    participationStatus: row.participation_status as PublishCandidate["participationStatus"],
    academics,
    offers: offers.map(
      (o): Offer => ({
        id: o.id as string,
        driveId: (o.drive_id as string | null) ?? "",
        driveType: o.drive_type as DriveType,
        offerCategory: (o.offer_category as Offer["offerCategory"]) ?? null,
        ctcLpa: Number(o.ctc_lpa ?? 0),
        declaredAt: new Date(o.declared_at as string),
        source: o.source as Offer["source"],
      }),
    ),
  };
}

/**
 * Feeds the publish screen, and takes the drive live.
 *
 * The screen used to run the domain rules over a hardcoded cohort of twelve
 * invented students and four hardcoded chip lists, so the audience number it
 * showed had nothing to do with the roster. Every input now comes from the
 * database; the rules that consume them are unchanged.
 *
 * Targeting is persisted BEFORE the status flips to live. Publishing is the
 * moment students can see a drive, so it must never become visible with the
 * targeting half-written.
 */
export function createSupabasePublishView(
  client: SupabaseClient,
  driveId: string,
  /**
   * Who is publishing. Defaults to the live session, and is injectable for the
   * same reason every other view here takes one: without it, the publish path
   * can only be exercised against a real browser session, which is precisely
   * the path most worth testing.
   */
  getActorId?: GetActorId,
): PublishView {
  const publishRepo = createSupabasePublishRepository(client, getActorId);

  async function loadDriveRow(): Promise<Record<string, unknown>> {
    const { data, error } = await client
      .from("drives")
      .select(PUBLISH_DRIVE_COLUMNS)
      .eq("id", driveId)
      .single();

    if (error !== null || !data) throw new Error("Could not load this drive.");
    return data as unknown as Record<string, unknown>;
  }

  return {
    async load() {
      const [row, cities, campuses, degrees, branches, students] = await Promise.all([
        loadDriveRow(),
        client.from("cities").select("name").order("name"),
        client.from("campuses").select("name").eq("is_active", true).order("name"),
        client.from("degrees").select("name").order("name"),
        client.from("branches").select("name").order("name"),
        client.from("students").select(PUBLISH_COHORT_COLUMNS),
      ]);

      const names = (result: { data: unknown }): readonly string[] => [
        ...new Set(
          ((result.data ?? []) as Array<{ name: string }>).map((r) => r.name).filter(Boolean),
        ),
      ];

      const options: TargetingOptions = {
        cities: names(cities),
        campuses: names(campuses),
        degrees: names(degrees),
        branches: names(branches),
      };

      const roundRows = (Array.isArray(row.drive_rounds) ? row.drive_rounds : []) as Array<
        Record<string, unknown>
      >;

      const drive: PublishDrive = {
        id: row.id as string,
        companyName: (row.company_name as string | null) ?? "Unnamed drive",
        roleTitle: (row.role_title as string | null) ?? null,
        subtitle: subtitleFor(row),
        status: (row.status as DriveStatus | null) ?? "draft",
        driveType: (row.drive_type as DriveType | null) ?? null,
        offerCategory: (row.offer_category as PublishDrive["offerCategory"]) ?? null,
        roleCategory: (row.role_category as RoleCategory | null) ?? null,
        jobDescription: (row.job_description as string | null) ?? "",
        locations:
          typeof row.work_locations === "string" && row.work_locations !== ""
            ? [row.work_locations]
            : [],
        ctcMinLpa: (row.ctc_min_lpa as number | null) ?? null,
        applicationStart:
          row.application_start === null ? null : new Date(row.application_start as string),
        applicationEnd:
          row.application_end === null ? null : new Date(row.application_end as string),
        onHold: Boolean(row.on_hold),
        // What the PIF declared and the Delivery Head approved. Fetched since
        // the select was written; thrown away by the screen until now.
        minOverallCgpa:
          row.min_overall_cgpa === null || row.min_overall_cgpa === undefined
            ? null
            : Number(row.min_overall_cgpa),
        // The school bars, seeded like the CGPA cutoff: fetching a value and
        // then opening the form on something else is exactly how two live
        // drives lost their declared 7.50 (P9).
        minTenthPercentage:
          row.min_tenth_percentage === null || row.min_tenth_percentage === undefined
            ? null
            : Number(row.min_tenth_percentage),
        minTwelfthPercentage:
          row.min_twelfth_percentage === null || row.min_twelfth_percentage === undefined
            ? null
            : Number(row.min_twelfth_percentage),
        arrearPolicy:
          (row.arrears_policy as EligibilityCriteria["arrearPolicy"] | null) ?? "flexible",
        targeting: {
          cities: targetedCities(row.drive_target_campuses),
          campuses: linkedNames(row.drive_target_campuses, "campuses"),
          degrees: linkedNames(row.drive_eligible_degrees, "degrees"),
          branches: linkedNames(row.drive_eligible_branches, "branches"),
        },
        // F11: the AE already told us. Reported, never imposed - the named
        // rounds below are the coordinator's own work and must not be
        // overwritten by a count.
        declaredRoundCount:
          row.round_count === null || row.round_count === undefined
            ? null
            : Number(row.round_count),
        rounds: roundRows
          .map((r) => ({ sequence: Number(r.sequence), name: r.name as string }))
          .sort((a, b) => a.sequence - b.sequence),
      };

      const cohort = ((students.data ?? []) as Array<Record<string, unknown>>).map(toCandidate);

      return { drive, options, cohort };
    },

    async publish(input: PublishInput) {
      // Names are what the coordinator picked; the link tables want ids.
      const idsFor = async (table: string, wanted: readonly string[]) => {
        if (wanted.length === 0) return [];
        const { data } = await client
          .from(table)
          .select("id, name")
          .in("name", [...wanted]);
        return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
      };

      const [campusIds, degreeIds, branchIds] = await Promise.all([
        idsFor("campuses", input.campuses),
        idsFor("degrees", input.degrees),
        idsFor("branches", input.branches),
      ]);

      // `datetime-local` has no zone. It is wall-clock time in the coordinator's
      // browser, which is Asia/Kolkata, and `new Date(...)` reads it as exactly
      // that before toISOString converts it to the UTC the column stores.
      const instant = (local: string | null) =>
        local === null || local === "" ? null : new Date(local).toISOString();

      const { error: updateError } = await client
        .from("drives")
        .update({
          min_overall_cgpa: input.minOverallCgpa,
          min_tenth_percentage: input.minTenthPercentage,
          min_twelfth_percentage: input.minTwelfthPercentage,
          arrears_policy: input.arrearPolicy,
          open_to_all_override: input.openToAllOverride,
          open_to_all_reason: input.overrideReason,
          application_start: instant(input.applicationStart),
          application_end: instant(input.applicationEnd),
        })
        .eq("id", input.driveId)
        .select("id")
        .single();

      if (updateError !== null) {
        throw new Error(
          updateError.code === "42501"
            ? "You do not have permission to publish this drive."
            : `Could not save the targeting: ${updateError.message}`,
        );
      }

      // Replace rather than merge: the screen shows the whole selection, so
      // what is on screen must be what ends up stored.
      await Promise.all([
        client.from("drive_target_campuses").delete().eq("drive_id", input.driveId),
        client.from("drive_eligible_degrees").delete().eq("drive_id", input.driveId),
        client.from("drive_eligible_branches").delete().eq("drive_id", input.driveId),
      ]);

      // Rounds are positional, so they are replaced wholesale rather than
      // reconciled - renumbering in place would collide with the (drive_id,
      // sequence) key half way through.
      await client.from("drive_rounds").delete().eq("drive_id", input.driveId);
      if (input.rounds.length > 0) {
        const { error: roundError } = await client.from("drive_rounds").insert(
          input.rounds.map((r) => ({
            drive_id: input.driveId,
            sequence: r.sequence,
            name: r.name,
          })),
        );
        if (roundError !== null) {
          throw new Error(`Could not save the rounds: ${roundError.message}`);
        }
      }

      await Promise.all([
        campusIds.length === 0
          ? null
          : client
              .from("drive_target_campuses")
              .insert(campusIds.map((id) => ({ drive_id: input.driveId, campus_id: id }))),
        degreeIds.length === 0
          ? null
          : client
              .from("drive_eligible_degrees")
              .insert(degreeIds.map((id) => ({ drive_id: input.driveId, degree_id: id }))),
        branchIds.length === 0
          ? null
          : client
              .from("drive_eligible_branches")
              .insert(branchIds.map((id) => ({ drive_id: input.driveId, branch_id: id }))),
      ]);

      const row = await loadDriveRow();
      const rounds = Array.isArray(row.drive_rounds) ? row.drive_rounds : [];

      const readiness: DriveReadiness = {
        companyName: (row.company_name as string | null) ?? "",
        roleTitle: (row.role_title as string | null) ?? "",
        roleCategory: (row.role_category as RoleCategory | null) ?? null,
        jobDescription: (row.job_description as string | null) ?? "",
        locations:
          typeof row.work_locations === "string" && row.work_locations !== ""
            ? [row.work_locations]
            : [],
        ctcMinLpa: (row.ctc_min_lpa as number | null) ?? null,
        driveType: (row.drive_type as DriveType | null) ?? null,
        offerCategory: (row.offer_category as DriveReadiness["offerCategory"]) ?? null,
        hasEligibilityCriteria: true,
        roundCount: rounds.length,
        applicationStart: (row.application_start as string | null) ?? null,
        applicationEnd: (row.application_end as string | null) ?? null,
        onHold: Boolean(row.on_hold),
      };

      await publishRepo.publish(
        input.driveId,
        (row.status as DriveStatus | null) ?? "draft",
        readiness,
      );
    },
  };
}
