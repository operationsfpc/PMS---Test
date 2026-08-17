/**
 * Which sidebar groups are open.
 *
 * 2026-08-17 (Karthik): "Can you collapse the sub headings that are not in
 * use? Only the sub heading of the headings in use has to be expanded."
 *
 * Structural types, not the component's `NavGroup`: this layer may not import
 * from `src/components`, and the decision only ever needs a heading and a list
 * of paths. A component passing its own richer groups satisfies these.
 */

export interface NavItemShape {
  readonly to: string;
}

export interface NavGroupShape {
  readonly heading: string;
  readonly items: readonly NavItemShape[];
}

/** Trailing slashes come from real links and must not change any answer. */
function normalise(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * Is `path` at, or inside, `link`?
 *
 * The boundary check is what stops `/central/dr` from claiming `/central/drives`:
 * a prefix only counts if the next character starts a new segment. Without it
 * a heading would open for a route it has nothing to do with, which is a
 * confusing way to be wrong.
 */
function isInside(path: string, link: string): boolean {
  if (path === link) return true;
  if (link === "/") return false;
  return path.startsWith(`${link}/`);
}

/**
 * The headings to show expanded for the current path.
 *
 * The LONGEST matching link wins, because sidebars legitimately contain a
 * route and its own sub-routes (`/central/drives` alongside
 * `/central/drives/published`). Matching on any prefix would open the parent's
 * group while the reader is plainly in the child's.
 *
 * Returns every group holding that winning link: the same destination can
 * appear under two headings, and collapsing one of them would hide a heading
 * whose link is genuinely current.
 *
 * An unrecognised path opens nothing. Falling back to "open the first group"
 * would be a guess, and a guess here quietly tells the reader they are
 * somewhere they are not.
 */
export function openGroupHeadings(
  groups: readonly NavGroupShape[],
  pathname: string,
): readonly string[] {
  const path = normalise(pathname);

  let best = -1;
  for (const group of groups) {
    for (const item of group.items) {
      const link = normalise(item.to);
      if (isInside(path, link) && link.length > best) best = link.length;
    }
  }

  if (best === -1) return [];

  return groups
    .filter((group) =>
      group.items.some((item) => {
        const link = normalise(item.to);
        return isInside(path, link) && link.length === best;
      }),
    )
    .map((group) => group.heading);
}
