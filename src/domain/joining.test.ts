import { describe, expect, it } from "vitest";
import {
  describeJoining,
  isJoiningTimeline,
  JOINING_TIMELINES,
  joiningLabel,
  joiningNotesFor,
} from "./joining";

/**
 * When the offer turns into a job (asked for 2026-08-18).
 *
 * "Offer rollout and joining timeline" was a three-row textarea, so the one
 * fact a student plans their year around — do I start now or next July? —
 * could only be found by reading prose, and no screen could filter on it.
 */
describe("JOINING_TIMELINES", () => {
  it("is the agreed vocabulary, in the order the radios offer it", () => {
    expect(JOINING_TIMELINES).toEqual(["immediate", "later"]);
  });

  it("recognises its own values and nothing else", () => {
    for (const timeline of JOINING_TIMELINES) expect(isJoiningTimeline(timeline)).toBe(true);
    expect(isJoiningTimeline("Immediate")).toBe(false);
    expect(isJoiningTimeline("")).toBe(false);
  });
});

describe("joiningLabel", () => {
  it("names both values", () => {
    expect(joiningLabel("immediate")).toBe("Immediate joining");
    expect(joiningLabel("later")).toBe("Joining later");
  });
});

describe("describeJoining", () => {
  it("reads the choice, with the comment when there is one", () => {
    expect(describeJoining("immediate", "Onboarding within 30 days of the offer")).toBe(
      "Immediate joining — Onboarding within 30 days of the offer",
    );
    expect(describeJoining("later", "Offers in Nov 2026, joining July 2027")).toBe(
      "Joining later — Offers in Nov 2026, joining July 2027",
    );
  });

  it("reads the choice alone when no comment was left", () => {
    // Comments are optional (answer 7), so the label has to stand on its own.
    expect(describeJoining("immediate", "")).toBe("Immediate joining");
    expect(describeJoining("later", null)).toBe("Joining later");
    expect(describeJoining("later", "   ")).toBe("Joining later");
  });

  it("falls back to the legacy free-text note when no choice was recorded", () => {
    // The live drives predate the radio and their prose is all there is. It is
    // repeated verbatim rather than dropped or guessed at (answer 9).
    expect(describeJoining(null, "Joining in batches from June")).toBe(
      "Joining in batches from June",
    );
    expect(describeJoining(undefined, undefined)).toBe("Not recorded");
    expect(describeJoining("", "")).toBe("Not recorded");
  });
});

describe("joiningNotesFor", () => {
  it("keeps only the comment belonging to the option that was chosen", () => {
    // One box per option (answer 6). Switching the radio must not leave a
    // comment about joining next July on a drive that says immediate.
    expect(joiningNotesFor("immediate", " Within 30 days ", "Next July")).toEqual({
      immediate: "Within 30 days",
      later: "",
    });
    expect(joiningNotesFor("later", "Within 30 days", " Next July ")).toEqual({
      immediate: "",
      later: "Next July",
    });
    expect(joiningNotesFor("", "Within 30 days", "Next July")).toEqual({
      immediate: "",
      later: "",
    });
  });
});
