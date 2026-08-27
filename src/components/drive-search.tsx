import { useId } from "react";

/**
 * One search box for every screen that lists drives.
 *
 * Asked for twice on 2026-08-18 — on the Live list, then on the campus
 * coordinator's Drive progress — which is exactly why it is a component and not
 * two hand-rolled inputs. The matching itself is `searchDrives` in the domain,
 * so what "hcl" finds cannot differ between screens either.
 *
 * The list narrows as you type; the button submits nothing. It is there because
 * a bare box reads as decoration, and because a keyboard needs somewhere
 * obvious to land.
 */
export function DriveSearch({
  value,
  onChange,
  label = "Search drives",
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const id = useId();

  return (
    <search className="mb-6">
      <form onSubmit={(e) => e.preventDefault()}>
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-700">
          {label}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={id}
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Company or role — e.g. HCL, or trainee"
            className="w-full max-w-sm rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Search
          </button>
        </div>
      </form>
    </search>
  );
}

/**
 * What every list says when nothing matches. One sentence, one place.
 *
 * 2026-08-27: it now names the TYPE filter too. "Nothing to show" over a
 * filtered list reads as a broken screen, and the reader has no way to tell
 * an empty bucket from a fault.
 */
export function NoDriveMatches({
  query,
  typeLabel,
}: {
  query: string;
  /** The chosen drive type, in words. Omitted when the filter is on All. */
  typeLabel?: string;
}) {
  if (query.trim() === "" && typeLabel !== undefined) {
    return (
      <p className="text-sm text-ink-700">
        No {typeLabel.toLowerCase()} drives in this list. Choose “All” to see the whole list.
      </p>
    );
  }

  return (
    <p className="text-sm text-ink-700">
      No drives match “{query}”
      {typeLabel === undefined ? "" : ` among ${typeLabel.toLowerCase()} drives`}. Clear the search
      to see the whole list.
    </p>
  );
}
