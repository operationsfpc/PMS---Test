import { describe, expect, it } from "vitest";
import { type PlacementCounts, summarisePlacementTotals } from "./placement-totals";
import { computePlacementStats } from "./statistics";

/**
 * The organisation's placement figures, computed from COUNTS rather than from
 * a list of students.
 *
 * The Account Executive may not read the roster (option A, approved
 * 2026-08-26): they receive aggregates from a `security definer` function and
 * never a student record. The published RATE still has to be this system's
 * rate, so it is computed here — the same rule, the same rounding, one place.
 */
const counts = (over: Partial<PlacementCounts> = {}): PlacementCounts => ({
  eligible: 0,
  placed: 0,
  selfPlaced: 0,
  optedOut: 0,
  completedDrives: 0,
  ...over,
});

describe("summarisePlacementTotals", () => {
  it("expresses the placed as a percentage of the eligible", () => {
    expect(summarisePlacementTotals(counts({ eligible: 598, placed: 231 })).placementRate).toBe(
      38.6,
    );
  });

  it("publishes one decimal, never a repeating fraction", () => {
    expect(summarisePlacementTotals(counts({ eligible: 3, placed: 1 })).placementRate).toBe(33.3);
  });

  /** No students means no rate. NaN and 100% are both lies a screen would render. */
  it("is zero per cent when nobody is eligible", () => {
    expect(summarisePlacementTotals(counts({ eligible: 0, placed: 0 })).placementRate).toBe(0);
  });

  it("carries every count through untouched", () => {
    expect(
      summarisePlacementTotals(
        counts({ eligible: 10, placed: 4, selfPlaced: 2, optedOut: 1, completedDrives: 7 }),
      ),
    ).toEqual({
      eligible: 10,
      placed: 4,
      selfPlaced: 2,
      optedOut: 1,
      completedDrives: 7,
      placementRate: 40,
    });
  });

  /**
   * The guard that matters: this must agree with `computePlacementStats`, the
   * function every other screen calls. Two ways of saying "placement rate" is
   * how two departments come to quote different numbers from one database.
   */
  it("agrees with computePlacementStats on the same cohort", () => {
    const students = [
      {
        studentId: "a",
        participationStatus: "active" as const,
        hasOnCampusPlacement: true,
        hasSelfPlacement: false,
      },
      {
        studentId: "b",
        participationStatus: "active" as const,
        hasOnCampusPlacement: false,
        hasSelfPlacement: true,
      },
      {
        studentId: "c",
        participationStatus: "active" as const,
        hasOnCampusPlacement: false,
        hasSelfPlacement: false,
      },
      {
        studentId: "d",
        participationStatus: "opted_out" as const,
        hasOnCampusPlacement: false,
        hasSelfPlacement: false,
      },
    ];
    const fromRows = computePlacementStats({ students });

    const fromCounts = summarisePlacementTotals(
      counts({
        eligible: fromRows.eligible,
        placed: fromRows.placed,
        selfPlaced: fromRows.selfPlaced,
        optedOut: fromRows.optedOut,
      }),
    );

    expect(fromCounts.placementRate).toBe(fromRows.placementRate);
    expect(fromCounts.eligible).toBe(3);
    expect(fromCounts.placed).toBe(1);
  });
});
