/**
 * What a student is told about their own placement journey. PRD §17.1.
 *
 * Two questions, both of which the dashboard would otherwise answer for
 * itself: "where has my application got to?" and "what should I do next?". A
 * screen that decides either one invents a second, quieter rulebook - the
 * student reads "Round 2 of 3" while the coordinator's cockpit says the drive
 * finished a week ago.
 */

import type { AttendanceStatus, ParticipationStatus, RoundResult, SrfStatus } from "./types";

/** One round of one drive, as it applies to one applicant. */
export interface ApplicantRound {
  readonly sequence: number;
  readonly name: string;
  /** False when the student was never called for this round. */
  readonly participating: boolean;
  readonly attendance: AttendanceStatus | null;
  readonly result: RoundResult | null;
}

export type ApplicationStage = "applied" | "in_process" | "selected" | "not_selected";

export interface ApplicationProgress {
  readonly stage: ApplicationStage;
  readonly label: string;
  readonly roundsCleared: number;
  readonly totalRounds: number;
}

/**
 * Where an application has actually got to.
 *
 * Precedence is deliberate, and is the whole rule:
 *
 *   offer  >  rejection  >  waitlist / hold  >  cleared everything  >  current round  >  applied
 *
 * An offer outranks everything because it is the outcome. A rejection at any
 * round is terminal for this drive, whatever rounds come after it. "Cleared
 * every round but no offer yet" is its own state rather than a quiet
 * "selected": the student has finished and nobody has told them the outcome,
 * and "Round 3 of 3" would be a lie.
 */
export function applicationProgress(input: {
  readonly rounds: readonly ApplicantRound[];
  readonly hasOffer: boolean;
}): ApplicationProgress {
  // Sequence is the truth, not arrival order: a round list assembled from two
  // queries comes back in whatever order the database found convenient.
  const rounds = [...input.rounds].sort((a, b) => a.sequence - b.sequence);
  const base = {
    roundsCleared: rounds.filter((r) => r.result === "selected").length,
    totalRounds: rounds.length,
  };

  if (input.hasOffer) {
    return { ...base, stage: "selected", label: "Offer received" };
  }

  const rejected = rounds.find((r) => r.result === "rejected");
  if (rejected !== undefined) {
    return { ...base, stage: "not_selected", label: `Not selected — ${rejected.name}` };
  }

  const latest = rounds.filter((r) => r.participating).at(-1);
  if (latest === undefined) {
    return { ...base, stage: "applied", label: "Applied — awaiting shortlist" };
  }

  if (latest.result === "waitlisted") {
    return { ...base, stage: "in_process", label: `Waitlisted after ${latest.name}` };
  }
  if (latest.result === "on_hold") {
    return { ...base, stage: "in_process", label: `On hold after ${latest.name}` };
  }

  if (base.roundsCleared === base.totalRounds) {
    return { ...base, stage: "in_process", label: "Cleared every round — awaiting the result" };
  }

  return {
    ...base,
    stage: "in_process",
    label: `Round ${latest.sequence} of ${base.totalRounds} — ${latest.name}`,
  };
}

export interface StudentPrompt {
  readonly headline: string;
  readonly detail: string;
  /** Null when there is nothing the student can usefully do about it. */
  readonly action: { readonly label: string; readonly href: string } | null;
}

/**
 * The one thing the student should do next.
 *
 * Participation is asked before the registration form on purpose: nagging a
 * student who has opted out to finish their SRF is worse than saying nothing.
 * Neither opting out nor disbarment carries an action - both are resolved by a
 * coordinator, and offering a button would imply otherwise.
 */
export function studentPrompt(input: {
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
  readonly openDrives: number;
  /**
   * Why a coordinator sent the form back (2026-08-18). Optional because every
   * other status has none, and null when they recorded nothing.
   */
  readonly srfRejectionReason?: string | null;
}): StudentPrompt {
  if (input.participationStatus === "opted_out") {
    return {
      headline: "You have opted out of campus placements",
      detail: "This cannot be reversed. Speak to your placement coordinator if it is wrong.",
      action: null,
    };
  }

  if (input.participationStatus === "disbarred") {
    return {
      headline: "Your participation is on hold",
      detail: "You cannot apply to drives at the moment. Contact your placement coordinator.",
      action: null,
    };
  }

  if (input.srfStatus === "invited" || input.srfStatus === "registered") {
    return {
      headline: "Complete your student registration form",
      detail: "Until it is submitted and verified, no drive is open to you.",
      action: { label: "Fill in my registration form", href: "/srf" },
    };
  }

  if (input.srfStatus === "srf_rejected") {
    /**
     * The coordinator's OWN WORDS, on the screen the student lands on.
     *
     * "Sent it back" says something is wrong and nothing about what, and the
     * reason was only ever visible inside the form itself.
     */
    const reason = (input.srfRejectionReason ?? "").trim();

    return {
      headline: "Your registration form needs changes",
      detail:
        reason === ""
          ? "Your coordinator has sent it back. Correct it and submit it again."
          : `Your coordinator has sent it back: ${reason} Correct it and submit it again.`,
      action: { label: "Update my registration form", href: "/srf" },
    };
  }

  if (input.srfStatus === "srf_submitted") {
    return {
      headline: "Your registration form is with your coordinator",
      detail: "You will be able to apply to drives as soon as it is verified.",
      action: null,
    };
  }

  if (input.openDrives === 0) {
    return {
      headline: "No drives are open to you right now",
      detail: "You will be notified as soon as one you are eligible for is published.",
      action: null,
    };
  }

  return {
    headline:
      input.openDrives === 1
        ? "1 drive is open to you"
        : `${input.openDrives} drives are open to you`,
    detail: "Applications close on the date shown against each drive.",
    action: { label: "See open drives", href: "/student/drives" },
  };
}
