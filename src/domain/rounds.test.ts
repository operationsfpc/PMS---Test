import { describe, expect, it } from "vitest";
import { advancingParticipants, canMarkAttendance, canRecordResult } from "./rounds";

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
