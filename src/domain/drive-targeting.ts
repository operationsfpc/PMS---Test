/**
 * Area targeting on the publish screen.
 *
 * A drive is targeted at COLLEGES. `drive_target_campuses` is the only thing
 * the database holds about geography, and both the read policy
 * (`drives_student_read`) and the apply gate decide on campus ids — never on a
 * city. So a city on this screen is a shortcut over the college list, not a
 * fact about the drive.
 *
 * It used to be sold as one. The chips were an independent selection, nothing
 * was persisted beside them, and a drive "targeted at Chennai" was in fact open
 * to every college in the roster — an empty link table means "any", so the
 * area the coordinator ticked silently widened the audience instead of narrowing
 * it (UAT 2026-10-15: "as per the area colleges not selecting").
 *
 * Deriving the cities FROM the colleges is what makes the preview and the
 * database agree: `evaluateEligibility`'s city rule, the student's own drive
 * list and this screen now read the same set.
 */

export interface CollegeOption {
  readonly name: string;
  /** Null when the college has no city on record — then no city filter reaches it. */
  readonly city: string | null;
  /**
   * A retired college stays in the list while a drive still targets it, so the
   * coordinator can see it and untick it. Hiding it left the drive carrying
   * targeting nobody could see or change.
   */
  readonly isActive: boolean;
}

/** The cities worth offering: only ones that actually hold a college. */
export function citiesOf(colleges: readonly CollegeOption[]): readonly string[] {
  return [
    ...new Set(
      colleges.map((college) => college.city).filter((city): city is string => city !== null),
    ),
  ].sort();
}

/** Colleges in these cities. No city chosen means the whole list — it is a filter. */
export function collegesIn(
  cities: readonly string[],
  colleges: readonly CollegeOption[],
): readonly CollegeOption[] {
  if (cities.length === 0) return colleges;
  return colleges.filter((college) => college.city !== null && cities.includes(college.city));
}

/** What a drive's city targeting actually is: the cities its chosen colleges sit in. */
export function citiesCoveredBy(
  colleges: readonly CollegeOption[],
  selected: readonly string[],
): readonly string[] {
  return citiesOf(colleges.filter((college) => selected.includes(college.name)));
}

export interface CityToggle {
  readonly cities: readonly string[];
  readonly colleges: readonly string[];
}

/**
 * Tick a city: every college in it joins the drive. Untick: they all leave.
 *
 * Both halves matter. Ticking without selecting is the bug above; deselecting
 * on untick is what stops a city being unticked while its students stay
 * targeted, which reads as a filter that does nothing.
 */
export function toggleCity(
  city: string,
  colleges: readonly CollegeOption[],
  selectedCities: readonly string[],
  selectedColleges: readonly string[],
): CityToggle {
  const inCity = collegesIn([city], colleges).map((college) => college.name);
  const turningOn = !selectedCities.includes(city);

  return {
    cities: turningOn ? [...selectedCities, city] : selectedCities.filter((c) => c !== city),
    colleges: turningOn
      ? [...selectedColleges, ...inCity.filter((name) => !selectedColleges.includes(name))]
      : selectedColleges.filter((name) => !inCity.includes(name)),
  };
}

/**
 * Every visible option already chosen.
 *
 * Tested against the visible set rather than by counting, because a narrowed
 * list can hold fewer options than the selection does — a "Select all" button
 * that counted its way to that answer offered to select everything while
 * showing three of twenty.
 */
export function areAllSelected(visible: readonly string[], selected: readonly string[]): boolean {
  return visible.length > 0 && visible.every((option) => selected.includes(option));
}

/** Add every visible option, or drop them all when they are already in. */
export function toggleVisibleSelection(
  visible: readonly string[],
  selected: readonly string[],
): readonly string[] {
  return areAllSelected(visible, selected)
    ? selected.filter((option) => !visible.includes(option))
    : [...selected, ...visible.filter((option) => !selected.includes(option))];
}

/** One option in or out, leaving the rest of the selection alone. */
export function toggleSelection(value: string, selected: readonly string[]): readonly string[] {
  return selected.includes(value)
    ? selected.filter((option) => option !== value)
    : [...selected, value];
}
