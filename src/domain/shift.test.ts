import { describe, expect, it } from "vitest";
import {
  describeShift,
  isShiftType,
  nightTimingFor,
  nightTimingIsMissing,
  SHIFT_TYPES,
  shiftLabel,
} from "./shift";

/**
 * The shift a role is worked on (asked for 2026-08-18).
 *
 * It was a free-text box, and the live drives contain "General" — a word that
 * tells a student nothing about whether they will be awake at 3am. The
 * vocabulary lives here so the form, the check constraint in `0051` and the
 * student's drive card cannot disagree about what a coherent answer is.
 */
describe("SHIFT_TYPES", () => {
  it("is the agreed vocabulary, in the order the radios offer it", () => {
    expect(SHIFT_TYPES).toEqual(["day", "night", "rotational", "flexible"]);
  });

  it("recognises its own values and nothing else", () => {
    for (const shift of SHIFT_TYPES) expect(isShiftType(shift)).toBe(true);
    // The four live drives say this. It is not a shift type; it is a legacy
    // string, and reading it as one would invent a fact nobody stated.
    expect(isShiftType("General")).toBe(false);
    expect(isShiftType("Day")).toBe(false);
    expect(isShiftType("")).toBe(false);
  });
});

describe("shiftLabel", () => {
  it("names every value", () => {
    expect(shiftLabel("day")).toBe("Day");
    expect(shiftLabel("night")).toBe("Night");
    expect(shiftLabel("rotational")).toBe("Rotational");
    expect(shiftLabel("flexible")).toBe("Flexible");
  });
});

describe("describeShift", () => {
  it("reads a day, rotational or flexible shift as a shift", () => {
    expect(describeShift("day", "")).toBe("Day shift");
    expect(describeShift("rotational", "")).toBe("Rotational shift");
    expect(describeShift("flexible", "")).toBe("Flexible shift");
  });

  it("puts the hours beside a night shift, because that is the point of asking", () => {
    expect(describeShift("night", "9.00 pm – 6.00 am")).toBe("Night shift (9.00 pm – 6.00 am)");
  });

  it("still names a night shift whose hours were never filled in", () => {
    // A draft may be incomplete; only submission demands the timing.
    expect(describeShift("night", "")).toBe("Night shift");
    expect(describeShift("night", null)).toBe("Night shift");
    expect(describeShift("night", "   ")).toBe("Night shift");
  });

  it("ignores a timing that does not belong to a night shift", () => {
    // Belt and braces with the constraint: a stale timing must never be shown
    // against a day shift, whatever is in the row.
    expect(describeShift("day", "9.00 pm – 6.00 am")).toBe("Day shift");
  });

  it("repeats a legacy free-text shift verbatim rather than guessing", () => {
    expect(describeShift("General", "")).toBe("General");
    expect(describeShift("  Rotational (US)  ", "")).toBe("Rotational (US)");
  });

  it("says so when nothing was recorded", () => {
    // `describeBoard(undefined)` took the whole verification queue down in a
    // previous session. Anything rendered once per row must survive a value
    // that predates the field.
    expect(describeShift(null, null)).toBe("Not recorded");
    expect(describeShift(undefined, undefined)).toBe("Not recorded");
    expect(describeShift("", "")).toBe("Not recorded");
    expect(describeShift("   ", "")).toBe("Not recorded");
  });
});

describe("nightTimingFor", () => {
  it("keeps the timing only on a night shift", () => {
    expect(nightTimingFor("night", " 9pm – 6am ")).toBe("9pm – 6am");
    // Choosing Night, typing the hours, then switching to Day must not leave
    // the hours behind: the row would claim a day shift that runs at night.
    expect(nightTimingFor("day", "9pm – 6am")).toBe("");
    expect(nightTimingFor("rotational", "9pm – 6am")).toBe("");
    expect(nightTimingFor("flexible", "9pm – 6am")).toBe("");
    expect(nightTimingFor("", "9pm – 6am")).toBe("");
  });
});

describe("nightTimingIsMissing", () => {
  it("is true only for a night shift with no hours", () => {
    expect(nightTimingIsMissing("night", "")).toBe(true);
    expect(nightTimingIsMissing("night", "   ")).toBe(true);
    expect(nightTimingIsMissing("night", "9pm – 6am")).toBe(false);
    expect(nightTimingIsMissing("day", "")).toBe(false);
    expect(nightTimingIsMissing("", "")).toBe(false);
  });
});
