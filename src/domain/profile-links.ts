/**
 * Profiles beyond the four the form names.
 *
 * Asked for 2026-08-06: "in professional profiles, have field to enter others
 * also. they can add fields, give a name and mention the url/user name."
 *
 * The form hard-coded LinkedIn, GitHub, LeetCode and HackerRank. A student
 * with a Kaggle profile, a Behance portfolio, a Codeforces handle or their own
 * site had nowhere to put it — and for many students those are the strongest
 * evidence they have.
 *
 * "url/user name" is the load-bearing part of the request. A Codeforces handle
 * is not a URL, and demanding one would refuse exactly the entries this exists
 * to capture. So a value is checked for being SOMETHING, not for being a URL.
 */

export interface ProfileLink {
  /** What it is: "Kaggle", "Portfolio", "Codeforces". */
  readonly label: string;
  /** Where to find them: a URL or a username, either is fine. */
  readonly value: string;
}

/**
 * ⚠️ ASSUMPTION — UNCONFIRMED (A34). Eight is a generous ceiling for "other"
 * profiles; past that a recruiter stops reading and it starts to look like
 * padding. Nothing depends on the exact number.
 */
export const MAX_OTHER_PROFILES = 8;

const isBlank = (value: string) => value.trim() === "";

/** A row the student added and never filled in. Not an error — just noise. */
const isEmptyRow = (link: ProfileLink) => isBlank(link.label) && isBlank(link.value);

/**
 * Trims, and drops rows left completely empty.
 *
 * A HALF-filled row is kept deliberately, so validation can point at it. The
 * alternative — dropping it quietly — discards something the student typed and
 * leaves them wondering where it went.
 */
export function normaliseProfileLinks(links: readonly ProfileLink[]): readonly ProfileLink[] {
  return links
    .map((link) => ({ label: link.label.trim(), value: link.value.trim() }))
    .filter((link) => !isEmptyRow(link));
}

/** Every problem at once — a student fixing one at a time gives up. */
export function validateProfileLinks(links: readonly ProfileLink[]): readonly string[] {
  const entries = normaliseProfileLinks(links);
  const problems: string[] = [];

  if (entries.length > MAX_OTHER_PROFILES) {
    problems.push(`You can add up to ${MAX_OTHER_PROFILES} other profiles.`);
  }

  const seen = new Set<string>();

  for (const entry of entries) {
    if (isBlank(entry.value)) {
      problems.push(`Add the link or username for "${entry.label}".`);
    } else if (isBlank(entry.label)) {
      // An address with no name tells a recruiter nothing about what it is.
      problems.push(`Give a name to the profile at "${entry.value}".`);
    }

    // Case-insensitively, because "Portfolio" and "portfolio" are the same
    // thing to the person reading them.
    const key = entry.label.toLowerCase();
    if (key !== "" && seen.has(key)) {
      problems.push(`You have two profiles called "${entry.label}".`);
    }
    seen.add(key);
  }

  return problems;
}
