import { describe, expect, it } from "vitest";
import { checkShortlistTarget } from "./shortlist-target";

/**
 * UAT 2026-08-26: the target shortlist size was set to 1, two candidates were
 * ticked, and the screen said "2 of 1 selected" and saved without comment.
 * Saving notifies students and schedules Round 1 — so a count that does not
 * match what the recruiter asked for has to be said out loud, in the
 * confirmation that already guards the save.
 *
 * The target stays ADVISORY (D6, 2026-08-19): the Central CPC may knowingly
 * send more or fewer. This rule warns; it never refuses.
 */
describe("checkShortlistTarget", () => {
  it("has nothing to say when no target was set — the field is optional", () => {
    expect(checkShortlistTarget({ target: "", count: 2 })).toEqual({
      status: "no_target",
      target: null,
      count: 2,
      difference: 0,
      message: null,
    });
  });

  it("treats a blank, zero, negative or junk target as no target at all", () => {
    for (const target of ["   ", "0", "-3", "abc", null, undefined]) {
      expect(checkShortlistTarget({ target, count: 2 }).status).toBe("no_target");
    }
  });

  it("is silent when the count matches the target exactly", () => {
    expect(checkShortlistTarget({ target: "3", count: 3 })).toEqual({
      status: "on_target",
      target: 3,
      count: 3,
      difference: 0,
      message: null,
    });
  });

  it("warns — with the singular — when one more than asked for is selected", () => {
    expect(checkShortlistTarget({ target: 1, count: 2 })).toEqual({
      status: "over_target",
      target: 1,
      count: 2,
      difference: 1,
      message: "2 students selected against a target of 1 — 1 more than the recruiter asked for.",
    });
  });

  it("warns in the plural when several more than asked for are selected", () => {
    expect(checkShortlistTarget({ target: 5, count: 8 }).message).toBe(
      "8 students selected against a target of 5 — 3 more than the recruiter asked for.",
    );
  });

  it("warns when fewer than asked for are selected", () => {
    expect(checkShortlistTarget({ target: 5, count: 4 })).toEqual({
      status: "under_target",
      target: 5,
      count: 4,
      difference: -1,
      message: "4 students selected against a target of 5 — 1 fewer than the recruiter asked for.",
    });
  });

  it("says 'student' in the singular when exactly one is selected", () => {
    expect(checkShortlistTarget({ target: 4, count: 1 }).message).toBe(
      "1 student selected against a target of 4 — 3 fewer than the recruiter asked for.",
    );
  });

  it("warns when nothing is selected against a target — an empty shortlist is a mistake", () => {
    expect(checkShortlistTarget({ target: 2, count: 0 }).status).toBe("under_target");
  });

  it("ignores a fractional target rather than inventing half a seat", () => {
    expect(checkShortlistTarget({ target: "2.5", count: 2 }).status).toBe("no_target");
  });
});
