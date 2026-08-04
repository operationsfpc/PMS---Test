import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Changing a staff member's role, and removing them outright.
 *
 * Both are Admin-only and both are destructive, so they are proven here as a
 * real signed-in user with RLS enforced, not against a mock. `authenticated`
 * was never granted DELETE by 0008's blanket grant, which is exactly the kind
 * of gap that only shows up as a 42501 in production.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
const AE_USER = "30000000-0000-0000-0000-0000000000ae";

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae@faceprep.in','Shashwathi AE','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae@faceprep.in')`, [AE_USER]);
}, 60_000);

describe("an Admin changing a staff member's role", () => {
  it("updates the profile they sign in with", async () => {
    await t.asUser(
      ids.adminUser,
      `update profiles set role = 'delivery_head' where email = 'ae@faceprep.in'`,
    );

    const rows = await t.sql(`select role from profiles where email = 'ae@faceprep.in'`);
    expect(rows[0]?.role).toBe("delivery_head");
  });

  /**
   * The invitation carries the role that gets materialised on first sign-in.
   * Changing only the profile would leave the two disagreeing, and anyone who
   * had not signed in yet would arrive with the old role.
   */
  it("updates the invitation too, so an unaccepted invite lands on the new role", async () => {
    await t.asUser(
      ids.adminUser,
      `update staff_invitations set role = 'delivery_head' where email = 'ae@faceprep.in'`,
    );

    const rows = await t.sql(`select role from staff_invitations where email = 'ae@faceprep.in'`);
    expect(rows[0]?.role).toBe("delivery_head");
  });

  it("refuses a non-Admin, even one who can read the staff list", async () => {
    await t.asUser(
      ids.centralUser,
      `update profiles set role = 'admin' where email = 'ae@faceprep.in'`,
    );

    const rows = await t.sql(`select role from profiles where email = 'ae@faceprep.in'`);
    expect(rows[0]?.role).toBe("account_executive");
  });
});

describe("an Admin removing a staff member", () => {
  it("deletes the invitation, which is the login allowlist entry", async () => {
    await t.asUser(ids.adminUser, `delete from staff_invitations where email = 'ae@faceprep.in'`);

    const rows = await t.sql(`select email from staff_invitations where email = 'ae@faceprep.in'`);
    expect(rows).toHaveLength(0);
  });

  it("deletes the profile, so an existing session resolves to nobody", async () => {
    await t.asUser(ids.adminUser, `delete from profiles where email = 'ae@faceprep.in'`);

    const rows = await t.sql(`select id from profiles where email = 'ae@faceprep.in'`);
    expect(rows).toHaveLength(0);
  });

  it("takes their campus assignments with them", async () => {
    await t.sql(`insert into staff_campus_assignments (profile_id, campus_id) values ($1,$2)`, [
      AE_USER,
      ids.campusA,
    ]);

    await t.asUser(ids.adminUser, `delete from profiles where email = 'ae@faceprep.in'`);

    const rows = await t.sql(
      `select campus_id from staff_campus_assignments where profile_id = $1`,
      [AE_USER],
    );
    expect(rows).toHaveLength(0);
  });

  it("clears any campuses staged against an invitation that was never accepted", async () => {
    await t.sql(`insert into staff_campus_invitations (email, campus_id) values ($1,$2)`, [
      "ae@faceprep.in",
      ids.campusA,
    ]);

    await t.asUser(
      ids.adminUser,
      `delete from staff_campus_invitations where email = 'ae@faceprep.in'`,
    );

    const rows = await t.sql(
      `select campus_id from staff_campus_invitations where email = 'ae@faceprep.in'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses a non-Admin", async () => {
    await t.asUser(ids.centralUser, `delete from staff_invitations where email = 'ae@faceprep.in'`);

    const rows = await t.sql(`select email from staff_invitations where email = 'ae@faceprep.in'`);
    expect(rows).toHaveLength(1);
  });

  /**
   * PRD §19: the audit trail is append-only and must keep its attribution. A
   * staff member who has raised a drive cannot be erased, or the drive loses
   * the person accountable for it. Deactivation is the remedy, and the app has
   * to be told that clearly rather than silently doing half the job.
   */
  it("refuses to erase someone whose work is still referenced", async () => {
    await t.sql(
      `insert into drives (company_name, created_by, status) values ('TCS', $1, 'draft')`,
      [AE_USER],
    );

    await t.expectRejection(
      () => t.asUser(ids.adminUser, `delete from profiles where email = 'ae@faceprep.in'`),
      /violates foreign key constraint/i,
    );
  });
});
