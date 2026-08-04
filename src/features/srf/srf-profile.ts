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
export interface SrfProfile {
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
}

/** Exported so src/db/query-contract.test.ts can prove it against the schema. */
export const SRF_PROFILE_COLUMNS = `
  full_name, roll_number, email, passing_year, degrees(name), branches(name)
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

    return {
      fullName: (row.full_name as string | null) ?? "",
      rollNumber: (row.roll_number as string | null) ?? "",
      email: (row.email as string | null) ?? "",
      degree: name(row.degrees),
      branch: name(row.branches),
      passingYear: (row.passing_year as number | null) ?? Number.NaN,
    };
  };
}
