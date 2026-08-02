import { describe, expect, it } from "vitest";
import { canInviteRole, requiresCampusAssignment } from "./staff";
import { APP_ROLES } from "./types";

/**
 * The invitation row IS the login allowlist, so the power to write one is the
 * power to create an account. These rules decide who holds that power.
 */
describe("canInviteRole", () => {
  it("lets an Admin invite any staff role, including another Admin", () => {
    for (const role of APP_ROLES.filter((r) => r !== "student")) {
      expect(canInviteRole("admin", role)).toEqual({ allowed: true });
    }
  });

  it("never lets a student be invited: students arrive by roster import", () => {
    const decision = canInviteRole("admin", "student");
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/roster/i);
  });

  it("refuses every non-Admin actor, however senior", () => {
    for (const actor of APP_ROLES.filter((r) => r !== "admin")) {
      const decision = canInviteRole(actor, "campus_placement_coordinator");
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toMatch(/only an admin/i);
    }
  });
});

describe("requiresCampusAssignment", () => {
  it("is true for the campus-scoped roles", () => {
    expect(requiresCampusAssignment("campus_placement_coordinator")).toBe(true);
    expect(requiresCampusAssignment("campus_manager")).toBe(true);
    expect(requiresCampusAssignment("key_account_manager")).toBe(true);
  });

  it("is false for organisation-wide roles", () => {
    expect(requiresCampusAssignment("admin")).toBe(false);
    expect(requiresCampusAssignment("central_placement_coordinator")).toBe(false);
    expect(requiresCampusAssignment("delivery_head")).toBe(false);
    expect(requiresCampusAssignment("ceo")).toBe(false);
    expect(requiresCampusAssignment("account_executive")).toBe(false);
    expect(requiresCampusAssignment("enterprise_relations")).toBe(false);
    expect(requiresCampusAssignment("er_head")).toBe(false);
    expect(requiresCampusAssignment("student")).toBe(false);
  });
});
