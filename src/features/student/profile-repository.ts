import { normaliseProfileLinks, type ProfileLink } from "@domain/profile-links";
import type { VerificationStatus } from "@domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The part of a student's record that stays theirs after verification.
 *
 * R10. Their marks, arrears and semester lines were checked against documents
 * and belong to the coordinator now - PRD §7.2 judges eligibility on those, so
 * a student editing them would silently invalidate every shortlist their
 * record has already been measured for. These fields decide nothing, go stale,
 * and are nobody else's to maintain.
 *
 * Nothing here is a business rule. The columns this may write are named
 * explicitly, and `protect_verified_academics` (0009) refuses the rest anyway.
 */
export interface StudentProfileValues {
  readonly technicalSkills: string;
  readonly areasOfInterest: string;
  readonly areasOfExpertise: string;
  readonly projects: string;
  readonly achievements: string;
  readonly linkedin: string;
  readonly github: string;
  readonly leetcode: string;
  readonly hackerrank: string;
  /**
   * Kaggle, Codeforces, a portfolio - whatever the four named fields do not
   * cover. Collected by the SRF since 0025 and, until 2026-08-06, invisible
   * and uneditable everywhere else.
   */
  readonly otherProfiles: readonly ProfileLink[];
}

export class StudentProfileError extends Error {}

export interface StudentProfileRepository {
  load(): Promise<StudentProfileValues | null>;
  save(values: StudentProfileValues): Promise<void>;
}

/**
 * A certificate the student holds. F17: a NAME and a DOCUMENT, never a claim
 * on its own.
 */
export interface StudentCertificate {
  readonly id: string;
  readonly name: string;
  /** A signed, expiring link. Null when one could not be produced. */
  readonly url: string | null;
  /**
   * Checked by the coordinator, or not yet (0038). A certificate is a claim
   * until someone has opened the document and agreed it says what the name
   * says - the same standing as a declared CGPA.
   */
  readonly status: VerificationStatus;
  /** Only a rejection carries one, and it is what the student must act on. */
  readonly rejectionReason: string | null;
}

export interface StudentCertificatesRepository {
  list(): Promise<readonly StudentCertificate[]>;
  add(name: string, file: File): Promise<void>;
  remove(id: string): Promise<void>;
}

export class StudentCertificateError extends Error {}

/** Exported so src/db/query-contract.test.ts can prove it against the schema. */
export const STUDENT_PROFILE_COLUMNS = `
  technical_skills, areas_of_interest, areas_of_expertise,
  projects, achievements, other_profiles,
  linkedin_url, github_url, leetcode_url, hackerrank_url
`;

/** The same, for the certificates and the documents behind them. */
export const STUDENT_CERTIFICATE_COLUMNS = `
  id, name, status, rejection_reason, student_documents(storage_path)
`;

/**
 * Certificates share the marksheet bucket: same owner, same privacy, same
 * `<student>/...` path rule the storage policy checks (0022). A second bucket
 * would be a second policy to get wrong.
 */
const CERTIFICATE_BUCKET = "marksheets";

/** Long enough to open the file, short enough not to be a shareable copy. */
const LINK_TTL_SECONDS = 300;

const text = (value: unknown): string => (value as string | null) ?? "";

/** Empty means "not given", which is NULL - never an empty string. */
const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** Postgres guarantees only that `other_profiles` is a list. */
function readProfileLinks(value: unknown): readonly ProfileLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => entry as Record<string, unknown>)
    .map((entry) => ({ label: text(entry?.label), value: text(entry?.value) }))
    .filter((entry) => entry.label !== "" || entry.value !== "");
}

export function createSupabaseStudentProfileRepository(
  client: SupabaseClient,
): StudentProfileRepository {
  const userId = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  };

  return {
    async load() {
      const id = await userId();
      if (id === null) return null;

      const { data, error } = await client
        .from("students")
        .select(STUDENT_PROFILE_COLUMNS)
        .eq("auth_user_id", id)
        .maybeSingle();

      if (error !== null || data === null) return null;
      const row = data as unknown as Record<string, unknown>;

      return {
        technicalSkills: text(row.technical_skills),
        areasOfInterest: text(row.areas_of_interest),
        areasOfExpertise: text(row.areas_of_expertise),
        projects: text(row.projects),
        achievements: text(row.achievements),
        linkedin: text(row.linkedin_url),
        github: text(row.github_url),
        leetcode: text(row.leetcode_url),
        hackerrank: text(row.hackerrank_url),
        otherProfiles: readProfileLinks(row.other_profiles),
      };
    },

    async save(values) {
      const id = await userId();
      if (id === null) {
        throw new StudentProfileError("Your session has expired. Please sign in again.");
      }

      // Every column named, and not one of them verified. A student editing a
      // checked figure is the failure this whole boundary exists to prevent.
      //
      // `certifications` is deliberately absent: free text could be neither
      // verified nor de-duplicated (F9/F17), so `submit_srf` stopped writing
      // it in 0035 and this is the only other writer there was.
      const { error } = await client
        .from("students")
        .update({
          technical_skills: orNull(values.technicalSkills),
          areas_of_interest: orNull(values.areasOfInterest),
          areas_of_expertise: orNull(values.areasOfExpertise),
          projects: orNull(values.projects),
          achievements: orNull(values.achievements),
          linkedin_url: orNull(values.linkedin),
          github_url: orNull(values.github),
          leetcode_url: orNull(values.leetcode),
          hackerrank_url: orNull(values.hackerrank),
          // Trimmed, with rows added and abandoned dropped - the domain owns
          // that rule, so what is stored matches what validation judged.
          other_profiles: normaliseProfileLinks(values.otherProfiles),
        })
        .eq("auth_user_id", id)
        .select("id")
        .single();

      if (error !== null) {
        throw new StudentProfileError("Could not save your profile. Please try again.");
      }
    },
  };
}

