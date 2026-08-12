import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * D10 (2026-08-12): the campus placement coordinator "should retain
 * visibility through the entire cycle — not just till shortlist, but through
 * to offer sent/offer made."
 *
 * Their students' applications, rounds and offers were already campus-scoped
 * readable (0018, 0043). The DRIVE those rows belong to was not: is_org_reader
 * excludes campus roles, so the progress screen would name every student and
 * no company. 0044 lets campus readers see drives — read-only; publishing and
 * editing stay exactly where they were.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await t.sql(
    `insert into drives (company_name, created_by, status) values ('Zoho', $1, 'draft')`,
    [ids.centralUser],
  );
});

describe("campus staff read drives (0044)", () => {
  it("lets the campus coordinator read a drive", async () => {
    const rows = await t.asUser(ids.cpcUser, `select company_name from drives`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("still refuses them any write to it", async () => {
    const before = await t.sql(`select status from drives where company_name = 'Zoho'`);
    await t.asUser(
      ids.cpcUser,
      `update drives set status = 'submitted' where company_name = 'Zoho'`,
    );
    const after = await t.sql(`select status from drives where company_name = 'Zoho'`);
    expect(after[0]?.status).toBe(before[0]?.status);
  });
});
