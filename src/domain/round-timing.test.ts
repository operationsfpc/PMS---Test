import { describe, expect, it } from "vitest";
import {
  canAdvanceFrom,
  decideCompletionTiming,
  describeRoundsAhead,
  describeRoundWhen,
  type RoundSchedule,
  roundsAhead,
  roundTiming,
} from "./round-timing";

/**
 * 2026-11-06: "advance to next round should be only on time". Until this
 * module, nothing about a round's date stopped anything — a coordinator could
 * advance everyone out of an interview scheduled for next week, and complete a
 * drive whose final round had not been held.
 *
 * IST everywhere, because that is the calendar the placement office works in:
 * a bare `2026-08-19T10:30` means 10:30 in India, whichever machine reads it.
 */

const NOW = new Date("2026-08-19T06:00:00Z"); // 11:30 am IST, 19 Aug 2026

const round = (over: Partial<RoundSchedule>): RoundSchedule => ({
  sequence: 1,
  name: "Aptitude test",
  scheduledAt: null,
  ...over,
});

describe("roundTiming", () => {
  it("calls a round with no date unset", () => {
    expect(roundTiming(null, NOW)).toBe("unset");
    expect(roundTiming(undefined, NOW)).toBe("unset");
    expect(roundTiming("", NOW)).toBe("unset");
  });

  /** A date nobody can read is not evidence that a round lies in the future. */
  it("calls a date the clock cannot read unset rather than upcoming", () => {
    expect(roundTiming("next Thursday morning", NOW)).toBe("unset");
  });

  /** The trap this exists to avoid: a bare value read as the viewer's own time. */
  it("reads an undated-offset value as IST, not as the reader's clock", () => {
    // 10:30 IST is 05:30Z — half an hour BEFORE this `now`. Read as UTC it
    // would look like it is still to come, and the round would be blocked.
    expect(roundTiming("2026-08-19T10:30", NOW)).toBe("past");
    expect(roundTiming("2026-08-19T12:00", NOW)).toBe("upcoming");
  });

  it("honours an offset the database itself carried", () => {
    expect(roundTiming("2026-08-19T05:30:00+00:00", NOW)).toBe("past");
    expect(roundTiming("2026-08-19T11:00:00+05:30", NOW)).toBe("past");
    expect(roundTiming("2026-08-19T12:00:00+05:30", NOW)).toBe("upcoming");
  });
});

describe("describeRoundWhen", () => {
  it("spells the round's moment in the IST calendar", () => {
    expect(describeRoundWhen("2026-08-19T10:30")).toBe("19 Aug 2026, 10:30 am");
  });

  it("says nothing when there is no date to say", () => {
    expect(describeRoundWhen(null)).toBeNull();
    expect(describeRoundWhen("not a date")).toBeNull();
  });
});

describe("canAdvanceFrom", () => {
  it("lets an undated round advance — most drives were built before the field", () => {
    expect(canAdvanceFrom(round({ scheduledAt: null }), NOW)).toEqual({ allowed: true });
  });

  it("lets a round that has been held advance", () => {
    expect(canAdvanceFrom(round({ scheduledAt: "2026-08-18T15:00" }), NOW)).toEqual({
      allowed: true,
    });
  });

  /** The sentence names the round and its own date, never a rule number. */
  it("refuses a round that has not been held yet, and says when it is", () => {
    expect(
      canAdvanceFrom(
        round({ sequence: 2, name: "Technical interview", scheduledAt: "2026-08-21T14:00" }),
        NOW,
      ),
    ).toEqual({
      allowed: false,
      reason:
        "Round 2 (Technical interview) is scheduled for 21 Aug 2026, 2:00 pm and has not been held yet — advance it once that time has passed.",
    });
  });
});

describe("roundsAhead", () => {
  it("names only the dated rounds still to come, in the order the cycle reaches them", () => {
    const ahead = roundsAhead(
      [
        round({ sequence: 1, scheduledAt: "2026-08-18T10:00" }),
        round({ sequence: 2, scheduledAt: null }),
        round({ sequence: 4, scheduledAt: "2026-08-25T10:00" }),
        round({ sequence: 3, scheduledAt: "2026-08-22T10:00" }),
      ],
      NOW,
    );
    expect(ahead.map((r) => r.sequence)).toEqual([3, 4]);
  });

  it("says nothing when every round is behind or undated", () => {
    expect(
      describeRoundsAhead(roundsAhead([round({ scheduledAt: "2026-08-01T10:00" })], NOW)),
    ).toBeNull();
  });

  it("spells the next round out when one is still to come", () => {
    expect(
      describeRoundsAhead(
        roundsAhead(
          [round({ sequence: 3, name: "Final interview", scheduledAt: "2026-08-22T10:00" })],
          NOW,
        ),
      ),
    ).toBe(
      "Round 3 (Final interview) is scheduled for 22 Aug 2026, 10:00 am and has not been held yet",
    );
  });
});

describe("decideCompletionTiming", () => {
  it("allows completion the moment no round is ahead", () => {
    expect(decideCompletionTiming([], "whatever")).toEqual({ allowed: true });
  });

  /** 2026-08-21 (answer 3b) again: time never gets the last word — a typed
   *  reason does, and it is the only thing the audit log can be shown. */
  it("asks for a reason before a round that has not been held", () => {
    const ahead = roundsAhead(
      [round({ sequence: 3, name: "Final interview", scheduledAt: "2026-08-22T10:00" })],
      NOW,
    );
    expect(decideCompletionTiming(ahead, "")).toEqual({
      allowed: false,
      reason:
        "Round 3 (Final interview) is scheduled for 22 Aug 2026, 10:00 am and has not been held yet. Give a reason for completing the drive before it — it is audit-logged.",
    });
    expect(decideCompletionTiming(ahead, "Company walked away")).toEqual({ allowed: true });
  });

  it("counts the rounds still to come when more than one is left", () => {
    const ahead = roundsAhead(
      [
        round({ sequence: 2, scheduledAt: "2026-08-20T10:00" }),
        round({ sequence: 3, scheduledAt: "2026-08-22T10:00" }),
      ],
      NOW,
    );
    const decision = decideCompletionTiming(ahead, "   ");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain("2 rounds are still to come");
      // The earliest round is the one named, not the last.
      expect(decision.reason).toContain("Round 2");
    }
  });

  /** An undated round cannot be "still to come" — it never claimed a time. */
  it("never blocks completion on a round nobody dated", () => {
    expect(decideCompletionTiming(roundsAhead([round({ scheduledAt: null })], NOW), "")).toEqual({
      allowed: true,
    });
  });
});
