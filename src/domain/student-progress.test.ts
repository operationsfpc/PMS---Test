import { describe, expect, it } from "vitest";
import { type ApplicantRound, applicationProgress, studentPrompt } from "./student-progress";

/**
 * What the student is told about their own journey.
 *
 * The dashboard is the first screen every student sees, so both rules here are
 * load-bearing: a screen that decides for itself where an application has got
 * to will eventually disagree with the coordinator's cockpit about the same
 * application.
 */

const round = (over: Partial<ApplicantRound> & { sequence: number }): ApplicantRound => ({
  name: `Round ${over.sequence}`,
  participating: false,
  attendance: null,
  result: null,
  ...over,
});

describe("applicationProgress", () => {
  it("says the student has applied and is waiting, before any round names them", () => {
    const progress = applicationProgress({
      rounds: [round({ sequence: 1 }), round({ sequence: 2 })],
      hasOffer: false,
    });

    expect(progress.stage).toBe("applied");
    expect(progress.label).toMatch(/awaiting shortlist/i);
    expect(progress.totalRounds).toBe(2);
    expect(progress.roundsCleared).toBe(0);
  });

  it("reports the round the student is actually in, out of the total", () => {
    const progress = applicationProgress({
      rounds: [
        round({ sequence: 1, name: "Online test", participating: true, result: "selected" }),
        round({ sequence: 2, name: "Technical interview", participating: true }),
        round({ sequence: 3, name: "HR interview" }),
      ],
      hasOffer: false,
    });

    expect(progress.stage).toBe("in_process");
    expect(progress.label).toBe("Round 2 of 3 — Technical interview");
    expect(progress.roundsCleared).toBe(1);
  });

  it("reads rounds in sequence order, not the order they arrive in", () => {
    const progress = applicationProgress({
      rounds: [
        round({ sequence: 3, name: "HR interview" }),
        round({ sequence: 1, name: "Online test", participating: true, result: "selected" }),
        round({ sequence: 2, name: "Technical interview", participating: true }),
      ],
      hasOffer: false,
    });

    expect(progress.label).toBe("Round 2 of 3 — Technical interview");
  });

  it("treats an offer as the outcome, whatever the rounds say", () => {
    const progress = applicationProgress({
      rounds: [round({ sequence: 1, participating: true, result: "selected" })],
      hasOffer: true,
    });

    expect(progress.stage).toBe("selected");
    expect(progress.label).toBe("Offer received");
  });

  it("treats a rejection at any round as terminal for that drive, and names the round", () => {
    const progress = applicationProgress({
      rounds: [
        round({ sequence: 1, name: "Online test", participating: true, result: "selected" }),
        round({
          sequence: 2,
          name: "Technical interview",
          participating: true,
          result: "rejected",
        }),
        round({ sequence: 3, name: "HR interview" }),
      ],
      hasOffer: false,
    });

    expect(progress.stage).toBe("not_selected");
    expect(progress.label).toBe("Not selected — Technical interview");
  });

  it("does not call a student rejected once they hold the offer", () => {
    const progress = applicationProgress({
      rounds: [round({ sequence: 1, participating: true, result: "rejected" })],
      hasOffer: true,
    });

    expect(progress.stage).toBe("selected");
  });

  it("says a waitlisted student is still in process, and says where", () => {
    const progress = applicationProgress({
      rounds: [
        round({ sequence: 1, name: "Online test", participating: true, result: "waitlisted" }),
        round({ sequence: 2, name: "Technical interview" }),
      ],
      hasOffer: false,
    });

    expect(progress.stage).toBe("in_process");
    expect(progress.label).toBe("Waitlisted after Online test");
  });

  it("says the same for a student put on hold", () => {
    const progress = applicationProgress({
      rounds: [round({ sequence: 1, name: "Online test", participating: true, result: "on_hold" })],
      hasOffer: false,
    });

    expect(progress.label).toBe("On hold after Online test");
  });

  it("does not claim a round is running once every round is cleared and no offer has come", () => {
    const progress = applicationProgress({
      rounds: [
        round({ sequence: 1, name: "Online test", participating: true, result: "selected" }),
        round({ sequence: 2, name: "HR interview", participating: true, result: "selected" }),
      ],
      hasOffer: false,
    });

    expect(progress.stage).toBe("in_process");
    expect(progress.label).toMatch(/cleared every round/i);
    expect(progress.roundsCleared).toBe(2);
  });

  it("survives a drive whose rounds have not been set up yet", () => {
    const progress = applicationProgress({ rounds: [], hasOffer: false });

    expect(progress.stage).toBe("applied");
    expect(progress.totalRounds).toBe(0);
  });
});

