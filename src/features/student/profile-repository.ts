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
  readonly certifications: string;
  readonly achievements: string;
  readonly linkedin: string;
  readonly github: string;
  readonly leetcode: string;
  readonly hackerrank: string;
}

export class StudentProfileError extends Error {}

export interface StudentProfileRepository {
  load(): Promise<StudentProfileValues | null>;
  save(values: StudentProfileValues): Promise<void>;
}

/** Exported so src/db/query-contract.test.ts can prove it against the schema. */
export const STUDENT_PROFILE_COLUMNS = `
  technical_skills, areas_of_interest, areas_of_expertise,
  projects, certifications, achievements,
  linkedin_url, github_url, leetcode_url, hackerrank_url
`;

const text = (value: unknown): string => (value as string | null) ?? "";

/** Empty means "not given", which is NULL - never an empty string. */
const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

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
        certifications: text(row.certifications),
        achievements: text(row.achievements),
        linkedin: text(row.linkedin_url),
        github: text(row.github_url),
        leetcode: text(row.leetcode_url),
        hackerrank: text(row.hackerrank_url),
      };
    },

    async save(values) {
      const id = await userId();
      if (id === null) {
        throw new StudentProfileError("Your session has expired. Please sign in again.");
      }

      // Every column named, and not one of them verified. A student editing a
      // checked figure is the failure this whole boundary exists to prevent.
      const { error } = await client
        .from("students")
        .update({
          technical_skills: orNull(values.technicalSkills),
          areas_of_interest: orNull(values.areasOfInterest),
          areas_of_expertise: orNull(values.areasOfExpertise),
          projects: orNull(values.projects),
          certifications: orNull(values.certifications),
          achievements: orNull(values.achievements),
          linkedin_url: orNull(values.linkedin),
          github_url: orNull(values.github),
          leetcode_url: orNull(values.leetcode),
          hackerrank_url: orNull(values.hackerrank),
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
