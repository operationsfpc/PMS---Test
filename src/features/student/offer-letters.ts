import { OFFER_LETTER_BUCKET } from "@domain/attachments";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Signing the offer letters a student is allowed to open.
 *
 * UAT 2026-08-27 (`docs/inbox/WhatsApp Image 2026-08-27 at 18.18.49 (1).jpeg`):
 * the CPC attaches the letter to the offer (`0062`) and the student could see
 * it on no screen at all — even though 0062's storage policy has always
 * admitted "staff who can read the offer **and the student**".
 *
 * Its own module because three student screens need it (the dashboard's
 * offers, the concluded drive, and the notification the offer arrived in) and
 * `student-dashboard-view` already imports `drives-view` — putting it in
 * either would have made a cycle.
 */

/** Ten minutes, matching the Central CPC's own link in `offer-view.ts`. */
export const OFFER_LETTER_TTL_SECONDS = 600;

/** One offer's letter, as the student may open it. */
export interface OfferLetter {
  readonly url: string;
  readonly name: string;
}

const hasBothHalves = (offer: Record<string, unknown>): boolean =>
  typeof offer.attachment_path === "string" &&
  offer.attachment_path !== "" &&
  typeof offer.attachment_name === "string" &&
  offer.attachment_name !== "";

/**
 * Signs every attached letter in one round trip, keyed by the offer's id.
 *
 * A path that will not sign yields **nothing** rather than half a link: the
 * 0051 rule (both halves travel together) applied to the student's side of
 * it. A URL that 400s is not a link — it is a failure the student cannot
 * explain, and it looks exactly like our fault, because it is.
 */
export async function signOfferLetters(
  client: SupabaseClient,
  offers: ReadonlyArray<Record<string, unknown>>,
): Promise<ReadonlyMap<string, OfferLetter>> {
  const attached = offers.filter(hasBothHalves);
  if (attached.length === 0) return new Map();

  const { data } = await client.storage.from(OFFER_LETTER_BUCKET).createSignedUrls(
    attached.map((offer) => offer.attachment_path as string),
    OFFER_LETTER_TTL_SECONDS,
  );

  const signed = new Map<string, string>();
  for (const entry of data ?? []) {
    const url = entry.signedUrl ?? null;
    if (entry.path !== null && entry.path !== undefined && url !== null)
      signed.set(entry.path, url);
  }

  const byOfferId = new Map<string, OfferLetter>();
  for (const offer of attached) {
    const url = signed.get(offer.attachment_path as string);
    if (url === undefined) continue;
    byOfferId.set(offer.id as string, { url, name: offer.attachment_name as string });
  }
  return byOfferId;
}

/** The same letters, keyed by the drive they belong to. */
export function offerLettersByDrive(
  offers: ReadonlyArray<Record<string, unknown>>,
  byOfferId: ReadonlyMap<string, OfferLetter>,
): ReadonlyMap<string, OfferLetter> {
  const byDrive = new Map<string, OfferLetter>();
  for (const offer of offers) {
    const letter = byOfferId.get(offer.id as string);
    const driveId = offer.drive_id;
    if (letter !== undefined && typeof driveId === "string") byDrive.set(driveId, letter);
  }
  return byDrive;
}
