/**
 * Certificates a student holds. F9 and F17 (UAT 2026-08-06).
 *
 * F17: "The student registration form should also contain an upload button for
 * students to upload the certificates. Name of certificate + upload
 * certificate."
 *
 * F9: "Currently, students can upload certificates multiple times, which
 * should be restricted to a single upload."
 *
 * A certificate is a NAME and a FILE, and neither half is optional. A name
 * with no document is a claim nobody can check; a document with no name is
 * something a coordinator has to open to identify, for every student, every
 * time. The form used to collect a free-text "Certifications" box, which was
 * both at once.
 *
 * One certificate, one upload. The same certificate arriving three times is
 * the bug that was reported, and it has no good answer: a coordinator
 * verifying a profile cannot tell which of three identical rows is the real
 * one.
 */

export interface CertificateEntry {
  readonly name: string;
  readonly hasFile: boolean;
}

export type UploadDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/** How two certificate names are compared: the way a human would. */
const key = (name: string) => name.trim().toLowerCase().replaceAll(/\s+/g, " ");

/**
 * Rows worth judging.
 *
 * The form offers an empty row to type into, and an untouched one is not a
 * mistake. A row with EITHER half filled in is kept, so the student is told
 * what the other half is missing rather than having their work silently
 * dropped.
 */
export function usableCertificates(
  entries: readonly CertificateEntry[],
): readonly CertificateEntry[] {
  return entries
    .map((entry) => ({ ...entry, name: entry.name.trim() }))
    .filter((entry) => entry.name !== "" || entry.hasFile);
}

/**
 * Every problem at once.
 *
 * A student fixing one problem per submit, with a round trip between each,
 * gives up — which is why this returns a list rather than the first failure.
 */
export function validateCertificates(entries: readonly CertificateEntry[]): readonly string[] {
  const usable = usableCertificates(entries);
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of usable.entries()) {
    const label = entry.name === "" ? `Certificate ${index + 1}` : entry.name;

    if (entry.name === "") {
      problems.push(`Give ${label} a name, so it can be identified without opening it.`);
    } else if (seen.has(key(entry.name))) {
      problems.push(`${label} is listed more than once. Upload each certificate once.`);
    } else {
      seen.add(key(entry.name));
    }

    if (!entry.hasFile) {
      problems.push(`Upload the certificate for ${label}. A name on its own cannot be verified.`);
    }
  }

  return problems;
}

/**
 * Whether this certificate may be uploaded at all. F9.
 *
 * A student correcting a certificate removes it first, which makes the
 * replacement a deliberate act rather than a fourth copy nobody can tell apart.
 */
export function canUploadCertificate(
  name: string,
  alreadyOnFile: readonly string[],
): UploadDecision {
  if (name.trim() === "") {
    return { allowed: false, reason: "Name the certificate before uploading it." };
  }

  if (alreadyOnFile.some((existing) => key(existing) === key(name))) {
    return {
      allowed: false,
      reason: "You have already uploaded this certificate. Remove it first to replace it.",
    };
  }

  return { allowed: true };
}
