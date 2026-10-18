import { describe, expect, it } from "vitest";
import { asDriveStatus, type DriveVerb, describeDriveFreeze } from "./drive-working";
import { DRIVE_STATUSES, type DriveStatus } from "./types";

const VERBS: readonly DriveVerb[] = ["shortlist", "offers", "rounds", "completion", "roles"];
const WITH_STUDENTS: readonly DriveStatus[] = ["live", "applications_closed", "in_rounds"];
const PRE_LIVE: readonly DriveStatus[] = ["draft", "submitted", "approved"];

describe("describeDriveFreeze", () => {
  it.each(VERBS)("opens every verb on a drive the students can see (%s)", (verb) => {
    for (const status of WITH_STUDENTS) expect(describeDriveFreeze(verb, status)).toBeNull();
  });

  it("closes a completed drive, and says it is already closed to a second attempt", () => {
    expect(describeDriveFreeze("completion", "completed")).toBe("This drive is already completed.");
    for (const verb of ["shortlist", "offers", "rounds", "roles"] as const) {
      expect(describeDriveFreeze(verb, "completed")).toBe(
        "This drive is completed — its record is closed.",
      );
    }
  });

  it.each(VERBS)("refuses a rejected drive (%s)", (verb) => {
    expect(describeDriveFreeze(verb, "rejected")).toBe(
      "This drive was rejected — nothing more can be recorded against it.",
    );
  });

  it("still lets an unpublished drive be given its rounds", () => {
    // §3.5 requires a round BEFORE go live — freezing setup would make a
    // drive impossible to publish.
    for (const status of PRE_LIVE) expect(describeDriveFreeze("rounds", status)).toBeNull();
  });

  it("still lets an unpublished visit take the roles it will publish with", () => {
    // A visit is assembled role by role before any student is told about it, so
    // freezing `roles` pre-live would lock the AE out of the PIF form.
    for (const status of PRE_LIVE) expect(describeDriveFreeze("roles", status)).toBeNull();
  });

  it.each(["shortlist", "offers", "completion"] as const)(
    "says why an unpublished drive cannot %s",
    (verb) => {
      for (const status of PRE_LIVE) {
        expect(describeDriveFreeze(verb, status)).toMatch(/not been published/i);
      }
    },
  );

  it("locks nothing while the drive has not been read", () => {
    // A missing status is not evidence that the drive is finished with.
    for (const verb of VERBS) expect(describeDriveFreeze(verb, null)).toBeNull();
  });

  it("puts every status the domain defines in exactly one group", () => {
    // A new `drives.status` value must be decided about, not defaulted past.
    const closed: readonly DriveStatus[] = ["completed", "rejected"];
    for (const status of DRIVE_STATUSES) {
      const groups = [
        WITH_STUDENTS.includes(status),
        PRE_LIVE.includes(status),
        closed.includes(status),
      ].filter(Boolean);
      expect(groups, `${status} belongs to exactly one group`).toHaveLength(1);
    }
  });
});

describe("asDriveStatus", () => {
  it("reads back every status the domain defines", () => {
    // `company_drives.status` arrives through a loose column, and the PIF
    // picker gates on it.
    for (const status of DRIVE_STATUSES) expect(asDriveStatus(status)).toBe(status);
  });

  it("reports a value it does not know as unknown rather than guessing a status", () => {
    // Guessing "draft" would open every verb on a visit that may be closed.
    expect(asDriveStatus("finished")).toBeNull();
    expect(asDriveStatus("")).toBeNull();
    expect(asDriveStatus(null)).toBeNull();
    expect(asDriveStatus(undefined)).toBeNull();
  });

  it("feeds a known status straight into the gate above it", () => {
    expect(describeDriveFreeze("roles", asDriveStatus("completed"))).toMatch(/record is closed/);
    expect(describeDriveFreeze("roles", asDriveStatus("live"))).toBeNull();
  });
});