/**
 * Certificates, after the registration form has been submitted.
 *
 * Asked for 2026-08-06: "i am not able to add certifications. need provision
 * for students to add details of certificates they have and must be able to
 * upload them." The SRF has collected them since F17, but the form locks on
 * approval and a certificate earned in the final semester had nowhere to go.
 *
 * The order is storage → document row → certificate row, for the same reason
 * the SRF uses it: an object with no row is invisible and costs a few
 * kilobytes, while a row with no object asks a coordinator to verify a claim
 * against a document that is not there.
 *
 * There is no update path. `one_certificate_per_name` (0034) is what enforces
 * F9, and replacing a certificate means removing it and adding it again - a
 * deliberate act, rather than a second row nobody can tell apart.
 */
export function createSupabaseStudentCertificates(
  client: SupabaseClient,
  getStudentId: () => Promise<string | null>,
): StudentCertificatesRepository {
  const ownId = async (): Promise<string> => {
    const id = await getStudentId();
    if (id === null) {
      throw new StudentCertificateError("Your session has expired. Please sign in again.");
    }
    return id;
  };

  return {
    async list() {
      const studentId = await getStudentId();
      if (studentId === null) return [];

      const { data, error } = await client
        .from("student_certificates")
        .select(STUDENT_CERTIFICATE_COLUMNS)
        .eq("student_id", studentId)
        .order("created_at", { ascending: true });

      if (error !== null || data === null) return [];

      const rows = data as unknown as Array<Record<string, unknown>>;

      return await Promise.all(
        rows.map(async (row) => {
          const document = (
            Array.isArray(row.student_documents) ? row.student_documents[0] : row.student_documents
          ) as { storage_path?: string } | null;
          const path = document?.storage_path;

          // Signed and expiring, never a public URL: the bucket is private
          // and a certificate carries the student's name.
          const signed =
            path === undefined
              ? null
              : await client.storage
                  .from(CERTIFICATE_BUCKET)
                  .createSignedUrl(path, LINK_TTL_SECONDS);

          return {
            id: text(row.id),
            name: text(row.name),
            url: signed?.data?.signedUrl ?? null,
            // Anything unrecognised reads as pending: a certificate must
            // never look checked because a column arrived unexpectedly.
            status: ((row.status as string | null) ?? "pending") as VerificationStatus,
            rejectionReason: orNull(text(row.rejection_reason)),
          };
        }),
      );
    },

    async add(name, file) {
      const studentId = await ownId();

      // Namespaced by student id because that is exactly what the storage
      // policy checks (0022), and stamped so a re-upload never collides.
      const path = `${studentId}/certificate-${Date.now()}-${file.name}`;

      const { error: uploadError } = await client.storage
        .from(CERTIFICATE_BUCKET)
        .upload(path, file, { contentType: file.type });

      if (uploadError !== null) {
        throw new StudentCertificateError(
          "Could not upload your certificate. Check your connection and try again.",
        );
      }

      const { data: document, error: documentError } = await client
        .from("student_documents")
        .insert({
          student_id: studentId,
          kind: "certificate",
          storage_path: path,
          size_bytes: file.size,
        })
        .select("id")
        .single();

      if (documentError !== null || document === null) {
        throw new StudentCertificateError("Could not save your certificate. Please try again.");
      }

      const { error } = await client
        .from("student_certificates")
        .insert({ student_id: studentId, name: name.trim(), document_id: document.id as string })
        .select("id")
        .single();

      if (error !== null) {
        throw new StudentCertificateError(
          // 0034's unique index, which is F9 enforced where no screen can
          // forget it. The student's answer is to remove the one on file.
          error.code === "23505"
            ? "You have already uploaded this certificate. Remove it first to replace it."
            : "Could not save your certificate. Please try again.",
        );
      }
    },

    async remove(id) {
      const studentId = await ownId();

      const { error } = await client
        .from("student_certificates")
        .delete()
        .eq("id", id)
        // Belt and braces with the policy: a student may only ever remove
        // their own, and this says so in the statement as well.
        .eq("student_id", studentId);

      if (error !== null) {
        throw new StudentCertificateError("Could not remove this certificate. Please try again.");
      }
    },
  };
}
