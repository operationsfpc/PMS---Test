/**
 * Storage paths, as this system actually stores them.
 *
 * `student_documents.storage_path` carries two conventions, and both are in
 * live data:
 *
 *  - **bare** `<student>/<file>` — marksheets, certificates, offer letters and
 *    profile resumes. Their readers call `storage.from(<bucket>).download()`
 *    with exactly this.
 *  - **bucket-prefixed** `<bucket>/<student>/<file>` — participation evidence,
 *    where one column deliberately serves two buckets and the reader splits
 *    the bucket back off.
 *
 * The apply-time resume was written prefixed and read bare, so the recruiter
 * export asked the `resumes` bucket for `resumes/<student>/<file>` and was
 * correctly told no such object exists. Every export died on the first
 * resume it touched.
 *
 * The writer has been corrected and the rows repaired (0063), but this stays:
 * a reader that only works for one of two conventions is the bug, and the next
 * uploader will make the same mistake.
 */

/**
 * The object key inside `bucket`, whether or not the path was stored with the
 * bucket in front of it.
 *
 * Only a leading `<bucket>/` is removed, and only once. A folder named for its
 * bucket is legal — `<student>/resumes/cv.pdf` is a different object from
 * `resumes/<student>/cv.pdf`, and quietly rewriting either would swap one file
 * for another.
 */
export function objectKeyIn(bucket: string, storagePath: string): string {
  const prefix = `${bucket}/`;
  if (!storagePath.startsWith(prefix)) return storagePath;

  const key = storagePath.slice(prefix.length);
  // "resumes/" names no object. Returning "" would ask storage for the bucket
  // root and read as a mystery rather than as the malformed row it is.
  return key === "" ? storagePath : key;
}

/**
 * Extracts the original uploaded filename from a stored path.
 *
 * Stored paths typically follow:
 *   `<student>/<slot>-<timestamp>-<originalFilename>`
 *   `<student>/certificate-<timestamp>-<originalFilename>`
 *   or `<bucket>/<student>/<timestamp>-<originalFilename>`
 */
export function extractOriginalFilename(storagePath: string | null | undefined): string | null {
  if (storagePath === null || storagePath === undefined || storagePath.trim() === "") {
    return null;
  }

  const basename = storagePath.split("/").pop() ?? "";
  if (basename === "") return null;

  // Match prefixes like `certificate-0-1787027936502-`, `certificate-1787027936502-`, or `1787027936502-`
  const match = /^(?:[a-zA-Z0-9_]+-)*\d{10,}-(.+)$/.exec(basename);
  return match?.[1] ?? basename;
}

/**
 * Derives a readable certificate name from an uploaded file name.
 *
 * Strips the extension and replaces underscores/dashes with spaces.
 * e.g. "AWS_Cloud_Practitioner.pdf" -> "AWS Cloud Practitioner"
 */
export function filenameToCertificateName(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, "");
  return withoutExt.replaceAll(/[-_]+/g, " ").trim();
}

/**
 * Sanitizes a filename for use in Supabase Storage object keys.
 *
 * Supabase Storage rejects object keys containing square brackets, curly braces,
 * double quotes, percent signs, control characters, or non-ASCII characters with 400 Bad Request.
 */
export function sanitizeStorageFileName(filename: string): string {
  if (!filename) return "file";
  return filename
    .replace(/[\[{]/g, "(")
    .replace(/[\]}]/g, ")")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["%\\^`|<>\/]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

