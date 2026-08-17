import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

/**
 * 2026-08-17 (Karthik): "AE can only raise drives (no one else can raise a
 * drive). Delivery head can only approve (delivery head cannot raise a drive).
 * ... Central PC cannot raise or approve a drive."
 *
 * 0008 gave BOTH the Delivery Head and the operators (`is_operator()` = admin
 * and Central CPC) `for all` on drives, which includes INSERT. So either of
 * the two people meant to be checking the Account Executive's work could
 * quietly raise a drive of their own and then approve or publish it
 * themselves. The UI never offered it; the database allowed it, and the
 * database is the part that decides.
 *
 * These tests are about WHO MAY INSERT. The status transitions themselves are
 * 0009's job and are tested separately.
 */
describe("only an Account Executive may raise a drive", () => {
  let t: TestDb;

  const ae = "11111111-1111-1111-1111-111111111111";
  const dh = "22222222-2222-2222-2222-222222222222";
  const cpc = "33333333-3333-3333-3333-333333333333";
  const admin = "44444444-4444-4444-4444-444444444444";

  beforeAll(async () => {
    t = await createTestDb();

    for (const [id, role, email] of [
      [ae, "account_executive", "ae@faceprep.in"],
      [dh, "delivery_head", "dh@faceprep.in"],
      [cpc, "central_placement_coordinator", "cpc@faceprep.in"],
      [admin, "admin", "admin2@faceprep.in"],
    ] as const) {
      // The invitation row IS the allowlist: a profile cannot exist without one.
      await t.sql(
        `insert into staff_invitations (email, full_name, role) values ($1, $2, $3::app_role)`,
        [email, role, role],
      );
      // Signing in claims the invitation and creates the profile, role and all.
      await t.sql(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    }
  });

  const raiseAs = (userId: string, company: string) =>
    t.asUser(
      userId,
      `insert into drives (company_name, created_by, status) values ($1, $2, 'draft')`,
      [company, userId],
    );

  it("lets the Account Executive raise one", async () => {
    await raiseAs(ae, "Zoho");
    const rows = await t.sql(`select company_name from drives where company_name = 'Zoho'`);
    expect(rows).toHaveLength(1);
  });

  it("refuses the Delivery Head, who would otherwise approve their own drive", async () => {
    await t.expectRejection(() => raiseAs(dh, "DH Corp"), /row-level security|policy/i);
  });

  it("refuses the Central Placement Coordinator, who would otherwise publish their own", async () => {
    await t.expectRejection(() => raiseAs(cpc, "CPC Corp"), /row-level security|policy/i);
  });

  /** Admin sets up the organisation. That is not a licence to run a drive. */
  it("refuses an Admin", async () => {
    await t.expectRejection(() => raiseAs(admin, "Admin Corp"), /row-level security|policy/i);
  });

  it("leaves nothing behind from the refused attempts", async () => {
    const rows = await t.sql(
      `select company_name from drives where company_name in ('DH Corp', 'CPC Corp', 'Admin Corp')`,
    );
    expect(rows).toEqual([]);
  });

  /**
   * An AE must not be able to raise a drive in someone else's name either -
   * the ownership column is what scopes every later read.
   */
  it("does not let an AE raise a drive attributed to another AE", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ae,
          `insert into drives (company_name, created_by, status) values ('Forged', $1, 'draft')`,
          [dh],
        ),
      /row-level security|policy/i,
    );
  });

  /**
   * The hole 0047 also closed. 0008 checked no status on INSERT, and 0009's
   * transition guard only runs on UPDATE - so an AE could have inserted a
   * drive that was already approved, or already live, and stepped past the
   * Delivery Head and the Central CPC in a single statement.
   */
  it.each(["approved", "live", "in_rounds", "completed"] as const)(
    "refuses an AE raising a drive straight into %s",
    async (status) => {
      await t.expectRejection(
        () =>
          t.asUser(
            ae,
            `insert into drives (company_name, created_by, status)
             values ($1, $2, $3::drive_status)`,
            [`Jumped ${status}`, ae, status],
          ),
        /row-level security|policy/i,
      );
    },
  );

  /** The two an AE legitimately starts from still work. */
  it.each(["draft", "submitted"] as const)("lets an AE start a drive as %s", async (status) => {
    await t.asUser(
      ae,
      `insert into drives (company_name, created_by, status)
       values ($1, $2, $3::drive_status)`,
      [`Start ${status}`, ae, status],
    );
    const rows = await t.sql(`select status from drives where company_name = $1`, [
      `Start ${status}`,
    ]);
    expect(rows[0]?.status).toBe(status);
  });
});
