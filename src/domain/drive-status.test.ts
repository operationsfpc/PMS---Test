import { describe, expect, it } from "vitest";
import { driveStatusLabel, driveStatusTone } from "./drive-status";
import { DRIVE_STATUSES } from "./types";

/**
 * One lifecycle vocabulary for eight screens.
 *
 * Before this module the same stored value was printed as "LIVE", "live",
 * "Applications open" and "Pending approval" depending on which page you were
 * on, and `approved` was green beside the AE's amber. A coordinator counting
 * what still needs doing cannot read four spellings of one state as one state.
 */
describe("driveStatusLabel", () => {
  it("names each stage the way the screens now say it", () => {
    expect(driveStatusLabel("draft")).toBe("Draft");
    expect(driveStatusLabel("submitted")).toBe("Awaiting approval");
    expect(driveStatusLabel("approved")).toBe("Approved — not yet published");
    expect(driveStatusLabel("live")).toBe("Live");
    expect(driveStatusLabel("applications_closed")).toBe("Applications closed");
    expect(driveStatusLabel("in_rounds")).toBe("In rounds");
    expect(driveStatusLabel("completed")).toBe("Completed");
    expect(driveStatusLabel("rejected")).toBe("Sent back");
  });

  it("has a label for every status there is", () => {
    for (const status of DRIVE_STATUSES) {
      expect(driveStatusLabel(status)).not.toBe(status);
    }
  });

  it("keeps an unrecognised status readable instead of blank", () => {
    expect(driveStatusLabel("archived")).toBe("archived");
    expect(driveStatusLabel("waiting_on_company")).toBe("waiting on company");
  });
});

describe("driveStatusTone", () => {
  it("reserves green for the one state a student can act on", () => {
    expect(driveStatusTone("live")).toBe("success");
    for (const status of DRIVE_STATUSES.filter((s) => s !== "live")) {
      expect(driveStatusTone(status)).not.toBe("success");
    }
  });

  it("warns wherever a person still owes the next step", () => {
    expect(driveStatusTone("submitted")).toBe("warning");
    expect(driveStatusTone("approved")).toBe("warning");
    expect(driveStatusTone("applications_closed")).toBe("warning");
    expect(driveStatusTone("in_rounds")).toBe("warning");
  });

  it("is quiet at both ends of the journey and red only at its dead end", () => {
    expect(driveStatusTone("draft")).toBe("neutral");
    expect(driveStatusTone("completed")).toBe("neutral");
    expect(driveStatusTone("rejected")).toBe("danger");
  });

  it("treats an unrecognised status as a data gap, not an alarm", () => {
    expect(driveStatusTone("archived")).toBe("neutral");
  });
});
