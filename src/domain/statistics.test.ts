import { describe, expect, it } from "vitest";
import { computePlacementStats, type PlacementStatsInput } from "./statistics";

/**
 * Placement statistics.
 *
 * The denominator is the number everyone argues about, so it is a domain rule
 * with tests rather than a SELECT someone tweaks. Domain model 7:
 *
 *  - an opted-out student leaves the denominator entirely and is reported on
 *    their own line
 *  - a self-placed offer is a separate statistic and never counts as an
 *    on-campus placement
 */
const student = (over: Partial<PlacementStatsInput["students"][number]> = {}) => ({
  studentId: "s1",
  participationStatus: "active" as const,
  hasOnCampusPlacement: false,
  hasSelfPlacement: false,
  ...over,
});

describe("computePlacementStats", () => {
  it("counts a placed student against an eligible cohort", () => {
    const stats = computePlacementStats({
      students: [
        student({ studentId: "a", hasOnCampusPlacement: true }),
        student({ studentId: "b" }),
      ],
    });

    expect(stats.eligible).toBe(2);
    expect(stats.placed).toBe(1);
    expect(stats.placementRate).toBe(50);
  });

  it("removes an opted-out student from the denominator entirely", () => {
    const stats = computePlacementStats({
      students: [
        student({ studentId: "a", hasOnCampusPlacement: true }),
        student({ studentId: "b", participationStatus: "opted_out" }),
      ],
    });

    expect(stats.eligible).toBe(1);
    expect(stats.placed).toBe(1);
    expect(stats.placementRate).toBe(100);
    expect(stats.optedOut).toBe(1);
  });

  it("reports self-placement on its own line, never as an on-campus placement", () => {
    const stats = computePlacementStats({
      students: [student({ studentId: "a", hasSelfPlacement: true }), student({ studentId: "b" })],
    });

    expect(stats.placed).toBe(0);
    expect(stats.selfPlaced).toBe(1);
    expect(stats.placementRate).toBe(0);
  });

  it("counts a student who is both placed on campus and self-placed once in each line", () => {
    const stats = computePlacementStats({
      students: [student({ hasOnCampusPlacement: true, hasSelfPlacement: true })],
    });

    expect(stats.placed).toBe(1);
    expect(stats.selfPlaced).toBe(1);
    expect(stats.placementRate).toBe(100);
  });

  /**
   * A disbarment is a sanction, not a withdrawal. The student stays in the
   * denominator - removing them would flatter the rate by punishing them
   * twice.
   */
  it("keeps a disbarred student in the denominator", () => {
    const stats = computePlacementStats({
      students: [
        student({ studentId: "a", hasOnCampusPlacement: true }),
        student({ studentId: "b", participationStatus: "disbarred" }),
      ],
    });

    expect(stats.eligible).toBe(2);
    expect(stats.placementRate).toBe(50);
  });

  it("reports a rate of zero for an empty cohort rather than dividing by zero", () => {
    const stats = computePlacementStats({ students: [] });

    expect(stats.eligible).toBe(0);
    expect(stats.placementRate).toBe(0);
  });

  it("reports a rate of zero when everyone has opted out", () => {
    const stats = computePlacementStats({
      students: [student({ participationStatus: "opted_out" })],
    });

    expect(stats.eligible).toBe(0);
    expect(stats.placementRate).toBe(0);
    expect(stats.optedOut).toBe(1);
  });

  it("rounds the rate to one decimal, so 1 of 3 does not print forever", () => {
    const stats = computePlacementStats({
      students: [
        student({ studentId: "a", hasOnCampusPlacement: true }),
        student({ studentId: "b" }),
        student({ studentId: "c" }),
      ],
    });

    expect(stats.placementRate).toBe(33.3);
  });
});
