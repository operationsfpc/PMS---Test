import { describe, expect, it } from "vitest";
import { ROUND_MODES, roundLocationKind, roundModeLabel } from "./round-mode";

/**
 * UAT 2026-08-20, G6b: with the round mode set to "Physical, outside campus"
 * the details field still said "Link" — an address had to be typed into a URL
 * box. The mode decides WHICH location field a round has (Q8, approved):
 * Online rounds carry a link, physical rounds carry a venue.
 */
describe("roundModeLabel", () => {
  it("names the three modes the coordinator chooses between", () => {
    expect(roundModeLabel("virtual")).toBe("Online");
    expect(roundModeLabel("on_campus")).toBe("Physical — on campus");
    expect(roundModeLabel("physical_outside_campus")).toBe("Physical — outside campus");
  });

  it("is honest about a round with no mode set", () => {
    expect(roundModeLabel(null)).toBe("Mode not set");
  });

  it("repeats an unknown stored value verbatim rather than inventing a reading", () => {
    expect(roundModeLabel("hybrid")).toBe("hybrid");
  });
});

describe("roundLocationKind", () => {
  it("gives an online round a link", () => {
    expect(roundLocationKind("virtual")).toBe("link");
  });

  it("gives both physical modes a venue — an address, not a URL", () => {
    expect(roundLocationKind("on_campus")).toBe("venue");
    expect(roundLocationKind("physical_outside_campus")).toBe("venue");
  });

  it("defaults to a link when no mode is chosen — the pre-existing behaviour", () => {
    expect(roundLocationKind(null)).toBe("link");
  });
});

describe("ROUND_MODES", () => {
  it("matches 0053's check constraint exactly — a value outside it is refused by the database", () => {
    expect(ROUND_MODES).toEqual(["virtual", "on_campus", "physical_outside_campus"]);
  });
});
