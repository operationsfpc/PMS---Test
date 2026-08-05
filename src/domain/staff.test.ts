import { describe, expect, it } from "vitest";
import {
  campusScopeFor,
  canChangeStaffRole,
  canInviteRole,
  canRemoveStaff,
  requiresCampusAssignment,
  type StaffChangeContext,
  validateCampusSelection,
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

/**
 * A Campus Placement Coordinator belongs to ONE campus.
 *
 * Confirmed 2026-08-05: "remember that a placement coordinator is for one
 * campus alone. this has to be mapped by admin while mapping their role."
 *
 * It is not a presentation detail. The CPC is the person who verifies a
 * student's marksheets and decides whether their registration is true, and
 * `my_student_ids()` derives that authority from this mapping. Two campuses
 * would silently widen it; none removes it entirely - which is exactly what
 * was found in production, where the only coordinator had no campus at all
 * and so could see no students to verify.
 */
describe("campusScopeFor", () => {
  it("gives a placement coordinator exactly one campus", () => {
    expect(campusScopeFor("campus_placement_coordinator")).toBe("one");
  });

  it("lets the roles that genuinely span campuses hold several", () => {
    expect(campusScopeFor("campus_manager")).toBe("many");
    expect(campusScopeFor("key_account_manager")).toBe("many");
  });

  it("gives organisation-wide roles no campus scope at all", () => {
    for (const role of ["admin", "central_placement_coordinator", "ceo"] as const) {
      expect(campusScopeFor(role)).toBe("none");
    }
  });
});

describe("validateCampusSelection", () => {
  it("accepts the one campus a coordinator is mapped to", () => {
    expect(validateCampusSelection("campus_placement_coordinator", ["c1"])).toEqual({ ok: true });
  });

  /** The live failure: a coordinator who can see nobody and cannot say why. */
  it("refuses a coordinator with no campus, which leaves them unable to work", () => {
    const result = validateCampusSelection("campus_placement_coordinator", []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/one campus/i);
  });

  it("refuses a coordinator spread across two campuses", () => {
    const result = validateCampusSelection("campus_placement_coordinator", ["c1", "c2"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/one campus/i);
  });

  it("lets a campus manager hold several", () => {
    expect(validateCampusSelection("campus_manager", ["c1", "c2"])).toEqual({ ok: true });
  });

  it("still refuses a campus-scoped role with nothing selected", () => {
    expect(validateCampusSelection("campus_manager", []).ok).toBe(false);
  });

  it("ignores a campus handed to a role that has no campus scope", () => {
    expect(validateCampusSelection("admin", [])).toEqual({ ok: true });
    expect(validateCampusSelection("ceo", ["c1"])).toEqual({ ok: true });
  });
});
