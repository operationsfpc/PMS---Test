import { describe, expect, it } from "vitest";
import {
  ARREAR_POLICIES,
  ATTENDANCE_STATUSES,
  DRIVE_MODES,
  DRIVE_STATUSES,
  DRIVE_TYPES,
  OFFER_SOURCES,
  PARTICIPATION_STATUSES,
  ROLE_CATEGORIES,
  ROUND_RESULTS,
  SRF_STATUSES,
} from "./types";

/**
 * These vocabularies are mirrored one-for-one by Postgres enums in Layer 2.
 * Changing a value here without a migration silently breaks production data,
 * so the exact membership is pinned by test.
 */
describe("domain vocabularies mirror the Postgres enums", () => {
  it("pins the five FINAL role categories", () => {
    expect(ROLE_CATEGORIES).toEqual([
      "software_technical",
      "technical_support_it_ops",
      "digital_marketing",
      "sales",
      "operations_business",
    ]);
  });

  it("pins drive types", () => {
    expect(DRIVE_TYPES).toEqual(["placement", "internship_convertible", "internship"]);
  });

  it("pins drive modes and never uses the ambiguous 'off_campus'", () => {
    // "Off-campus" means *self-placed* in PRD §16.2 (decision Q5).
    expect(DRIVE_MODES).toEqual(["on_campus", "physical_outside_campus", "virtual", "pooled"]);
    expect(DRIVE_MODES).not.toContain("off_campus");
  });

  it("pins arrear policies", () => {
    expect(ARREAR_POLICIES).toEqual(["no_standing", "no_history", "flexible"]);
  });

  it("pins SRF statuses", () => {
    expect(SRF_STATUSES).toEqual([
      "invited",
      "registered",
      "srf_submitted",
      "srf_approved",
      "srf_rejected",
    ]);
  });

  it("pins participation statuses", () => {
    expect(PARTICIPATION_STATUSES).toEqual(["active", "opted_out", "disbarred"]);
  });

  it("pins drive statuses", () => {
    expect(DRIVE_STATUSES).toEqual([
      "draft",
      "submitted",
      "approved",
      "live",
      "applications_closed",
      "in_rounds",
      "completed",
      "rejected",
    ]);
  });

  it("pins round results", () => {
    expect(ROUND_RESULTS).toEqual(["selected", "rejected", "waitlisted", "on_hold"]);
  });

  it("pins attendance statuses", () => {
    expect(ATTENDANCE_STATUSES).toEqual(["scheduled", "present", "absent", "provisional"]);
  });

  it("pins offer sources", () => {
    expect(OFFER_SOURCES).toEqual(["on_campus", "self_placed"]);
  });
});
