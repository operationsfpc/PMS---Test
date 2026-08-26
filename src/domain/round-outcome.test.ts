import { describe, expect, it } from "vitest";
import { describeParticipantOutcome } from "./round-outcome";

/**
 * 2026-08-26 (Karthik, three screenshots): a student with a declared offer
 * still read "Selected" on Rounds & results, kept a live checkbox, and could
 * be re-marked Selected / Rejected / On hold — the round result behind a live
 * offer was one mis-click from being reversed.
 *
 * The label and the lock are ONE decision. Two conditions in a component would
 * eventually disagree, and the disagreement that matters is the one where the
 * row says "Offer declared" and the checkbox still works.
 */
const facts = (over: Partial<Parameters<typeof describeParticipantOutcome>[0]> = {}) => ({
  result: null,
  advanced: false,
  offerDeclared: false,
  ...over,
});

describe("describeParticipantOutcome", () => {
  it("says nothing has been recorded, and lets it be recorded", () => {
    expect(describeParticipantOutcome(facts())).toEqual({
      label: "Not recorded",
      note: null,
      editable: true,
    });
  });

  it.each([
    ["selected", "Selected"],
    ["rejected", "Rejected"],
    ["waitlisted", "Waitlisted"],
    ["on_hold", "On hold"],
  ] as const)("names a %s result in sentence case", (result, label) => {
    expect(describeParticipantOutcome(facts({ result }))).toEqual({
      label,
      note: null,
      editable: true,
    });
  });

  /** F1: they sit in a later round, so this result is history. */
  it("marks an advanced student's result as history and closes it", () => {
    expect(describeParticipantOutcome(facts({ result: "selected", advanced: true }))).toEqual({
      label: "Selected",
      note: "advanced",
      editable: false,
    });
  });

  it("has a dash rather than a blank for an advanced student with no result", () => {
    expect(describeParticipantOutcome(facts({ advanced: true }))).toEqual({
      label: "—",
      note: "advanced",
      editable: false,
    });
  });

  it("reports a declared offer, and refuses any further decision", () => {
    expect(describeParticipantOutcome(facts({ result: "selected", offerDeclared: true }))).toEqual({
      label: "Offer declared",
      note: null,
      editable: false,
    });
  });

  /**
   * An offer is the outcome — the same precedence `applicationProgress` uses.
   * A student who was advanced AND then offered is offered.
   */
  it("lets the offer outrank the advance", () => {
    expect(
      describeParticipantOutcome(
        facts({ result: "selected", advanced: true, offerDeclared: true }),
      ),
    ).toEqual({ label: "Offer declared", note: null, editable: false });
  });

  /**
   * The offer is what is being reported, so it is reported whatever the round
   * said — a rejection here with an offer on the drive is a data problem, and
   * "Rejected" beside a live offer would hide it.
   */
  it("reports the offer even when this round rejected them", () => {
    expect(describeParticipantOutcome(facts({ result: "rejected", offerDeclared: true }))).toEqual({
      label: "Offer declared",
      note: null,
      editable: false,
    });
  });
});
