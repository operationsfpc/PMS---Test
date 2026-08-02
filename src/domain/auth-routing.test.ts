import { describe, expect, it } from "vitest";
import { landingRouteForRole } from "./auth-routing";
import { APP_ROLES } from "./types";

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
