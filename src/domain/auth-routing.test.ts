import { describe, expect, it } from "vitest";
import { landingRouteForRole, studentLandingRoute } from "./auth-routing";
import { APP_ROLES, type ParticipationStatus, type SrfStatus } from "./types";

/**
 * Where each role lands immediately after signing in.
 *
 * Confirmed decision: ONE login screen for everybody, with post-login routing
 * by role. That mapping is a business rule, not a UI detail, so it lives here
 * and the login screen merely obeys it.
 *
 * Every role now has a screen, so the mapping is exhaustive and the compiler
 * enforces it: adding a role to APP_ROLES without a landing route is a type
 * error, not a runtime surprise.
 */
describe("landingRouteForRole", () => {
  it("sends a student to their dashboard", () => {
    expect(landingRouteForRole("student")).toBe("/student");
  });

  it("sends a campus placement coordinator to the SRF verification queue", () => {
    expect(landingRouteForRole("campus_placement_coordinator")).toBe("/cpc/verification");
  });

  it("sends the delivery head to the PIF approval queue", () => {
    expect(landingRouteForRole("delivery_head")).toBe("/delivery-head/pif-approvals");
  });

  it("sends the central placement coordinator to the drive cockpit", () => {
    expect(landingRouteForRole("central_placement_coordinator")).toBe("/central/drives");
  });

  it("sends an account executive to the PIF they raise drives with", () => {
    expect(landingRouteForRole("account_executive")).toBe("/ae/pif");
  });

  /**
   * Campuses, not roster import. A roster cannot be imported until a campus
   * exists, so landing on the importer was landing on a dead end - which is
   * exactly what a new deployment hit in practice.
   */
  it("sends an admin to campuses, the first thing a new deployment needs", () => {
    expect(landingRouteForRole("admin")).toBe("/admin/campuses");
  });

  /**
   * These five are read-only reporting roles. They now share one dashboard:
   * building five would be five chances to compute "placed" differently.
   */
  it.each([
    "campus_manager",
    "key_account_manager",
    "enterprise_relations",
    "er_head",
    "ceo",
  ] as const)("lands %s on the shared dashboard", (role) => {
    expect(landingRouteForRole(role)).toBe("/dashboard");
  });

  it("gives every role in the system a real route", () => {
    for (const role of APP_ROLES) {
      expect(landingRouteForRole(role)).toMatch(/^\//);
    }
  });
});

/**
 * Where a STUDENT lands, which their role alone cannot answer.
 *
 * Asked for 2026-08-06: "when a student logs in for the first time, he should
 * directly land on the registration page." Every student landed on the
 * dashboard, which for an unregistered one is a near-empty screen whose only
 * useful content is a link to the form they were supposed to be filling in.
 *
 * The precedence below is deliberately the SAME as `studentPrompt()`:
 * participation is settled before registration is asked for. If the two ever
 * disagreed, an opted-out student would be dropped onto a registration form
 * while their own dashboard told them never to fill one in.
 */
describe("studentLandingRoute", () => {
  const landing = (srfStatus: SrfStatus, participationStatus: ParticipationStatus = "active") =>
    studentLandingRoute({ srfStatus, participationStatus });

  it("sends a student who has never registered straight to the form", () => {
    expect(landing("invited")).toBe("/srf");
    expect(landing("registered")).toBe("/srf");
  });

  it("sends a student who is waiting on verification to their dashboard", () => {
    // The form is gone from their control; the dashboard is what tells them so.
    expect(landing("srf_submitted")).toBe("/student");
  });

  it("sends a verified student to their dashboard, where the drives are", () => {
    expect(landing("srf_approved")).toBe("/student");
  });

  /**
   * ⚠️ ASSUMPTION — UNCONFIRMED (A32). A returned form is not a "first" login,
   * and the dashboard is the only screen that says WHY it came back. Landing
   * them on the form directly would hide the coordinator's reason behind a
   * back-navigation.
   */
  it("sends a student whose form was rejected to the dashboard that explains why", () => {
    expect(landing("srf_rejected")).toBe("/student");
  });

  /**
   * The trap. Participation is asked BEFORE registration, so a student who has
   * opted out must never be routed into a registration form — least of all one
   * they cannot act on, since opting out cannot be reversed.
   */
  it("never sends an opted-out student to a form they must not fill in", () => {
    expect(landing("invited", "opted_out")).toBe("/student");
    expect(landing("registered", "opted_out")).toBe("/student");
  });

  it("never sends a disbarred student to the form either", () => {
    expect(landing("invited", "disbarred")).toBe("/student");
  });

  it("agrees with the role map: a student's default screen is still /student", () => {
    expect(landingRouteForRole("student")).toBe("/student");
  });
});
