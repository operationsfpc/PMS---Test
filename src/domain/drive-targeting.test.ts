import { describe, expect, it } from "vitest";
import {
  areAllSelected,
  type CollegeOption,
  citiesCoveredBy,
  citiesOf,
  collegesIn,
  toggleCity,
  toggleSelection,
  toggleVisibleSelection,
} from "./drive-targeting";

/**
 * The one place the publish screen decides who geographically sees a drive.
 *
 * What these pin down is that a city is a SHORTCUT over colleges, never a
 * targeting of its own: only `drive_target_campuses` is persisted, so anything
 * this module says the drive does has to be expressible as a college list.
 */

const college = (
  name: string,
  city: string | null = "Chennai",
  isActive = true,
): CollegeOption => ({
  name,
  city,
  isActive,
});

const ROSTER: readonly CollegeOption[] = [
  college("Alliance University"),
  college("Ranchi University"),
  college("VIT Bangalore", "Bengaluru"),
  college("Christ University", "Bengaluru"),
  college("SACAS", null),
];

describe("the cities a college list offers", () => {
  it("names each city once, sorted", () => {
    expect(citiesOf(ROSTER)).toEqual(["Bengaluru", "Chennai"]);
  });

  it("offers no city that holds no college", () => {
    // A coordinator cannot target a city with nobody in it; offering one is
    // how a drive ends up "targeted" at nothing while open to everyone.
    expect(citiesOf([college("VIT Bangalore", "Bengaluru")])).toEqual(["Bengaluru"]);
  });

  it("leaves a college with no city on record out of every city, but not out of the list", () => {
    expect(collegesIn(["Chennai", "Bengaluru"], ROSTER).map((c) => c.name)).not.toContain("SACAS");
    expect(collegesIn([], ROSTER)).toHaveLength(5);
  });
});

describe("ticking a city", () => {
  it("selects every college in it", () => {
    expect(toggleCity("Bengaluru", ROSTER, [], [])).toEqual({
      cities: ["Bengaluru"],
      colleges: ["VIT Bangalore", "Christ University"],
    });
  });

  it("keeps colleges already chosen elsewhere", () => {
    const next = toggleCity("Bengaluru", ROSTER, [], ["Alliance University"]);

    expect(next.colleges).toEqual(["Alliance University", "VIT Bangalore", "Christ University"]);
  });

  it("unticks them again when the city is unticked", () => {
    const next = toggleCity(
      "Bengaluru",
      ROSTER,
      ["Bengaluru"],
      ["Alliance University", "VIT Bangalore", "Christ University"],
    );

    expect(next).toEqual({ cities: [], colleges: ["Alliance University"] });
  });

  it("leaves a college that answers to no city alone either way", () => {
    const on = toggleCity("Chennai", ROSTER, [], ["SACAS"]);
    expect(on.colleges).toContain("SACAS");

    const off = toggleCity("Chennai", ROSTER, ["Chennai"], ["SACAS"]);
    expect(off.colleges).toEqual(["SACAS"]);
  });
});

describe("the cities a selection of colleges covers", () => {
  it("is derived from the colleges, not from what happened to be ticked", () => {
    // The city rule in `evaluateEligibility` and the student's own drive list
    // both read cities off the targeted campuses; the preview has to.
    expect(citiesCoveredBy(ROSTER, ["VIT Bangalore"])).toEqual(["Bengaluru"]);
    expect(citiesCoveredBy(ROSTER, ["Alliance University", "Christ University"])).toEqual([
      "Bengaluru",
      "Chennai",
    ]);
  });

  it("is empty when the whole roster is targeted, which is what 'any' means", () => {
    expect(citiesCoveredBy(ROSTER, [])).toEqual([]);
  });
});

describe("select all, over a list that may be narrowed", () => {
  const names = ROSTER.map((c) => c.name);
  const visible = collegesIn(["Bengaluru"], ROSTER).map((c) => c.name);

  it("adds the visible ones without touching the rest", () => {
    expect(toggleVisibleSelection(visible, ["Alliance University"])).toEqual([
      "Alliance University",
      "VIT Bangalore",
      "Christ University",
    ]);
  });

  it("clears the visible ones when they are all already in", () => {
    expect(toggleVisibleSelection(visible, ["Alliance University", ...visible])).toEqual([
      "Alliance University",
    ]);
  });

  /** The bug: the button's label and its action each computed their own answer. */
  it("labels itself by the same test it acts on", () => {
    const selected = toggleVisibleSelection(visible, []);

    expect(areAllSelected(visible, selected)).toBe(true);
    expect(areAllSelected(names, selected)).toBe(false);
  });

  it("never calls an empty list fully selected", () => {
    expect(areAllSelected([], [])).toBe(false);
  });
});

describe("ticking one option", () => {
  it("adds it, and removes it on the second press", () => {
    const once = toggleSelection("CSE", ["BCA"]);

    expect(once).toEqual(["BCA", "CSE"]);
    expect(toggleSelection("CSE", once)).toEqual(["BCA"]);
  });
});
