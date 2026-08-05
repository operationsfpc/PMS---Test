import { describe, expect, it } from "vitest";
import {
  canApproveParticipationChange,
  canDeclineParticipationRequest,
  canRecordSelfPlacement,
  canRequestOptOut,
  participationOutcome,
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
    expect(
      canRequestOptOut({
        participationStatus: "active",
        hasPendingRequest: false,
        hasDeclaration: true,
      }),
    ).toEqual({
      allowed: true,
    });
  });

  it("refuses a student who has already opted out: it is irreversible, not a toggle", () => {
    const decision = canRequestOptOut({
      participationStatus: "opted_out",
      hasPendingRequest: false,
      hasDeclaration: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/already opted out/i);
  });

  it("refuses a disbarred student, whose exclusion is a sanction not a choice", () => {
    const decision = canRequestOptOut({
      participationStatus: "disbarred",
      hasPendingRequest: false,
      hasDeclaration: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/disbarred/i);
  });

  it("refuses a second request while one is already pending", () => {
    const decision = canRequestOptOut({
      participationStatus: "active",
      hasPendingRequest: true,
      hasDeclaration: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/already waiting/i);
  });
});

describe("canRecordSelfPlacement", () => {
  it("lets an active student record an off-campus offer", () => {
    expect(canRecordSelfPlacement({ participationStatus: "active", hasOfferLetter: true })).toEqual(
      { allowed: true },
    );
  });

  it("still lets an opted-out student record one: they left to take a job", () => {
    expect(
      canRecordSelfPlacement({ participationStatus: "opted_out", hasOfferLetter: true }),
    ).toEqual({ allowed: true });
  });

  it("refuses a disbarred student", () => {
    const decision = canRecordSelfPlacement({
      participationStatus: "disbarred",
      hasOfferLetter: true,
    });
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

/**
 * Evidence, required from UAT 2026-08-05.
 *
 * Both of these decisions are irreversible in practice - an approved opt-out
 * can never be undone, and a self-placement becomes a number the college
 * reports - so neither may rest on a student's word alone. The rule lives here
 * so the screen, the repository and the database all refuse for the same
 * reason and say the same thing.
 */
describe("evidence for a participation decision", () => {
  it("refuses an opt-out with no signed declaration attached", () => {
    const decision = canRequestOptOut({
      participationStatus: "active",
      hasPendingRequest: false,
      hasDeclaration: false,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/declaration/i);
  });

  it("allows one that carries the declaration", () => {
    expect(
      canRequestOptOut({
        participationStatus: "active",
        hasPendingRequest: false,
        hasDeclaration: true,
      }).allowed,
    ).toBe(true);
  });

  /**
   * Order matters: a student who has already opted out should be told THAT,
   * not asked for a document they no longer need.
   */
  it("tells an already opted-out student why, rather than asking for a document", () => {
    const decision = canRequestOptOut({
      participationStatus: "opted_out",
      hasPendingRequest: false,
      hasDeclaration: false,
    });

    if (!decision.allowed) expect(decision.reason).toMatch(/already opted out/i);
  });

  it("refuses a self-placement with no offer letter attached", () => {
    const decision = canRecordSelfPlacement({
      participationStatus: "active",
      hasOfferLetter: false,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/offer letter/i);
  });

  it("allows one that carries the offer letter", () => {
    expect(
      canRecordSelfPlacement({ participationStatus: "active", hasOfferLetter: true }).allowed,
    ).toBe(true);
  });

  it("still refuses a disbarred student before asking for any document", () => {
    const decision = canRecordSelfPlacement({
      participationStatus: "disbarred",
      hasOfferLetter: true,
    });

    if (!decision.allowed) expect(decision.reason).toMatch(/disbarred/i);
  });
});

/**
 * F1 (UAT 2026-08-06): "central placement coordinator should have - decline
 * button with reason. The status of approval or rejection should go to
 * student."
 */
describe("canDeclineParticipationRequest", () => {
  it("refuses anyone who is not a placement coordinator", () => {
    const decision = canDeclineParticipationRequest("student", "Not enough evidence");

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/coordinator/i);
  });

  /**
   * The reason is the whole point. A decline the student cannot understand is
   * indistinguishable from the request never having been read, and this is the
   * only message they will get.
   */
  it("refuses a decline with no reason", () => {
    const decision = canDeclineParticipationRequest("central_placement_coordinator", "   ");

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/reason/i);
  });

  it("refuses a reason too short to mean anything", () => {
    const decision = canDeclineParticipationRequest("central_placement_coordinator", "no");

    expect(decision.allowed).toBe(false);
  });

  it("allows a coordinator who has said why", () => {
    expect(
      canDeclineParticipationRequest(
        "central_placement_coordinator",
        "The uploaded letter is unreadable.",
      ).allowed,
    ).toBe(true);
  });

  it("allows the campus coordinator too — they approve, so they may decline", () => {
    expect(
      canDeclineParticipationRequest(
        "campus_placement_coordinator",
        "The uploaded letter is unreadable.",
      ).allowed,
    ).toBe(true);
  });
});

/**
 * F3 (UAT 2026-08-06): "After the approval of the Self offer letter, the
 * student is not able to go back to check the submission and approval status
 * of it. It should be shown."
 */
describe("participationOutcome", () => {
  it("says a request is still waiting", () => {
    const outcome = participationOutcome({ status: "pending", reason: null });

    expect(outcome.tone).toBe("waiting");
    expect(outcome.label).toMatch(/waiting/i);
  });

  it("says a request was approved", () => {
    const outcome = participationOutcome({ status: "verified", reason: null });

    expect(outcome.tone).toBe("approved");
    expect(outcome.label).toMatch(/approved/i);
  });

  /** The coordinator's words, verbatim — nothing else explains the decision. */
  it("carries the coordinator's reason back to the student on a decline", () => {
    const outcome = participationOutcome({
      status: "rejected",
      reason: "The uploaded letter is unreadable.",
    });

    expect(outcome.tone).toBe("declined");
    expect(outcome.label).toMatch(/declined/i);
    expect(outcome.detail).toBe("The uploaded letter is unreadable.");
  });

  /**
   * A decline with no reason should be impossible — but old rows exist, and a
   * blank explanation must not read as "no reason was needed".
   */
  it("says so plainly when a decline carries no reason at all", () => {
    const outcome = participationOutcome({ status: "rejected", reason: null });

    expect(outcome.detail).toMatch(/no reason/i);
  });

  it("has no detail to add when a request was approved", () => {
    expect(participationOutcome({ status: "verified", reason: null }).detail).toBeNull();
  });
});
