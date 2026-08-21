import { describe, expect, it } from "vitest";
import { canEditDriveVenue, describeDriveVenue, driveVenueApplies } from "./drive-venue";

/**
 * UAT 2026-08-21, item 2: an off-campus drive had nowhere to record its
 * venue. The venue may not exist yet at PIF time — "Venue not yet
 * confirmed" must never block the AE from submitting — and once the company
 * confirms it, the Central CPC records it (answers Q4: physical-outside AND
 * pooled; Q5: Central CPC only).
 */
describe("driveVenueApplies", () => {
  it("applies to a physical drive outside campus", () => {
    expect(driveVenueApplies("physical_outside_campus")).toBe(true);
  });

  it("applies to a pooled drive — it happens at another campus's venue (answer Q4)", () => {
    expect(driveVenueApplies("pooled")).toBe(true);
  });

  it("does not apply on campus, online, or before a mode is chosen", () => {
    expect(driveVenueApplies("on_campus")).toBe(false);
    expect(driveVenueApplies("virtual")).toBe(false);
    expect(driveVenueApplies("")).toBe(false);
    expect(driveVenueApplies(null)).toBe(false);
  });
});

describe("describeDriveVenue", () => {
  it("says nothing when the mode has no venue", () => {
    expect(describeDriveVenue("on_campus", "Anna Auditorium")).toBeNull();
    expect(describeDriveVenue("virtual", null)).toBeNull();
    expect(describeDriveVenue(null, null)).toBeNull();
  });

  it("names the venue when it is recorded", () => {
    expect(describeDriveVenue("physical_outside_campus", "HCL Campus, Sholinganallur")).toBe(
      "HCL Campus, Sholinganallur",
    );
  });

  it("trims what was typed", () => {
    expect(describeDriveVenue("pooled", "  Kamaraj College  ")).toBe("Kamaraj College");
  });

  it("admits the venue is still to be confirmed rather than staying silent", () => {
    expect(describeDriveVenue("physical_outside_campus", null)).toBe("Venue to be confirmed");
    expect(describeDriveVenue("pooled", "")).toBe("Venue to be confirmed");
    expect(describeDriveVenue("physical_outside_campus", "   ")).toBe("Venue to be confirmed");
  });
});

describe("canEditDriveVenue", () => {
  it("lets exactly the Central Placement Coordinator update it post-submission (answer Q5)", () => {
    expect(canEditDriveVenue("central_placement_coordinator")).toBe(true);
  });

  it("refuses every other role — including the AE who raised the drive", () => {
    for (const role of [
      "admin",
      "student",
      "campus_placement_coordinator",
      "campus_manager",
      "account_executive",
      "delivery_head",
      "key_account_manager",
      "enterprise_relations",
      "er_head",
      "ceo",
    ] as const) {
      expect(canEditDriveVenue(role)).toBe(false);
    }
  });
});
