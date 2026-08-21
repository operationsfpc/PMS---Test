import { JOB_DESCRIPTION_BUCKET } from "@domain/attachments";
import { driveVenueApplies } from "@domain/drive-venue";
import { joiningNotesFor } from "@domain/joining";
import { normaliseToCgpa } from "@domain/marks";
import { nightTimingFor } from "@domain/shift";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PifFormValues } from "./pif-schema";

export class PifError extends Error {}

/** Where the attached JD lives, and what it was called when it arrived. */
interface JobDescriptionUpload {
  readonly storagePath: string;
  readonly fileName: string;
  readonly sizeBytes: number;
}

export interface PifRepository {
  /**
   * `existingDraftId` is B1's fix (UAT 2026-08-19): a draft is ONE row for its
   * whole life. Without it, save-draft-then-submit left an orphan draft behind
   * on every list — the AE's, the Delivery Head's and the Central CPC's.
   */
  saveDraft(
    values: PifFormValues,
    existingDraftId?: string,
  ): Promise<{ id: string; status: string }>;
  submit(values: PifFormValues, existingDraftId?: string): Promise<{ id: string; status: string }>;
}

export type GetActorId = () => Promise<string | null>;

/** Empty strings are the form's way of saying "not supplied"; the database's is NULL. */
const nullIfBlank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/**
 * Maps the AE's form onto the drives table.
 *
 * `offer_category` is never written here, whatever arrives in `values`. §3.3
 * makes it the Delivery Head's decision at approval and immutable afterwards,
 * so the AE's form must not be able to set it even if a field were added by
 * mistake later.
 */
function toRow(
  values: PifFormValues,
  actorId: string,
  status: "draft" | "submitted",
  driveId: string,
  jd: JobDescriptionUpload | null,
) {
  // J2/J3: whatever the AE typed and then abandoned by changing a radio is
  // dropped here as well as in the schema. `0051` refuses a night timing on a
  // day shift and a comment against the option that was not chosen, and losing
  // a whole PIF to a check constraint is not a good way to learn that.
  const nightTiming = nightTimingFor(values.shiftType ?? "", values.shiftNightTiming ?? "");
  const joining = joiningNotesFor(
    values.joiningTimeline ?? "",
    values.joiningImmediateNotes ?? "",
    values.joiningLaterNotes ?? "",
  );

  return {
    /**
     * Generated here, not by the database, because the JD object has to sit in
     * a folder named after its drive: `0051`'s read policy asks whether that
     * folder is a drive the reader may see, and the upload has to happen
     * before the row exists (see `write`).
     */
    id: driveId,
    company_name: values.companyName,
    industry: nullIfBlank(values.industry),
    company_website: nullIfBlank(values.companyWebsite),
    // A4 (UAT 2026-08-19): contacts live in drive_contacts now. The legacy
    // spoc_* columns stay readable on old drives and are written by nothing.

    role_title: nullIfBlank(values.roleTitle),
    role_category: nullIfBlank(values.roleCategory),
    job_description: nullIfBlank(values.jobDescription),
    openings: values.openings ?? null,
    work_locations: nullIfBlank(values.workLocations),
    ctc_min_lpa: values.ctcMinLpa ?? null,
    ctc_max_lpa: values.ctcMaxLpa ?? null,
    ctc_breakup: nullIfBlank(values.ctcBreakup),
    // A2: ₹ per month, whole rupees — an internship's pay is not an annual figure.
    stipend_min_monthly: values.stipendMinMonthly ?? null,
    stipend_max_monthly: values.stipendMaxMonthly ?? null,
    shift_type: nullIfBlank(values.shiftType),
    shift_night_timing: nullIfBlank(nightTiming),
    bond_details: nullIfBlank(values.bondDetails),

    // J1: the recruiter's own JD. Three columns rather than one, because a
    // storage path is not a file name and neither is a size - and the AE, the
    // Delivery Head and the student are all shown the name.
    jd_storage_path: jd?.storagePath ?? null,
    jd_file_name: jd?.fileName ?? null,
    jd_size_bytes: jd?.sizeBytes ?? null,

    // F12: two columns, deliberately. `min_overall_marks` + its scale are what
    // the AE typed and what a coordinator checks against the recruiter's mail;
    // `min_overall_cgpa` is the ONE scale R5 compares students against, so the
    // conversion happens once, here, rather than at every filter.
    min_overall_marks: values.minOverallCgpa ?? null,
    min_overall_cgpa_scale: values.minOverallCgpaScale ?? "cgpa",
    min_overall_cgpa:
      values.minOverallCgpa === null || values.minOverallCgpa === undefined
        ? null
        : normaliseToCgpa(values.minOverallCgpa, values.minOverallCgpaScale ?? "cgpa"),
    min_tenth_percentage: values.minTenthPercentage ?? null,
    min_twelfth_percentage: values.minTwelfthPercentage ?? null,
    arrears_policy: values.arrearsPolicy,
    eligible_passing_years: values.eligiblePassingYears ?? [],
    mandatory_skills: nullIfBlank(values.mandatorySkills),

    drive_mode: nullIfBlank(values.driveMode),
    // UAT 2026-08-21 item 2: the venue exists only where the mode has one and
    // the AE said "confirmed" — anything typed and then abandoned is dropped
    // here, not merely hidden by the form (the J2 lesson). Null IS the
    // "not yet confirmed" state; the Central CPC fills it in later.
    venue:
      driveVenueApplies(values.driveMode) && values.venueStatus === "confirmed"
        ? nullIfBlank(values.venue)
        : null,
    tentative_date: nullIfBlank(values.tentativeDate),
    timeline_notes: nullIfBlank(values.timelineNotes),
    joining_timeline: nullIfBlank(values.joiningTimeline),
    joining_immediate_notes: nullIfBlank(joining.immediate),
    joining_later_notes: nullIfBlank(joining.later),
    drive_type: nullIfBlank(values.driveType),

    // F7: one interview process, several job titles, ONE PIF.
    additional_designations: values.additionalDesignations ?? [],
    // F11: read back by the Central CPC's publish screen, which used to ask
    // them to remember the round list.
    // Derived, never asked for twice: the list IS the count.
    round_count: (values.rounds ?? []).length === 0 ? null : (values.rounds ?? []).length,

    status,
    created_by: actorId,
  };
}

