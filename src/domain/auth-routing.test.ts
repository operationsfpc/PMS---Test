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

  /**
   * SPEC CHANGE 2026-08-17 (Karthik): "Overview can be the top item and
   * Placement Overview can be the standard landing page. Only exception is
   * students logging in for the first time."
   *
   * Every staff role used to land on its own work queue, which answered "what
   * is waiting for me?" before anyone had asked "how are we doing?". The
   * overview is now the front door, and the queue is one click inside it.
   */
  it.each([
    "campus_placement_coordinator",
    "delivery_head",
    "central_placement_coordinator",
    "admin",
    "campus_manager",
    "key_account_manager",
    "enterprise_relations",
    "er_head",
    "ceo",
  ] as const)("lands %s on the overview", (role) => {
    expect(landingRouteForRole(role)).toBe("/dashboard");
  });

  /**
   * SPEC CHANGE 2026-08-26 (Karthik): "AE GETS a landing page." They now have
   * one of their own - their drives, plus the organisation's figures as
   * aggregates (0064).
   *
   * Still NOT `/dashboard`: that screen is computed from the student roster,
   * which the AE has no read policy on, so it would render zeroes and read as
   * a broken account. The exception was never about them lacking a landing
   * page; it was about that particular one being unreadable for them.
   */
  it("lands an account executive on their own overview, not the roster dashboard", () => {
    expect(landingRouteForRole("account_executive")).toBe("/ae/overview");
  });

  /**
   * SPEC CHANGE 2026-08-17: the admin joins everyone else on the overview.
   *
   * This supersedes "sends an admin to campuses, the first thing a new
   * deployment needs". The lesson that produced that test still stands and is
   * kept below: the admin must never land on the ROSTER IMPORTER, which is a
   * dead end until a campus exists - a real new deployment hit exactly that.
   * The overview is not a dead end; it is read-only, honest about being empty,
   * and Campuses is the first entry under Organisation.
   */
  it("lands an admin on the overview, never on the roster importer", () => {
    expect(landingRouteForRole("admin")).toBe("/dashboard");
    expect(landingRouteForRole("admin")).not.toBe("/admin/roster");
  });

  /** The student keeps their own dashboard: a placement overview is not their screen. */
  it("leaves the student on their own dashboard", () => {
    expect(landingRouteForRole("student")).toBe("/student");
  });

  /**
   * The rule stated as a rule, so a role added later cannot quietly opt out of
   * it. Only the two roles with a documented reason may land anywhere else.
   */
  it("lands every role on the overview except the student and the AE", () => {
    for (const role of APP_ROLES) {
      if (role === "student" || role === "account_executive") continue;
      expect(landingRouteForRole(role)).toBe("/dashboard");
    }
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
