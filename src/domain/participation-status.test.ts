import { describe, expect, it } from "vitest";
import { participationStatusLabel, participationStatusTone } from "./participation-status";
import { PARTICIPATION_STATUSES } from "./types";

/**
 * A student's participation, in the words every queue already uses.
 *
 * The record page used to print the column with its underscores spaced, which
 * put "opted out" in lower case under a badge that said "Verified" in title
 * case — on one screen.
 */
describe("participationStatusLabel", () => {
  it("names each status the way the coordinators' queues name it", () => {
    expect(participationStatusLabel("active")).toBe("In the pipeline");
    expect(participationStatusLabel("opted_out")).toBe("Opted out");
    expect(participationStatusLabel("on_hold")).toBe("On hold");
    expect(participationStatusLabel("disbarred")).toBe("Disbarred");
  });

  it("has a label for every status there is", () => {
    for (const status of PARTICIPATION_STATUSES) {
      expect(participationStatusLabel(status)).not.toBe(status);
    }
  });

  it("keeps an unrecognised status readable instead of blank", () => {
    expect(participationStatusLabel("deferred")).toBe("deferred");
  });
});

describe("participationStatusTone", () => {
  it("flags a hold, marks a disbarment, and leaves the ordinary states quiet", () => {
    expect(participationStatusTone("on_hold")).toBe("warning");
    expect(participationStatusTone("disbarred")).toBe("danger");
    expect(participationStatusTone("active")).toBe("neutral");
    expect(participationStatusTone("opted_out")).toBe("neutral");
  });

  it("treats an unrecognised status as a data gap, not an alarm", () => {
    expect(participationStatusTone("deferred")).toBe("neutral");
  });
});