describe("studentPrompt", () => {
  const base = { srfStatus: "srf_approved", participationStatus: "active", openDrives: 0 } as const;

  it("asks a newly invited student to fill in the registration form", () => {
    const prompt = studentPrompt({ ...base, srfStatus: "invited" });

    expect(prompt.headline).toMatch(/registration form/i);
    expect(prompt.action?.href).toBe("/srf");
  });

  it("asks the same of a registered student who has not submitted", () => {
    expect(studentPrompt({ ...base, srfStatus: "registered" }).action?.href).toBe("/srf");
  });

  it("tells a student whose form is submitted to wait, and offers nothing to click", () => {
    const prompt = studentPrompt({ ...base, srfStatus: "srf_submitted" });

    expect(prompt.headline).toMatch(/with your coordinator/i);
    expect(prompt.action).toBeNull();
  });

  it("sends a student whose form was sent back to correct it", () => {
    const prompt = studentPrompt({ ...base, srfStatus: "srf_rejected" });

    expect(prompt.headline).toMatch(/needs changes/i);
    expect(prompt.action?.href).toBe("/srf");
  });

  it("points an approved student at the drives open to them", () => {
    const prompt = studentPrompt({ ...base, openDrives: 4 });

    expect(prompt.headline).toBe("4 drives are open to you");
    expect(prompt.action?.href).toBe("/student/drives");
  });

  it("does not say '1 drives'", () => {
    expect(studentPrompt({ ...base, openDrives: 1 }).headline).toBe("1 drive is open to you");
  });

  it("says plainly when nothing is open, rather than sending them to an empty list", () => {
    const prompt = studentPrompt({ ...base, openDrives: 0 });

    expect(prompt.headline).toMatch(/no drives are open/i);
    expect(prompt.action).toBeNull();
  });

  it("never nags an opted-out student about their registration form", () => {
    const prompt = studentPrompt({
      srfStatus: "invited",
      participationStatus: "opted_out",
      openDrives: 3,
    });

    expect(prompt.headline).toMatch(/opted out/i);
    expect(prompt.detail).toMatch(/cannot be reversed/i);
    expect(prompt.action).toBeNull();
  });

  it("tells a disbarred student to speak to their coordinator, and nothing else", () => {
    const prompt = studentPrompt({
      srfStatus: "srf_approved",
      participationStatus: "disbarred",
      openDrives: 3,
    });

    expect(prompt.headline).toMatch(/on hold/i);
    expect(prompt.detail).toMatch(/coordinator/i);
    expect(prompt.action).toBeNull();
  });
});

/**
 * The coordinator's own words reach the dashboard (2026-08-18, answer 9).
 *
 * "Your coordinator has sent it back" tells the student that something is
 * wrong and nothing about what. The reason was already stored and already shown
 * inside the form - but the dashboard is where they land, so a student who
 * reads only that learns nothing actionable.
 */
describe("a form sent back for changes says what to change", () => {
  it("carries the coordinator's comment into the prompt", () => {
    const prompt = studentPrompt({
      srfStatus: "srf_rejected",
      participationStatus: "active",
      openDrives: 0,
      srfRejectionReason: "Your semester 2 marksheet is missing.",
    });

    expect(prompt.detail).toMatch(/semester 2 marksheet is missing/i);
    expect(prompt.action?.href).toBe("/srf");
  });

  it("still says something useful when no reason was recorded", () => {
    const prompt = studentPrompt({
      srfStatus: "srf_rejected",
      participationStatus: "active",
      openDrives: 0,
      srfRejectionReason: null,
    });

    expect(prompt.detail).toMatch(/sent it back/i);
    expect(prompt.detail).not.toMatch(/null|undefined/);
  });

  it("treats a blank reason as no reason", () => {
    const prompt = studentPrompt({
      srfStatus: "srf_rejected",
      participationStatus: "active",
      openDrives: 0,
      srfRejectionReason: "   ",
    });

    expect(prompt.detail).toMatch(/sent it back/i);
  });

  it("never repeats a reason on a form that was not sent back", () => {
    const prompt = studentPrompt({
      srfStatus: "srf_submitted",
      participationStatus: "active",
      openDrives: 0,
      srfRejectionReason: "An old reason from last time.",
    });

    expect(prompt.detail).not.toMatch(/old reason/i);
  });
});
