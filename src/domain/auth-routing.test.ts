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
 * `null` means "this role has no dedicated screen yet". It is deliberately not
 * a guess at a future route: only four screens exist today, and inventing
 * landing pages for the other seven roles would bury an unconfirmed product
 * decision in code.
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

  it("sends an admin to roster import, the first thing a new deployment needs", () => {
    expect(landingRouteForRole("admin")).toBe("/admin/roster");
  });

  it.each([
    "campus_manager",
    "key_account_manager",
    "enterprise_relations",
    "er_head",
    "ceo",
  ] as const)("returns null for %s, whose screen does not exist yet", (role) => {
    expect(landingRouteForRole(role)).toBeNull();
  });

  it("handles every role in the system", () => {
    for (const role of APP_ROLES) {
      expect(() => landingRouteForRole(role)).not.toThrow();
    }
  });
});