/**
 * Turns a PostgREST failure into something with a remedy in it.
 *
 * A PIF failed against the live project and the only diagnostic anyone had was
 * "please try again" - which was wrong in every one of these cases. Each of
 * these has a different fix, and the AE or the Admin reading it needs to know
 * which one they are looking at.
 */
function explain(error: { code?: string; message?: string }): string {
  const message = error.message ?? "";

  switch (error.code) {
    case "42501":
      return "You do not have permission to raise a PIF. Ask an Admin to check your role.";
    case "PGRST204":
    case "PGRST205":
      // The app is asking for a column the project does not have: migrations
      // have not been pushed. Nothing the AE does will fix it.
      return `The database is out of date and cannot store this PIF yet (${message}). This needs an Admin, not a retry.`;
    case "23502":
      return `A required field was empty: ${message}`;
    case "23514":
      return `A value broke one of the drive's rules: ${message}`;
    case "23505":
      return "That drive already exists.";
    case "23503":
      return `Something this PIF refers to does not exist: ${message}`;
    default:
      return message === "" ? "Could not save the PIF." : `Could not save the PIF: ${message}`;
  }
}

export function createSupabasePifRepository(
  client: SupabaseClient,
  getActorId: GetActorId = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): PifRepository {
  /**
   * Puts the attached JD in storage and describes what landed there.
   *
   * Uploaded BEFORE the drive row, the same order the SRF's marksheets use and
   * for the same reason: storage cannot join the insert. An object with no row
   * costs a few kilobytes and is invisible; a row with no object hands the
   * Delivery Head approving the drive, and every student who applies to it, a
   * link that opens nothing.
   */
  async function uploadJobDescription(driveId: string, file: File): Promise<JobDescriptionUpload> {
    // Timestamped so replacing the JD cannot collide with the file it replaces.
    const path = `${driveId}/jd-${Date.now()}-${file.name}`;
    const { error } = await client.storage
      .from(JOB_DESCRIPTION_BUCKET)
      .upload(path, file, { contentType: "application/pdf" });

    if (error !== null) {
      throw new PifError(
        "Could not upload the job description. Check your connection and try again — nothing has been saved.",
        { cause: error },
      );
    }

    return { storagePath: path, fileName: file.name, sizeBytes: file.size };
  }

  async function write(
    values: PifFormValues,
    status: "draft" | "submitted",
    existingDraftId?: string,
  ) {
    const actorId = await getActorId();
    if (actorId === null) {
      throw new PifError("Your session has expired. Please sign in again.");
    }

    const driveId = existingDraftId ?? crypto.randomUUID();
    const file = values.jobDescriptionFile ?? null;
    const jd = file === null ? null : await uploadJobDescription(driveId, file);

    const row = toRow(values, actorId, status, driveId, jd);

    // B1: updating an existing draft PATCHes the row it already is. RLS
    // (0047) confines this to the AE's own drive while it is still a draft.
    // A JD that was not re-attached must not be nulled out of the row.
    const { data, error } = await (existingDraftId === undefined
      ? client.from("drives").insert(row).select("id, status").single()
      : client
          .from("drives")
          .update(
            jd === null
              ? (({ jd_storage_path, jd_file_name, jd_size_bytes, id, created_by, ...rest }) =>
                  rest)(row)
              : (({ id, created_by, ...rest }) => rest)(row),
          )
          .eq("id", existingDraftId)
          .select("id, status")
          .single());

    if (error !== null) {
      // Keep the original as `cause`: the message is for the AE, the cause is
      // for whoever has to work out why it happened.
      throw new PifError(explain(error), { cause: error });
    }

    // The update replaces the round list wholesale — re-inserting on top of
    // the old rows would double every round.
    if (existingDraftId !== undefined) {
      await client.from("drive_rounds").delete().eq("drive_id", existingDraftId);
    }

    /**
     * The rounds the AE was told about, written as the drive's own rounds
     * (2026-08-18): "the drive round shown in PIF should get auto populated in
     * drives shown in live/published drives with an ability to be edited."
     *
     * Before this the AE stated a COUNT and the Central CPC created the rounds
     * by hand on another screen - so a drive declared as three rounds could go
     * live with none, and nobody could be advanced past round one.
     *
     * A failure here is deliberately NOT fatal. The drive is the thing worth
     * keeping: the AE can see it, the Central CPC completes it, and the publish
     * screen shows exactly the rounds that exist. Losing a whole PIF over its
     * round list would be the worse outcome, and PostgREST gives each write its
     * own transaction anyway, so the insert above has already committed.
     */
    const rounds = values.rounds ?? [];
    if (rounds.length > 0) {
      await client.from("drive_rounds").insert(
        rounds.map((round) => ({
          drive_id: data.id as string,
          sequence: round.sequence,
          name: round.name.trim(),
        })),
      );
    }

    /**
     * A4: the drive's contacts, replaced wholesale like the rounds. Not fatal
     * for the same reason — the drive is the thing worth keeping.
     */
    if (existingDraftId !== undefined) {
      await client.from("drive_contacts").delete().eq("drive_id", existingDraftId);
    }
    const contactRows = (values.contacts ?? []).filter((c) =>
      [c.name, c.designation, c.email, c.phone].some(
        (f) => typeof f === "string" && f.trim() !== "",
      ),
    );
    if (contactRows.length > 0) {
      await client.from("drive_contacts").insert(
        contactRows.map((contact, index) => ({
          drive_id: data.id as string,
          sequence: index + 1,
          name: nullIfBlank(contact.name),
          designation: nullIfBlank(contact.designation),
          email: nullIfBlank(contact.email),
          phone: nullIfBlank(contact.phone),
        })),
      );
    }

    return { id: data.id as string, status: data.status as string };
  }

  return {
    saveDraft: (values, existingDraftId) => write(values, "draft", existingDraftId),
    submit: (values, existingDraftId) => write(values, "submitted", existingDraftId),
  };
}
