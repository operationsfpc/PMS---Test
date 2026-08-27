/**
 * The offer letter the CPC attached, as the student may open it.
 *
 * UAT 2026-08-27 (`docs/inbox/WhatsApp Image 2026-08-27 at 18.18.49 (1).jpeg`):
 * the letter was filed against the offer by `0062` — whose storage policy
 * always admitted "staff who can read the offer **and the student**" — and
 * then shown on no student screen at all.
 *
 * It lives in `src/components` because two student screens need it (the
 * dashboard's offers and the notification the offer arrived in) and
 * `src/features/<a>` may not import from `src/features/<b>`.
 *
 * Both halves must be present. A name with no URL is a link that opens
 * nothing (the 0051 rule), and a URL that failed to sign is a 400 the student
 * cannot explain — either way the right answer is to say nothing rather than
 * to offer a promise that breaks on tapping.
 */
export function OfferLetterLink({
  url,
  name,
  className = "",
}: {
  url?: string | null | undefined;
  name?: string | null | undefined;
  className?: string | undefined;
}) {
  if (url === null || url === undefined || url === "") return null;
  if (name === null || name === undefined || name === "") return null;

  return (
    <a
      href={url}
      target="_blank"
      // The URL is signed and short-lived; `noreferrer` keeps it from being
      // handed to whatever the letter links on to.
      rel="noreferrer noopener"
      className={`inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline ${className}`}
    >
      <span aria-hidden="true">📎</span>
      {name}
    </a>
  );
}
