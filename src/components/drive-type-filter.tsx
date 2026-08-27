import {
  DRIVE_TYPE_FILTERS,
  type DriveTypeFilter as DriveTypeFilterValue,
} from "@domain/drive-type";

/**
 * The drive-type filter every drive list shares.
 *
 * Karthik, 2026-08-27: "let us add a filter on top of this page to select
 * drives of a particular type (Internship / Internship convertible to FT and
 * Full Time)."
 *
 * One component and one domain predicate (`matchesDriveType`), for the same
 * reason `DriveSort` exists: five screens show this, and a bucket that means
 * something different on two of them is worse than no filter at all.
 *
 * Chips rather than a dropdown, because the whole set is four items and the
 * question "what else could I be looking at?" is answered without a click.
 * `aria-pressed` carries the state, so the choice is not conveyed by colour
 * alone.
 */
export function DriveTypeFilter({
  value,
  onChange,
  counts,
}: {
  value: DriveTypeFilterValue;
  onChange: (value: DriveTypeFilterValue) => void;
  /** How many drives are in each bucket. Omitted where counting is not cheap. */
  counts?: Partial<Record<DriveTypeFilterValue, number>>;
}) {
  return (
    // A real <fieldset>/<legend>, not role="group" on a div: the semantics
    // are the same to a screen reader and the element is the one HTML already
    // has for "these controls belong together".
    <fieldset className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
      <legend className="sr-only">Drive type</legend>
      <span aria-hidden="true" className="text-xs font-semibold text-ink-500">
        Type
      </span>
      {DRIVE_TYPE_FILTERS.map((option) => {
        const selected = option.value === value;
        const count = counts?.[option.value];
        return (
          <button
            key={option.value === "" ? "all" : option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
              selected
                ? "border-[#3D3777] bg-[#3D3777] text-white"
                : "border-line bg-white text-ink-700 hover:border-[#A46AFC]"
            }`}
          >
            {option.label}
            {/* The space is not decoration: without it the accessible name
                reads "Internship2", which is what a screen reader says. */}
            {count !== undefined && (
              <>
                {" "}
                <span className={`font-medium ${selected ? "opacity-70" : "text-ink-500"}`}>
                  {count}
                </span>
              </>
            )}
          </button>
        );
      })}
    </fieldset>
  );
}
