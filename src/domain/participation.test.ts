import { describe, expect, it } from "vitest";
import {
  canApproveParticipationChange,
  canRecordSelfPlacement,
  canRequestOptOut,
} from "./participation";
import { APP_ROLES } from "./types";

/**
 * Opting out and self-placing.
 *
 * Opt-out is student-initiated ONLY - never triggered by CGPA or any system
 * rule - CPC-approved, and irreversible. Self-placement is a separate
 * statistic that must never touch the ladder or eligibility (PRD 16.2).
 */
describe("canRequestOptOut", () => {
  it("lets an active student opt out", () => {
    expect(canRequestOptOut({ participationStatus: "active", hasPendingRequest: false })).toEqual({
      allowed: true,
    });
  });

  it("refuses a student who has already opted out: it is irreversible, not a toggle", () => {
    const decision = canRequestOptOut({
      participationStatus: "opted_out",
      hasPendingRequest: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/already opted out/i);
  });

  it("refuses a disbarred student, whose exclusion is a sanction not a choice", () => {
    const decision = canRequestOptOut({
      participationStatus: "disbarred",
      hasPendingRequest: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/disbarred/i);
  });

  it("refuses a second request while one is already pending", () => {
    const decision = canRequestOptOut({ participationStatus: "active", hasPendingRequest: true });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/already waiting/i);
  });
});

describe("canRecordSelfPlacement", () => {
  it("lets an active student record an off-campus offer", () => {
    expect(canRecordSelfPlacement({ participationStatus: "active" })).toEqual({ allowed: true });
  });

  it("still lets an opted-out student record one: they left to take a job", () => {
    expect(canRecordSelfPlacement({ participationStatus: "opted_out" })).toEqual({ allowed: true });
  });

  it("refuses a disbarred student", () => {
    const decision = canRecordSelfPlacement({ participationStatus: "disbarred" });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/disbarred/i);
  });
});

describe("canApproveParticipationChange", () => {
  it("is the coordinators' decision", () => {
    expect(canApproveParticipationChange("campus_placement_coordinator")).toEqual({
      allowed: true,
    });
    expect(canApproveParticipationChange("central_placement_coordinator")).toEqual({
      allowed: true,
    });
  });

  it("refuses everybody else, including the student themselves", () => {
    const others = APP_ROLES.filter(
      (r) => r !== "campus_placement_coordinator" && r !== "central_placement_coordinator",
    );
    for (const role of others) {
      const decision = canApproveParticipationChange(role);
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toMatch(/coordinator/i);
    }
  });
});
