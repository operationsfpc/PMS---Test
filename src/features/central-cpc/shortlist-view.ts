import type { ShortlistEntry } from "@domain/recruiter-export";
import { objectKeyIn } from "@domain/storage-path";
import { type AppRole, DRIVE_STATUSES, type DriveStatus, type RoleCategory } from "@domain/types";
import { readAllRows, readAllRowsByIds } from "@lib/postgrest-read";
import { signedResumeLinks } from "@lib/resume-links";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShortlistApplicant, ShortlistDrive, ShortlistView } from "./shortlist-page";

export class ShortlistError extends Error {}

const one = <T>(value: unknown): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/** A snapshot's text, or null. An empty string on a card is a label with
 *  nothing behind it, and "—" reads as a figure the student never gave. */
const text = (value: unknown): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
};

/**
 * A figure the snapshot actually carries.
 *
 * `0` is treated as "never recorded", not as a score of zero:
 * `AcademicProfile` cannot hold null, so a student whose 10th marksheet was
 * never entered applies with `0` frozen into their snapshot. A card that
 * prints "10th 0%" says they sat it and failed — a different accusation from
 * an exam the coordinator simply has no record of.
 */
const recorded = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Feeds the shortlisting workspace.
 *
 * Applicant data comes from the application SNAPSHOT (R7), never the live
 * student profile. A student who improved their CGPA after applying must not
 * be ranked on numbers the recruiter's criteria were never evaluated against.
 */
