import { RESUME_LINK_TTL_SECONDS } from "@domain/recruiter-export";
import { objectKeyIn } from "@domain/storage-path";
import { chunk } from "@lib/postgrest-read";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Clickable links to resumes, for the files that leave the building.
 *
 * Two exports need the same thing and said it separately before this: the
 * recruiter's shortlist CSV links each candidate's CV by DOCUMENT id, and the
 * student directory CSV links it by STUDENT id (#78, #79, UAT 2026-10-18). Same
 * bucket, same path fix-up, same signing — so the batch size and the expiry are
 * written once, here.
 *
 * The key the caller hands in is the key it gets back, which is why this does
 * not speak of ids at all.
 */
export interface ResumableFile {
  readonly key: string;
  /** `student_documents.storage_path`, exactly as the row carries it. */
  readonly storagePath: string;
}

/**
 * How many paths go into one `createSignedUrls` call.
 *
 * The same reasoning as the id batches in `@lib/postgrest-read`: a request too
 * big for the edge answers with a SHORT list rather than an error you can read,
 * and a short list here means candidates whose cell comes out blank.
 */
const LINK_BATCH = 100;

/**
 * Sign every file that can be found, and answer with the ones that worked.
 *
 * A file missing from the map is a fact the screen has to say out loud — the
 * CV row may have been deleted, or the read refused — so this deliberately does
 * not pad with empty strings. `@domain/recruiter-export`'s `resumeLinkShortfall`
 * counts what came back.
 */
export async function signedResumeLinks(
  client: SupabaseClient,
  files: readonly ResumableFile[],
  expiresInSeconds: number = RESUME_LINK_TTL_SECONDS,
): Promise<Map<string, string>> {
  const urlByPath = new Map<string, string>();

  for (const batch of chunk(files, LINK_BATCH)) {
    const paths = batch.map((file) => objectKeyIn("resumes", file.storagePath));

    const { data: signed, error } = await client.storage
      .from("resumes")
      .createSignedUrls(paths, expiresInSeconds);

    if (error !== null || signed === null) {
      throw new Error("Could not generate the resume links. Try the export again.");
    }

    signed.forEach((item, index) => {
      // Storage names the entry it signed; falling back to the path asked for
      // keeps the pair intact when it answers without one.
      const path = item.path ?? paths[index];
      if (path !== undefined && path !== "" && item.signedUrl !== null) {
        urlByPath.set(path, item.signedUrl);
      }
    });
  }

  const links = new Map<string, string>();
  for (const file of files) {
    const signedUrl = urlByPath.get(objectKeyIn("resumes", file.storagePath));
    if (signedUrl !== undefined) links.set(file.key, signedUrl);
  }
  return links;
}
