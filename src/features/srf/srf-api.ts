import { supabase } from "@lib/supabase";
import { createSupabaseSrfRepository, SrfSubmitError as RepoSubmitError } from "./srf-repository";
import type { SrfSubmission } from "./srf-schema";

export interface SrfSubmitResult {
  readonly id: string;
  readonly status: string;
}

/** Thrown for a server-side refusal the student can act on. */
export class SrfSubmitError extends Error {}

/**
 * Submits the SRF to the real database.
 *
 * Previously this posted to an MSW stand-in at /api/srf. It now goes through
 * the Supabase adapter, so RLS and the verified-field guards in 0009 apply.
 * The page's contract is unchanged: it awaits this and catches SrfSubmitError.
 */
export async function submitSrf(values: SrfSubmission): Promise<SrfSubmitResult> {
  const repository = createSupabaseSrfRepository(supabase());

  try {
    return await repository.submit(values);
  } catch (error) {
    if (error instanceof RepoSubmitError) throw new SrfSubmitError(error.message);
    throw new SrfSubmitError("Could not submit your form. Please try again.");
  }
}
