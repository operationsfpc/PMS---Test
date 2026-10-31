import { JOB_DESCRIPTION_BUCKET } from "@domain/attachments";
import { driveVenueApplies } from "@domain/drive-venue";
import { joiningNotesFor } from "@domain/joining";
import { normaliseToCgpa } from "@domain/marks";
import { nightTimingFor } from "@domain/shift";
import { sanitizeStorageFileName } from "@domain/storage-path";
import { readAllRows } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BarRow } from "./pif-labels";
import type { MultiRolePifValues, PifFormValues } from "./pif-schema";

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
  saveCompanyDriveDraft(
    values: MultiRolePifValues,
    existingEventId?: string,
  ): Promise<{ eventId: string; roleIds: string[]; status: string }>;
  submitCompanyDrive(
    values: MultiRolePifValues,
    existingEventId?: string,
  ): Promise<{ eventId: string; roleIds: string[]; status: string }>;
  /**
   * The assessed-skills catalogue for the mandatory-skills picker (spec
   * 2026-08-21 part A, approved 2026-08-24). Names only — student scores stay
   * unreadable to the AE (0037). A refused read degrades to an empty
   * catalogue: the AE can still raise the PIF using "other skills".
   */
  skillAreas(): Promise<readonly string[]>;
  /**
   * Returns previously created companies for autocomplete and linking.
   */
  existingCompanies?(): Promise<readonly CompanySuggestion[]>;
  /**
   * Returns existing drive events / dates for a specific company name.
   */
  getCompanyEvents?(companyName: string): Promise<readonly ExistingDriveEvent[]>;
}

export interface CompanySuggestion {
  readonly id?: string;
  readonly name: string;
  readonly industry?: string | null;
  readonly website?: string | null;
}

/** A `CompanySuggestion` while it is being assembled from several sources. */
type MutableCompanySuggestion = {
  -readonly [K in keyof CompanySuggestion]: CompanySuggestion[K];
};

/** An `ExistingDriveEvent` while it is being assembled from several sources. */
type MutableDriveEvent = {
  -readonly [K in keyof ExistingDriveEvent]: ExistingDriveEvent[K];
};

export interface ExistingDriveEvent {
  readonly id: string;
  readonly companyName: string;
  readonly tentativeDate: string | null;
  readonly driveMode: string | null;
  readonly venue: string | null;
  readonly status: string;
  readonly existingRoles: readonly string[];
  readonly contacts?: readonly {
    readonly name: string;
    readonly designation: string;
    readonly email: string;
    readonly phone: string;
  }[];
  /**
   * The bar the visit's roles already carry, so a role added to it is raised
   * under the same cutoff instead of a second one.
   */
  readonly bar?: BarRow | undefined;
}

export type GetActorId = () => Promise<string | null>;

/** Empty strings are the form's way of saying "not supplied"; the database's is NULL. */
const nullIfBlank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/**
 * The bar a role row already carries, or nothing when it carries none.
 *
 * The bar lives on the ROLE row, because that is where the eligibility gates
 * read it from. A visit's bar is therefore the bar its roles carry — and a
 * role added to that visit must be raised under it, not under a new one.
 */
