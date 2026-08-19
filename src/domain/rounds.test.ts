import { describe, expect, it } from "vitest";
import {
  advancedBeyond,
  advancingParticipants,
  canMarkAttendance,
  canRecordResult,
} from "./rounds";

/**
 * Round progression (domain-model §5, decisions Q9 and Q10).
 *
 * Q9: round 1's participants are chosen by the RECRUITER from the exported
 * applicant list, not by us. A student who applied but was never called can
 * therefore never accrue an absence.
 *
 * Q10: only `selected` advances. `waitlisted` and `on_hold` are not scheduled
 * until the Central CPC promotes them.
 */
const results = [
  { studentId: "a", result: "selected" as const },
  { studentId: "b", result: "rejected" as const },
  { studentId: "c", result: "waitlisted" as const },
  { studentId: "d", result: "on_hold" as const },
  { studentId: "e", result: "selected" as const },
];

describe("advancingParticipants", () => {
  it("advances only the selected", () => {
    expect(advancingParticipants(results)).toEqual(["a", "e"]);
  });

  it("does not advance the waitlisted until they are promoted", () => {
    expect(advancingParticipants(results)).not.toContain("c");
  });

  it("does not advance the on-hold", () => {
    expect(advancingParticipants(results)).not.toContain("d");
  });

  it("advances a promoted student once their result becomes selected", () => {
    const promoted = results.map((r) =>
      r.studentId === "c" ? { ...r, result: "selected" as const } : r,
    );
    expect(advancingParticipants(promoted)).toContain("c");
  });

  it("returns nobody when a round eliminated everyone", () => {
    expect(advancingParticipants([{ studentId: "a", result: "rejected" }])).toEqual([]);
  });
});

describe("canMarkAttendance", () => {
  it("allows a coordinator to mark a scheduled student", () => {
    expect(canMarkAttendance("campus_placement_coordinator", true).allowed).toBe(true);
    expect(canMarkAttendance("central_placement_coordinator", true).allowed).toBe(true);
  });

  it("refuses a student who was never scheduled - they cannot accrue an absence", () => {
    const result = canMarkAttendance("campus_placement_coordinator", false);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toMatch(/scheduled/i);
  });

  it.each(["account_executive", "student", "ceo", "er_head"] as const)(
    "refuses %s, who may never mark attendance",
    (role) => {
      expect(canMarkAttendance(role, true).allowed).toBe(false);
    },
  );
});

describe("canRecordResult", () => {
  it("allows the Central CPC", () => {
    expect(canRecordResult("central_placement_coordinator", true).allowed).toBe(true);
  });

  it("refuses a result for a student who never took the round", () => {
    const result = canRecordResult("central_placement_coordinator", false);
    expect(result.allowed).toBe(false);
  });

  it.each(["account_executive", "student", "campus_manager"] as const)("refuses %s", (role) => {
    expect(canRecordResult(role, true).allowed).toBe(false);
  });
});

/**
 * F1 (UAT 2026-08-19): "Round progression should be strictly linear …
 * Currently, the CPC can change a student's selection status after they've
 * already advanced, which corrupts results in later rounds."
 *
 * A student who sits in Round 3 got there THROUGH Round 2's `selected`.
 * Re-recording Round 2 as `rejected` would leave them participating in a
 * round their own history now says they never reached.
 */
describe("advancedBeyond", () => {
  const rounds = [
    { sequence: 1, applicationIds: ["a", "b", "c"] },
    { sequence: 2, applicationIds: ["a", "b"] },
    { sequence: 3, applicationIds: ["a"] },
  ];

  it("locks a student's earlier rounds once they sit in a later one", () => {
    const locked = advancedBeyond(1, rounds);
    expect(locked.has("a")).toBe(true);
    expect(locked.has("b")).toBe(true);
  });

  it("does not lock a student in their LATEST round", () => {
    expect(advancedBeyond(2, rounds).has("b")).toBe(false);
    expect(advancedBeyond(3, rounds).has("a")).toBe(false);
  });

  it("locks nobody when no later round has participants", () => {
    expect(advancedBeyond(3, rounds).size).toBe(0);
  });

  it("never locks a student who was not advanced", () => {
    expect(advancedBeyond(1, rounds).has("c")).toBe(false);
  });
});
