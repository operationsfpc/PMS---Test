import { describe, expect, it } from "vitest";
import {
  canChangeStaffRole,
  canInviteRole,
  canRemoveStaff,
  requiresCampusAssignment,
  type StaffChangeContext,
} from "./staff";
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

/**
 * Changing a role and removing an account are the two ways an Admin can lock
 * the organisation out of its own system. Both are guarded here, once, so no
 * screen has to remember to guard them.
 */
const context = (overrides: Partial<StaffChangeContext> = {}): StaffChangeContext => ({
  actor: { role: "admin", email: "admin@faceprep.in" },
  target: { email: "ae@faceprep.in", role: "account_executive" },
  targetIsLastAdmin: false,
  ...overrides,
});

describe("canChangeStaffRole", () => {
  it("lets an Admin move someone to any staff role", () => {
    for (const role of APP_ROLES.filter((r) => r !== "student")) {
      expect(canChangeStaffRole(context(), role)).toEqual({ allowed: true });
    }
  });

  it("refuses every non-Admin actor", () => {
    for (const actor of APP_ROLES.filter((r) => r !== "admin")) {
      const decision = canChangeStaffRole(
        context({ actor: { role: actor, email: "someone@faceprep.in" } }),
        "delivery_head",
      );
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toMatch(/only an admin/i);
    }
  });

  it("never turns a staff member into a student", () => {
    const decision = canChangeStaffRole(context(), "student");
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/roster/i);
  });

  // An Admin who demotes themselves cannot promote themselves back.
  it("refuses to let an Admin change their own role", () => {
    const decision = canChangeStaffRole(
      context({ target: { email: "admin@faceprep.in", role: "admin" } }),
      "account_executive",
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/your own role/i);
  });

  // Matching on case would let ADMIN@faceprep.in walk straight past the rule.
  it("recognises the actor whatever the capitalisation", () => {
    const decision = canChangeStaffRole(
      context({ target: { email: "Admin@FacePrep.in", role: "admin" } }),
      "ceo",
    );
    expect(decision.allowed).toBe(false);
  });

  it("refuses to demote the last Admin, which would lock everyone out", () => {
    const decision = canChangeStaffRole(
      context({
        actor: { role: "admin", email: "other-admin@faceprep.in" },
        target: { email: "admin@faceprep.in", role: "admin" },
        targetIsLastAdmin: true,
      }),
      "ceo",
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/last admin/i);
  });

  it("allows the last Admin to stay an Admin", () => {
    expect(
      canChangeStaffRole(
        context({
          actor: { role: "admin", email: "other-admin@faceprep.in" },
          target: { email: "admin@faceprep.in", role: "admin" },
          targetIsLastAdmin: true,
        }),
        "admin",
      ),
    ).toEqual({ allowed: true });
  });
});

describe("canRemoveStaff", () => {
  it("lets an Admin remove a staff member", () => {
    expect(canRemoveStaff(context())).toEqual({ allowed: true });
  });

  it("refuses every non-Admin actor", () => {
    for (const actor of APP_ROLES.filter((r) => r !== "admin")) {
      const decision = canRemoveStaff(
        context({ actor: { role: actor, email: "someone@faceprep.in" } }),
      );
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toMatch(/only an admin/i);
    }
  });

  it("refuses to let an Admin remove themselves", () => {
    const decision = canRemoveStaff(
      context({ target: { email: "ADMIN@faceprep.in", role: "admin" } }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/your own account/i);
  });

  it("refuses to remove the last Admin", () => {
    const decision = canRemoveStaff(
      context({
        actor: { role: "admin", email: "other-admin@faceprep.in" },
        target: { email: "admin@faceprep.in", role: "admin" },
        targetIsLastAdmin: true,
      }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/last admin/i);
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
