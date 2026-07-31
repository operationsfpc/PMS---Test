import { describe, expect, it } from "vitest";
import {
  ABSENCE_LIMIT,
  type AttendanceRecord,
  countAbsences,
  isScheduledForNextRound,
  needsDisbarmentReview,
} from "./attendance";

const record = (over: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  driveId: "d1",
  roundId: "r1",
  status: "absent",
  ...over,
});

/** R8 — absences accumulate across all drives for the student's entire tenure. */
describe("countAbsences", () => {
  it("counts nothing for a student with no records", () => {
    expect(countAbsences([])).toBe(0);
  });

  it("counts confirmed absences", () => {
    expect(countAbsences([record(), record({ roundId: "r2" })])).toBe(2);
  });

  it("accumulates across different drives — there is no per-drive reset", () => {
    expect(countAbsences([record({ driveId: "d1" }), record({ driveId: "d2" })])).toBe(2);
  });

  it("ignores present records", () => {
    expect(countAbsences([record({ status: "present" }), record({ roundId: "r2" })])).toBe(1);
  });

  it("ignores merely scheduled rounds that have not happened yet", () => {
    expect(countAbsences([record({ status: "scheduled" })])).toBe(0);
  });

  it("ignores provisional QR check-ins until a coordinator confirms them", () => {
    expect(countAbsences([record({ status: "provisional" })])).toBe(0);
  });
});

describe("needsDisbarmentReview", () => {
  it("uses a limit of three", () => {
    expect(ABSENCE_LIMIT).toBe(3);
  });

  it.each([0, 1, 2])("does not trigger at %i absences", (n) => {
    expect(needsDisbarmentReview(n)).toBe(false);
  });

  it("triggers at exactly three absences", () => {
    expect(needsDisbarmentReview(3)).toBe(true);
  });

  it("stays triggered beyond three — there is no reset", () => {
    expect(needsDisbarmentReview(7)).toBe(true);
  });
});

/**
 * Decision Q10 — only `selected` advances. Waitlisted and on-hold students are
 * not scheduled, so they cannot accrue an absence, until promoted.
 */
describe("isScheduledForNextRound", () => {
  it("schedules a selected student", () => {
    expect(isScheduledForNextRound("selected")).toBe(true);
  });

  it.each(["rejected", "waitlisted", "on_hold"] as const)("does not schedule %s", (result) => {
    expect(isScheduledForNextRound(result)).toBe(false);
  });
});
