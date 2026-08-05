import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * A Campus Placement Coordinator is mapped to ONE campus.
 *
 * Confirmed 2026-08-05. The mapping is where a coordinator's authority comes
 * from: `my_student_ids()` reads `staff_campus_assignments` to decide whose
 * marksheets they may verify and whose registration they may approve. A second
 * row silently widens that authority over students another coordinator owns.
 *
 * The rule lives in `src/domain/staff.ts` and the admin screen applies it, but
 * the screen is not the only thing that can write here - an import, a fix-up
 * script or a future feature can too. So the database enforces it as well.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
  // The seed maps the coordinator to campus A already.
}, 60_000);

describe("one campus per coordinator", () => {
  it("keeps the mapping the seed created", async () => {
    const rows = await t.sql(
      `select campus_id from staff_campus_assignments where profile_id = $1`,
      [ids.cpcUser],
    );

    expect(rows).toHaveLength(1);
  });

  it("refuses a second campus for a placement coordinator", async () => {
    await t.expectRejection(
      () =>
        t.sql(`insert into staff_campus_assignments (profile_id, campus_id) values ($1, $2)`, [
          ids.cpcUser,
          ids.campusB,
        ]),
      /one campus/i,
    );
  });

  it("lets a coordinator be MOVED to a different campus", async () => {
    await t.sql(`delete from staff_campus_assignments where profile_id = $1`, [ids.cpcUser]);
    await t.sql(`insert into staff_campus_assignments (profile_id, campus_id) values ($1, $2)`, [
      ids.cpcUser,
      ids.campusB,
    ]);

    const rows = await t.sql(
      `select campus_id from staff_campus_assignments where profile_id = $1`,
      [ids.cpcUser],
    );
    expect(rows[0]?.campus_id).toBe(ids.campusB);
  });

  /** Campus Managers genuinely span campuses; the rule is not theirs. */
  it("lets a campus manager hold two campuses", async () => {
    await t.sql(
      `insert into staff_invitations (email, full_name, role)
       values ('cm@faceprep.in', 'Campus Manager', 'campus_manager')
       on conflict (email) do nothing`,
    );
    await t.sql(`insert into auth.users (id, email) values ($1, 'cm@faceprep.in')`, [
      "30000000-0000-0000-0000-000000000009",
    ]);

    await t.sql(
      `insert into staff_campus_assignments (profile_id, campus_id) values ($1,$2), ($1,$3)`,
      ["30000000-0000-0000-0000-000000000009", ids.campusA, ids.campusB],
    );

    const rows = await t.sql(
      `select campus_id from staff_campus_assignments where profile_id = $1`,
      ["30000000-0000-0000-0000-000000000009"],
    );
    expect(rows).toHaveLength(2);
  });

  /**
   * The drift that hid the re-submission bug for a day, in another table:
   * 0008 grants no DELETE on anything, so a mapping could be created and never
   * changed on a database built purely from these migrations - while
   * production, which ships with `grant all`, worked fine.
   */
  it("lets an admin actually remove a mapping, not just create one", async () => {
    const granted = await t.sql(
      `select has_table_privilege('authenticated', 'staff_campus_assignments', 'delete') as ok`,
    );

    expect(granted[0]?.ok).toBe(true);
  });
});