function barFromRoleRow(row: Record<string, unknown>): BarRow | undefined {
  const number = (v: unknown): number | null =>
    v === null || v === undefined || v === "" ? null : Number(v);
  const bond = typeof row.bond_details === "string" ? row.bond_details.trim() : "";
  const years = Array.isArray(row.eligible_passing_years)
    ? row.eligible_passing_years.map((y) => Number(y)).filter((y) => !Number.isNaN(y))
    : [];
  const minOverallCgpa = number(row.min_overall_marks);
  const minTenthPercentage = number(row.min_tenth_percentage);
  const minTwelfthPercentage = number(row.min_twelfth_percentage);

  if (
    bond === "" &&
    minOverallCgpa === null &&
    minTenthPercentage === null &&
    minTwelfthPercentage === null &&
    years.length === 0
  ) {
    return undefined;
  }

  return {
    bondDetails: bond,
    minOverallCgpa,
    minOverallCgpaScale:
      typeof row.min_overall_cgpa_scale === "string" ? row.min_overall_cgpa_scale : "cgpa",
    minTenthPercentage,
    minTwelfthPercentage,
    arrearsPolicy: typeof row.arrears_policy === "string" ? row.arrears_policy : "flexible",
    eligiblePassingYears: years,
  };
}

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
    ...(values.companyDriveId && values.companyDriveId.trim() !== ""
      ? { company_drive_id: values.companyDriveId.trim() }
      : {}),
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
      // The database decides this one, and it reads the real profile. A
      // "Preview as" role changes which screens the app shows and nothing else,
      // so the old wording sent a reader whose account WAS an AE's off to ask
      // for a role change they already had. Both remedies, in one sentence.
      return [
        "You do not have permission to raise a PIF: the database reads your own profile,",
        "and it is not an Account Executive's. A 'Preview as' role changes the screens only,",
        "never what the database accepts - stop the preview, and if your account really is",
        "an AE, ask an Admin to check the role on it.",
      ].join(" ");
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
    const path = `${driveId}/jd-${Date.now()}-${sanitizeStorageFileName(file.name)}`;
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

  async function writeCompanyDrive(
    values: MultiRolePifValues,
    status: "draft" | "submitted",
    existingEventId?: string,
  ): Promise<{ eventId: string; roleIds: string[]; status: string }> {
    const actorId = await getActorId();
    if (actorId === null) {
      throw new PifError("Your session has expired. Please sign in again.");
    }

    /*
     * `0116` raises "Company drive event not found." for an id whose row does
     * not exist, so a NEW visit must send NO id and let the RPC mint one. A
     * fresh uuid here looked harmless and was not: it made every first save of
     * a multi-role drive fail. The id only travels when it names a visit that
     * is already in the database — one saved as a draft earlier in this session,
     * or one the AE picked from the existing-drive list.
     */
    const knownEventId = existingEventId ?? values.id ?? null;

    const processedRoles = await Promise.all(
      (values.roles ?? []).map(async (role) => {
        const roleId = role.id ?? crypto.randomUUID();
        const file = role.jobDescriptionFile ?? null;
        let jd: JobDescriptionUpload | null = null;
        if (file instanceof File) {
          jd = await uploadJobDescription(roleId, file);
        }

        const nightTiming = nightTimingFor(role.shiftType ?? "", role.shiftNightTiming ?? "");

        return {
          id: roleId,
          roleTitle: nullIfBlank(role.roleTitle),
          roleCategory: nullIfBlank(role.roleCategory),
          driveType: nullIfBlank(role.driveType),
          openings: role.openings ?? null,
          workLocations: nullIfBlank(role.workLocations),
          ctcMinLpa: role.ctcMinLpa ?? null,
          ctcMaxLpa: role.ctcMaxLpa ?? null,
          ctcBreakup: nullIfBlank(role.ctcBreakup),
          stipendMinMonthly: role.stipendMinMonthly ?? null,
          stipendMaxMonthly: role.stipendMaxMonthly ?? null,
          shiftType: nullIfBlank(role.shiftType),
          shiftNightTiming: nullIfBlank(nightTiming),
          /**
           * The bar is the VISIT's. It is asked once and written onto every
           * role the PIF raises, so one recruiter cannot end up hiring the same
           * day at two different cutoffs.
           */
          bondDetails: nullIfBlank(values.bondDetails),
          jdStoragePath: jd?.storagePath ?? null,
          jdFileName: jd?.fileName ?? null,
          jdSizeBytes: jd?.sizeBytes ?? null,
          jobDescription: nullIfBlank(role.jobDescription),
          minOverallMarks: values.minOverallCgpa ?? null,
          minOverallCgpaScale: values.minOverallCgpaScale ?? "cgpa",
          minOverallCgpa:
            values.minOverallCgpa === null || values.minOverallCgpa === undefined
              ? null
              : normaliseToCgpa(values.minOverallCgpa, values.minOverallCgpaScale ?? "cgpa"),
          minTenthPercentage: values.minTenthPercentage ?? null,
          minTwelfthPercentage: values.minTwelfthPercentage ?? null,
          arrearsPolicy: values.arrearsPolicy ?? "flexible",
          eligiblePassingYears: values.eligiblePassingYears ?? [],
          mandatorySkills: nullIfBlank(role.mandatorySkills),
          joiningImmediateNotes: nullIfBlank(role.joiningImmediateNotes),
          joiningLaterNotes: nullIfBlank(role.joiningLaterNotes),
          rounds: (role.rounds ?? []).map((r) => ({
            sequence: r.sequence,
            name: r.name.trim(),
          })),
        };
      }),
    );

    const eventPayload = {
      id: knownEventId,
      companyId: nullIfBlank(values.companyId),
      companyName: values.companyName,
      industry: nullIfBlank(values.industry),
      companyWebsite: nullIfBlank(values.companyWebsite),
      driveMode: nullIfBlank(values.driveMode),
      venue:
        driveVenueApplies(values.driveMode) && values.venueStatus === "confirmed"
          ? nullIfBlank(values.venue)
          : null,
      tentativeDate: nullIfBlank(values.tentativeDate),
      timelineNotes: nullIfBlank(values.timelineNotes),
      joiningTimeline: nullIfBlank(values.joiningTimeline),
      status,
    };

    const contactPayload = (values.contacts ?? []).map((c, idx) => ({
      sequence: idx + 1,
      name: nullIfBlank(c.name),
      designation: nullIfBlank(c.designation),
      email: nullIfBlank(c.email),
      phone: nullIfBlank(c.phone),
    }));

    const { data, error } = await client.rpc("save_company_drive_with_roles", {
      p_event: eventPayload,
      p_contacts: contactPayload,
      p_roles: processedRoles,
      p_status: status,
    });

    if (error !== null) {
      throw new PifError(explain(error), { cause: error });
    }

    const res = (data ?? {}) as { eventId?: string; roleIds?: string[]; status?: string };
    return {
      eventId: res.eventId ?? knownEventId ?? "",
      roleIds: res.roleIds ?? [],
      status: res.status ?? status,
    };
  }

  return {
    saveDraft: (values, existingDraftId) => write(values, "draft", existingDraftId),
    submit: (values, existingDraftId) => write(values, "submitted", existingDraftId),
    saveCompanyDriveDraft: (values, existingEventId) =>
      writeCompanyDrive(values, "draft", existingEventId),
    submitCompanyDrive: (values, existingEventId) =>
      writeCompanyDrive(values, "submitted", existingEventId),
    async skillAreas() {
      /**
       * Raised, not swallowed. The page has had the sentence "we could not
       * read the assessed-skills catalogue" since it was written, and an empty
       * array here kept it unsayable: the picker went blank and the AE read it
       * as a college that assesses nothing.
       */
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await readAllRows((from, to) =>
          client.from("skill_areas").select("name").order("name").range(from, to),
        );
      } catch {
        throw new PifError("Could not read the assessed-skills catalogue.");
      }
      return rows.map((r) => String((r.name as string | undefined) ?? "")).filter((n) => n !== "");
    },
    /*
     * THREE tables name a company and only one of them is the registry.
     * `companies` has the id; `company_drives` names a visit; `drives` names a
     * role — and the single-role PIF writes only that one, never creating a
     * registry row. Reading `companies` alone therefore listed the handful of
     * hand-registered names, left every drive-raised company out of the
     * autocomplete, and so autofilled nothing. All three are merged now,
     * case-insensitively: the earliest source wins the name and a later one
     * fills what the earlier left blank.
     */
    async existingCompanies(): Promise<readonly CompanySuggestion[]> {
      const byName = new Map<string, MutableCompanySuggestion>();

      const text = (value: unknown): string | null => {
        const raw = typeof value === "string" ? value.trim() : "";
        return raw === "" ? null : raw;
      };

      const remember = (row: Record<string, unknown>) => {
        const name = text(row.name ?? row.company_name);
        if (name === null) return;
        const key = name.toLowerCase();
        const held = byName.get(key);
        const merged: MutableCompanySuggestion = {
          name: held?.name ?? name,
          industry: held?.industry ?? text(row.industry),
          website: held?.website ?? text(row.website ?? row.company_website),
        };
        const id = held?.id ?? text(row.id);
        if (id !== null && id !== undefined) merged.id = id;
        byName.set(key, merged);
      };

      /**
       * Paged, because `drives` is every role this organisation has ever
       * raised: past a thousand rows the company someone is typing was not in
       * the autocomplete at all, and nothing autofilled — which read as a
       * brand-new company, not as a truncated list.
       *
       * A refused source costs one source, not the whole autocomplete. All
       * three refused is a different fact, and the page can say it.
       */
      let refused = 0;
      const read = async (
        table: string,
        columns: string,
      ): Promise<readonly Record<string, unknown>[]> => {
        try {
          return await readAllRows((from, to) =>
            client.from(table).select(columns).range(from, to),
          );
        } catch {
          refused += 1;
          return [];
        }
      };

      for (const row of await read("companies", "id, name, industry, website")) remember(row);
      for (const row of await read("company_drives", "company_name")) remember(row);
      for (const row of await read("drives", "company_name, industry, company_website"))
        remember(row);

      if (refused === 3) {
        throw new PifError("Could not read the companies already on record.");
      }

      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    async getCompanyEvents(companyName: string): Promise<readonly ExistingDriveEvent[]> {
      const trimmed = companyName.trim();
      if (!trimmed) return [];

      /**
       * Paged, and a refusal counted rather than hidden. An empty result reads
       * as "this company has never visited"; both READS refused looked exactly
       * like it, and the AE re-typed a company's whole history because the
       * picker claimed to have none. One source refusing still costs only the
       * events that table knows about.
       */
      let refused = 0;
      const events: MutableDriveEvent[] = [];

      const cdRows = await readAllRows((from, to) =>
        client
          .from("company_drives")
          .select(`
          id, company_name, drive_mode, venue, tentative_date, status,
          drives(id, role_title, bond_details, min_overall_marks, min_overall_cgpa_scale,
                 min_tenth_percentage, min_twelfth_percentage, arrears_policy,
                 eligible_passing_years),
          company_drive_contacts(sequence, name, designation, email, phone)
        `)
          .ilike("company_name", trimmed)
          .order("tentative_date", { ascending: false })
          .range(from, to),
      ).catch(() => {
        refused += 1;
        return [];
      });

      for (const row of cdRows) {
        const roleRows = Array.isArray(row.drives) ? (row.drives as Record<string, unknown>[]) : [];
        const roles = roleRows
          .map((d) => String(d.role_title ?? "").trim())
          .filter((r) => r !== "");
        const contacts = (
          Array.isArray(row.company_drive_contacts) ? row.company_drive_contacts : []
        )
          .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
          .map((c: Record<string, unknown>) => ({
            name: String(c.name ?? ""),
            designation: String(c.designation ?? ""),
            email: String(c.email ?? ""),
            phone: String(c.phone ?? ""),
          }));

        events.push({
          id: row.id as string,
          companyName: row.company_name as string,
          tentativeDate: (row.tentative_date as string | null) ?? null,
          driveMode: (row.drive_mode as string | null) ?? null,
          venue: (row.venue as string | null) ?? null,
          status: (row.status as string | null) ?? "draft",
          existingRoles: roles,
          contacts,
          bar: roleRows.map(barFromRoleRow).find((bar) => bar !== undefined),
        });
      }

      const drivesRows = await readAllRows((from, to) =>
        client
          .from("drives")
          .select(`
          id, company_drive_id, company_name, drive_mode, venue, tentative_date, status, role_title,
          bond_details, min_overall_marks, min_overall_cgpa_scale,
          min_tenth_percentage, min_twelfth_percentage, arrears_policy, eligible_passing_years,
          drive_contacts(sequence, name, designation, email, phone)
        `)
          .ilike("company_name", trimmed)
          .order("tentative_date", { ascending: false })
          .range(from, to),
      ).catch(() => {
        refused += 1;
        return [];
      });

      const seenEventIds = new Set(events.map((e) => e.id));
      for (const d of drivesRows) {
        const eventId = (d.company_drive_id as string | null) ?? (d.id as string);
        if (seenEventIds.has(eventId)) {
          const existing = events.find((e) => e.id === eventId);
          if (existing && d.role_title && !existing.existingRoles.includes(String(d.role_title))) {
            (existing.existingRoles as string[]).push(String(d.role_title));
          }
          // The visit's bar, when the visit was found through `company_drives`
          // but this role carries one: the first role that has a bar sets it
          // for the whole visit.
          if (existing && existing.bar === undefined) {
            existing.bar = barFromRoleRow(d);
          }
          continue;
        }
        seenEventIds.add(eventId);

        const contacts = (Array.isArray(d.drive_contacts) ? d.drive_contacts : [])
          .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
          .map((c: Record<string, unknown>) => ({
            name: String(c.name ?? ""),
            designation: String(c.designation ?? ""),
            email: String(c.email ?? ""),
            phone: String(c.phone ?? ""),
          }));

        events.push({
          id: eventId,
          companyName: d.company_name as string,
          tentativeDate: (d.tentative_date as string | null) ?? null,
          driveMode: (d.drive_mode as string | null) ?? null,
          venue: (d.venue as string | null) ?? null,
          status: (d.status as string | null) ?? "draft",
          existingRoles: d.role_title ? [String(d.role_title)] : [],
          contacts,
          bar: barFromRoleRow(d),
        });
      }

      if (refused === 2) {
        throw new PifError("Could not read this company's previous drives.");
      }

      return events;
    },
  };
}
