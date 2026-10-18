/**
 * What a round says about one participant, and whether it may still be changed.
 *
 * 2026-08-26 (Karthik): a student with a declared offer still read "Selected"
 * on Rounds & results and kept a live checkbox, so the round result behind a
 * live offer could be reversed by a mis-click. F1 already locked students who
 * had moved on to a LATER round — but the final round has none, which is
 * exactly where offers are declared.
 *
 * The label and the lock are one decision, expressed once. A component that
 * computed them separately would eventually print "Offer declared" beside a
 * working checkbox.
 */

import type { RoundResult } from "./types";

export interface ParticipantOutcomeFacts {
  readonly result: RoundResult | null;
  /** F1: they sit in a later round, so this result is history. */
  readonly advanced: boolean;
  /** An offer has been declared for them on this drive (Final selection). */
  readonly offerDeclared: boolean;
}

export interface ParticipantOutcome {
  readonly label: string;
  /** A qualifier the screen renders more quietly, e.g. "(advanced)". */
  readonly note: string | null;
  /** False when no result may be recorded for them any more. */
  readonly editable: boolean;
}

/**
 * Sentence case, spelled out here rather than left to a CSS `capitalize`,
 * which renders "On Hold" and "Offer Declared".
 */
const RESULT_LABEL: Readonly<Record<RoundResult, string>> = {
  selected: "Selected",
  rejected: "Rejected",
  waitlisted: "Waitlisted",
  on_hold: "On hold",
};

/**
 * One result, in the words every screen uses for it.
 *
 * A list that shows the result on its own — a roster's round history — needs
 * the label without the editable/advanced decision that comes with
 * `describeParticipantOutcome`. Leaving it to print `round.result` raw put
 * "on_hold" on the screen, and a CSS `capitalize` would have spelled it
 * "On_Hold".
 */
export function roundResultLabel(result: RoundResult): string {
  return RESULT_LABEL[result];
}

/**
 * Precedence: offer > advanced > the recorded result.
 *
 * An offer outranks everything because it is the outcome — the same order
 * `applicationProgress` uses for the student's own view. It is reported even
 * when this round says "rejected": that combination is a data problem, and
 * showing "Rejected" beside a live offer would hide it.
 */
export function describeParticipantOutcome(facts: ParticipantOutcomeFacts): ParticipantOutcome {
  if (facts.offerDeclared) {
    return { label: "Offer declared", note: null, editable: false };
  }

  if (facts.advanced) {
    return {
      label: facts.result === null ? "—" : RESULT_LABEL[facts.result],
      note: "advanced",
      editable: false,
    };
  }

  return {
    label: facts.result === null ? "Not recorded" : RESULT_LABEL[facts.result],
    note: null,
    editable: true,
  };
}
