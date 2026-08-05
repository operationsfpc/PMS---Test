import type { SrfStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The student's own roster record, used to prefill the SRF.
 *
 * The form used to open with a fabricated student ('Priya Ramesh',
 * '21CSE1042') baked into its defaults, which is what was reported as showing
 * random data. Identity is not the student's to type - name, roll number and
 * email come from the roster the college supplied, and the fields carrying
 * them are disabled - so with the fake defaults removed there was nothing to
 * fill them at all.
 */
/** One declared semester, as the read-only summary shows it back. */
export interface SubmittedSemester {
  readonly semesterNumber: number;
  readonly marks: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
}

export interface SrfProfile {
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
  /** Their unsent form, if they saved one. Null when they have not. */
  readonly draft: unknown;
  /**
   * What they actually submitted.
   *
   * Optional because a student who has never submitted has none of it, and
   * because the form itself does not need it - it is read back only to show a
   * submitted or verified record as text rather than as inputs.
   */
  readonly mobile?: string;
  readonly whatsapp?: string | null;
  readonly alternateContact?: string | null;
  readonly tenthInstitution?: string | null;
  readonly tenthPercentage?: number | null;
  readonly twelfthInstitution?: string | null;
  readonly twelfthPercentage?: number | null;
  readonly technicalSkills?: string | null;
  readonly areasOfInterest?: string | null;
  readonly areasOfExpertise?: string | null;
  readonly projects?: string | null;
  readonly certifications?: string | null;
  readonly achievements?: string | null;
  readonly semesters?: readonly SubmittedSemester[];
  /** Where the form is in its life. Decides whether it is a form at all. */
  readonly srfStatus?: SrfStatus;
  /** Why a coordinator sent it back. Null unless they did. */
  readonly rejectionReason?: string | null;
}

/**
 * Exported so src/db/query-contract.test.ts can prove it against the schema.
 *
 * It reads the SUBMITTED values as well as the roster identity, because a form
 * that has been sent is shown back as a record rather than as inputs, and
 * `srf_status` is what decides which of those two it is.
 */
export const SRF_PROFILE_COLUMNS = `
  full_name, roll_number, email, passing_year, srf_draft,
  srf_status, srf_rejection_reason,
  mobile, whatsapp, alternate_contact,
  tenth_institution, tenth_percentage, twelfth_institution, twelfth_percentage,
  technical_skills, areas_of_interest, areas_of_expertise,
  projects, certifications, achievements,
  degrees(name), branches(name),
  student_semesters(semester_number, declared_marks, current_arrears, history_of_arrears)
`;

const name = (value: unknown): string => {
  const row = (Array.isArray(value) ? value[0] : value) as { name?: string } | null;
  return row?.name ?? "";
};

export function createSupabaseSrfProfile(client: SupabaseClient) {
  return async (): Promise<SrfProfile | null> => {
    const { data: session } = await client.auth.getSession();
    const userId = session.session?.user.id;
    if (userId === undefined) return null;

    const { data, error } = await client
      .from("students")
      .select(SRF_PROFILE_COLUMNS)
      .eq("auth_user_id", userId)
      .maybeSingle();

    if (error !== null || data === null) return null;

    const row = data as unknown as Record<string, unknown>;

    const semesters = ((row.student_semesters ?? []) as Array<Record<string, unknown>>)
      .map((s) => ({
        semesterNumber: Number(s.semester_number ?? 0),
        marks: Number(s.declared_marks ?? 0),
        currentArrears: Number(s.current_arrears ?? 0),
        historyOfArrears: Number(s.history_of_arrears ?? 0),
      }))
      // PostgREST promises no order on an embedded resource, and a degree
      // reads forwards.
      .sort((a, b) => a.semesterNumber - b.semesterNumber);

    const text = (value: unknown): string | null => (value as string | null) ?? null;
    const num = (value: unknown): number | null =>
      value === null || value === undefined ? null : Number(value);

    return {
      fullName: (row.full_name as string | null) ?? "",
      rollNumber: (row.roll_number as string | null) ?? "",
      email: (row.email as string | null) ?? "",
      degree: name(row.degrees),
      branch: name(row.branches),
      passingYear: (row.passing_year as number | null) ?? Number.NaN,
      draft: row.srf_draft ?? null,
      srfStatus: (row.srf_status as SrfStatus | null) ?? "registered",
      rejectionReason: text(row.srf_rejection_reason),
      mobile: text(row.mobile) ?? "",
      whatsapp: text(row.whatsapp),
      alternateContact: text(row.alternate_contact),
      tenthInstitution: text(row.tenth_institution),
      tenthPercentage: num(row.tenth_percentage),
      twelfthInstitution: text(row.twelfth_institution),
      twelfthPercentage: num(row.twelfth_percentage),
      technicalSkills: text(row.technical_skills),
      areasOfInterest: text(row.areas_of_interest),
      areasOfExpertise: text(row.areas_of_expertise),
      projects: text(row.projects),
      certifications: text(row.certifications),
      achievements: text(row.achievements),
      semesters,
    };
  };
}