export function createSupabaseShortlistView(
  client: SupabaseClient,
  getActorId: () => Promise<string | null>,
  getActorRole: () => Promise<AppRole>,
): ShortlistView {
  return {
    async drive(driveId) {
      const { data } = await client
        .from("drives")
        .select("id, company_name, role_title, role_category, mandatory_skills, status")
        .eq("id", driveId)
        .single();

      const row = (data ?? {}) as Record<string, unknown>;
      const skills = row.mandatory_skills;
      const status = row.status;

      return {
        driveId,
        companyName: (row.company_name as string | null) ?? "This drive",
        roleTitle: (row.role_title as string | null) ?? null,
        roleCategory: (row.role_category as RoleCategory | null) ?? null,
        mandatorySkills: Array.isArray(skills)
          ? skills.map(String)
          : typeof skills === "string" && skills.trim() !== ""
            ? skills.split(",").map((s) => s.trim())
            : [],
        // A value outside the lifecycle is read as no status, not guessed into
        // one: the screen may then write, which is what it did before this
        // column was consulted at all.
        status: DRIVE_STATUSES.includes(status as DriveStatus) ? (status as DriveStatus) : null,
      } satisfies ShortlistDrive;
    },

    async applicants(driveId) {
      /*
       * Paged, and a failed page now throws. PostgREST stops answering at a
       * thousand rows, so a Super Dream visit that the whole roster applied to
       * came back as whichever thousand arrived first — and this screen ranked
       * them, counted them against the recruiter's ask and exported them without
       * saying that people were missing.
       */
      const applications = await readAllRows((from, to) =>
        client
          .from("applications")
          .select(
            "id, student_id, profile_snapshot, students(full_name, roll_number, participation_status, campuses(name)), shortlist_entries(included)",
          )
          .eq("drive_id", driveId)
          .range(from, to),
      );

      const studentIds = applications.map((a) => a.student_id as string);
      // The Central Student Skill Repository (0037). Scores are already on
      // the 0-100 scale R11 expects (A35), and each is named by its
      // skill-area row - the same names a drive's mandatory skills refer to.
      // Batched by id: one `in=(...)` of every applicant is a URL long enough
      // for the gateway to refuse, and a refused list reads as a student with
      // no skills assessed.
      const skills = await readAllRowsByIds(
        studentIds,
        (batch) => (from, to) =>
          client
            .from("student_skill_scores")
            .select("student_id, score, skill_areas(name)")
            .in("student_id", batch)
            .range(from, to),
      );

      const skillsByStudent = new Map<string, { skill: string; score: number }[]>();
      for (const row of skills) {
        const area = one<{ name?: string }>(row.skill_areas);
        // No area row, no name - an unnameable score cannot be matched
        // against a drive's required skills, so it is dropped, not invented.
        if (area?.name === undefined) continue;
        const list = skillsByStudent.get(row.student_id as string) ?? [];
        list.push({ skill: area.name, score: Number(row.score) });
        skillsByStudent.set(row.student_id as string, list);
      }

      return applications.map((row): ShortlistApplicant => {
        // R7: the snapshot is the truth for everything downstream.
        //
        // 🔴 2026-08-24 (UAT "CGPA showing 0"): the real envelope is
        // `buildApplicationSnapshot`'s `{ profile: { academics: {…}, … } }`.
        // This code read one level too shallow — `snapshot.academics` — so
        // every applicant's CGPA fell back to 0 while their snapshot carried
        // the true figure. The flat reads stay as fallbacks only.
        const envelope = (row.profile_snapshot ?? {}) as Record<string, unknown>;
        const snapshot = (envelope.profile ?? envelope) as Record<string, unknown>;
        const student = one<{
          full_name?: string;
          roll_number?: string;
          participation_status?: string;
          campuses?: unknown;
        }>(row.students);
        const academics = (snapshot.academics ?? snapshot) as Record<string, unknown>;

        return {
          applicationId: row.id as string,
          studentId: row.student_id as string,
          studentName:
            (snapshot.fullName as string | undefined) ?? student?.full_name ?? "Unknown student",
          rollNumber: (snapshot.rollNumber as string | undefined) ?? student?.roll_number ?? "—",
          // The snapshot carries no college, and this is not a figure a student
          // declared — it is which campus they belong to, so it is read live.
          college: one<{ name?: string }>(student?.campuses)?.name ?? null,
          /*
           * #17 (UAT 2026-10-18): the card used to say everything about a
           * candidate's marks and nothing about who they are — two applicants
           * named Priya, both at 8.4, were indistinguishable without opening
           * each record. All of it is ALREADY FROZEN in the same snapshot the
           * CGPA comes from, so the card reads it from there (R7) and never
           * from the live profile a student may have edited since applying.
           */
          degree: text(academics.degree ?? snapshot.degree),
          branch: text(academics.branch ?? snapshot.branch),
          passingYear: recorded(academics.passingYear ?? snapshot.passingYear),
          tenthPercentage: recorded(academics.tenthPercentage ?? snapshot.tenthPercentage),
          twelfthPercentage: recorded(academics.twelfthPercentage ?? snapshot.twelfthPercentage),
          email: text(snapshot.email),
          overallCgpa: Number(academics.overallCgpa ?? 0),
          currentArrears: Number(academics.currentArrears ?? 0),
          historyOfArrears: Number(academics.historyOfArrears ?? 0),
          skillScores: skillsByStudent.get(row.student_id as string) ?? [],
          // The snapshot profile calls them `roleCategories` (what the student
          // asked for); the old `preferredRoleCategories` read matched nothing.
          preferredRoleCategories: Array.isArray(snapshot.roleCategories)
            ? (snapshot.roleCategories as RoleCategory[])
            : Array.isArray(snapshot.preferredRoleCategories)
              ? (snapshot.preferredRoleCategories as RoleCategory[])
              : [],
          shortlisted: one<{ included?: boolean }>(row.shortlist_entries)?.included === true,
          // D7: read LIVE, not from the snapshot — the whole point is that
          // the student opted out AFTER the snapshot was taken.
          optedOut: student?.participation_status === "opted_out",
        };
      });
    },

    async saveShortlist(_driveId, decisions) {
      if ((await getActorRole()) !== "central_placement_coordinator") {
        throw new ShortlistError("Only the Central Placement Coordinator may shortlist.");
      }

      const actorId = await getActorId();
      if (actorId === null) {
        throw new ShortlistError("Your session has expired. Please sign in again.");
      }

      if (decisions.length === 0) return;

      // One row per application (the column is unique), carrying BOTH the
      // recommendation and the decision - PRD 13.1. Upsert, because the
      // coordinator will revise a shortlist more than once.
      const { error } = await client
        .from("shortlist_entries")
        .upsert(
          decisions.map((decision) => ({
            application_id: decision.applicationId,
            included: decision.included,
            rank: decision.rank,
            score: decision.score,
            rationale: decision.rationale,
            decided_by: actorId,
            // D7: null for everyone active; the trigger refuses an opted-out
            // inclusion without it.
            opt_out_override_reason: decision.optOutOverrideReason,
          })),
          { onConflict: "application_id" },
        )
        .select("id");

      if (error !== null) throw new ShortlistError("Could not save the shortlist.");
    },

    /**
     * WS8: what leaves the building. Snapshots (R7), never live rows — the
     * recruiter must receive what the shortlist was decided on.
     */
    async exportEntries(driveId) {
      // The same thousand-row cap as the screen above, on the same table: an
      // export that left people out is worse than one that failed, because the
      // recruiter's list is the thing that leaves the building.
      const rows = await readAllRows((from, to) =>
        client
          .from("applications")
          .select("id, profile_snapshot, shortlist_entries(included)")
          .eq("drive_id", driveId)
          .range(from, to),
      );

      return rows.map((row) => ({
        applicationId: row.id as string,
        included: one<{ included?: boolean }>(row.shortlist_entries)?.included === true,
        snapshot: row.profile_snapshot as ShortlistEntry["snapshot"],
      }));
    },

    /**
     * Answer 5a (2026-08-24): the resumes travel IN the pack. A download
     * failure throws — 5b's principle applies to transport too: a pack
     * silently missing a file reads as a candidate who was never sent.
     */
    async resumeFiles(resumeIds) {
      if (resumeIds.length === 0) return new Map();

      // Batched by id, paged: a shortlist of three hundred sends three hundred
      // UUIDs into one URL, and a URL the gateway refuses answers as an empty
      // list — which used to read as "these candidates have no CV files".
      const documents = await readAllRowsByIds(
        resumeIds,
        (batch) => (from, to) =>
          client
            .from("student_documents")
            .select("id, storage_path")
            .in("id", batch)
            .range(from, to),
      );

      const files = new Map<string, { data: ArrayBuffer; extension: string }>();
      for (const row of documents as Array<{ id: string; storage_path: string }>) {
        // 2026-08-26: an apply-time resume was recorded WITH its bucket in
        // front, so this asked the resumes bucket for `resumes/resumes/...`
        // and every export died on the first file it touched.
        const { data: blob, error: downloadError } = await client.storage
          .from("resumes")
          .download(objectKeyIn("resumes", row.storage_path));

        if (downloadError !== null || blob === null) {
          throw new ShortlistError(
            `A resume could not be downloaded (${row.storage_path.split("/").at(-1) ?? row.id}). Try the export again.`,
          );
        }

        const basename = row.storage_path.split("/").at(-1) ?? "";
        const dot = basename.lastIndexOf(".");
        files.set(row.id, {
          data: await blob.arrayBuffer(),
          extension: dot === -1 ? "" : basename.slice(dot).toLowerCase(),
        });
      }

      return files;
    },

    /**
     * DB / Storage direct signed links for resumes.
     * Generates active signed URLs directly from the resumes bucket, avoiding the
     * need to download all files into memory and package them in a zip.
     *
     * #78 (UAT 2026-10-18): it answers with a link per RESUME ID IT FOUND, so a
     * shorter map than the ids handed in is the honest result, not an error —
     * the screen counts them and says which candidates are left out.
     */
    async resumeSignedUrls(resumeIds, expiresInSeconds) {
      if (resumeIds.length === 0) return new Map();

      // Batched by id, paged: three hundred candidates put three hundred UUIDs
      // into one URL, and a URL the gateway refuses answers as an empty list —
      // which used to read as "nobody on this shortlist has a CV".
      const rows = await readAllRowsByIds(
        resumeIds,
        (batch) => (from, to) =>
          client
            .from("student_documents")
            .select("id, storage_path")
            .in("id", batch)
            .range(from, to),
      );

      return signedResumeLinks(
        client,
        (rows as Array<{ id: string; storage_path: string }>).map((row) => ({
          key: row.id,
          storagePath: row.storage_path,
        })),
        expiresInSeconds,
      );
    },

    /** PRD §13.2: the data-sharing log. An unlogged export never happened. */
    async logExport(driveId, columns, studentCount) {
      const actorId = await getActorId();
      if (actorId === null) {
        throw new ShortlistError("Your session has expired. Please sign in again.");
      }

      const { error } = await client
        .from("recruiter_exports")
        .insert({
          drive_id: driveId,
          exported_by: actorId,
          columns: [...columns],
          student_count: studentCount,
        })
        .select("id");

      if (error !== null) throw new ShortlistError("The export could not be logged.");
    },
  };
}
