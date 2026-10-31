import { supabase } from "@lib/supabase";
import {
  createSupabaseSrfRepository,
  evidenceKey,
  SrfSubmitError as RepoSubmitError,
  type SrfUploadKind,
  type UploadedEvidence,
} from "./srf-repository";
import type { SrfSubmission } from "./srf-schema";

export type { SrfUploadKind, UploadedEvidence };
/**
 * The screen uploads on pick and submits the paths later, so both ends of that
 * handshake import the key derivation from here.
 */
export { evidenceKey };

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
/**
 * Stores the unsent form (UAT 2026-08-05).
 *
 * Never throws: auto-save runs while the student is typing, and an exception
 * there would surface as a failure of whatever they were doing. It reports
 * whether it worked so the screen can say so honestly.
 */
export async function saveSrfDraft(values: unknown): Promise<boolean> {
  try {
    return await createSupabaseSrfRepository(supabase()).saveDraft(values);
  } catch {
    return false;
  }
}

/**
 * Puts ONE picked file in storage straight away.
 *
 * The student picks a marksheet, a certificate or a resume and watches it
 * land; submit then only has to reference the path. Before this, nothing was
 * written until the whole form was sent, so a 5 MB scan had to succeed in the
 * same request as everything else and a bad pick or a dropped connection was
 * discovered at the very end, after all the typing.
 */
export async function uploadSrfFile(input: {
  readonly slot: string;
  readonly kind: SrfUploadKind;
  readonly file: File;
}): Promise<UploadedEvidence> {
  const repository = createSupabaseSrfRepository(supabase());

  try {
    return await repository.upload(input);
  } catch (error) {
    if (error instanceof RepoSubmitError) throw new SrfSubmitError(error.message);
    throw new SrfSubmitError("Could not upload that file. Check your connection and try again.");
  }
}

export async function submitSrf(
  values: SrfSubmission,
  preuploaded?: readonly UploadedEvidence[],
): Promise<SrfSubmitResult> {
  const repository = createSupabaseSrfRepository(supabase());

  try {
    return await repository.submit(values, preuploaded);
  } catch (error) {
    if (error instanceof RepoSubmitError) throw new SrfSubmitError(error.message);
    throw new SrfSubmitError("Could not submit your form. Please try again.");
  }
}
