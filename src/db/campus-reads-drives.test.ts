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

describe("campus staff read their students' shortlist standing (0045)", () => {
  it("shows the campus coordinator their own student's entry, and only theirs", async () => {
    const drive = (await t.sql(`select id from drives where company_name = 'Zoho'`))[0]
      ?.id as string;

    // One application per campus: Priya is the coordinator's, Arjun is not.
    for (const student of [ids.priya, ids.arjun]) {
      const app = (
        await t.sql(
          `insert into applications (drive_id, student_id, profile_snapshot)
           values ($1, $2, '{}'::jsonb) returning id`,
          [drive, student],
        )
      )[0]?.id as string;
      await t.sql(
        `insert into shortlist_entries (application_id, included, decided_by)
         values ($1, true, $2)`,
        [app, ids.centralUser],
      );
    }

    const rows = await t.asUser(
      ids.cpcUser,
      `select a.student_id from shortlist_entries se join applications a on a.id = se.application_id`,
    );
    expect(rows.map((r) => r.student_id)).toEqual([ids.priya]);
  });

  /**
   * 0122: this used to assert the campus coordinator "decides nothing". The
   * interface had already invited them onto the shortlisting screen for years \u2014
   * `canShortlistFromPortfolio` and the route guard both let them through \u2014 so
   * the write is now the same width as the read: their own students' rows.
   * Arjun's row is still silently filtered, which is the campus bound holding.
   */
  it("lets them decide their own student's shortlist, and only that", async () => {
    await t.asUser(
      ids.cpcUser,
      `update shortlist_entries set included = false
        where application_id in (select id from applications where student_id = $1)`,
      [ids.priya],
    );

    const rows = await t.sql(
      `select a.student_id, se.included from shortlist_entries se
         join applications a on a.id = se.application_id`,
    );
    const byStudent = new Map(rows.map((r) => [r.student_id as string, r.included as boolean]));
    expect(byStudent.get(ids.priya)).toBe(false);
    expect(byStudent.get(ids.arjun)).toBe(true);
  });

  it("still refuses them a shortlist row for another campus's applicant", async () => {
    // A fresh drive and a fresh application, so the rejection below can only
    // come from the campus bound in `shortlist_campus_write` — not from a row
    // that already existed and shrugged the insert off.
    const drive = (
      await t.sql(
        `insert into drives (company_name, created_by, status)
         values ('Fresh Corp', $1, 'draft') returning id`,
        [ids.centralUser],
      )
    )[0]?.id as string;
    const application = (
      await t.sql(
        `insert into applications (drive_id, student_id, profile_snapshot)
         values ($1, $2, '{}'::jsonb) returning id`,
        [drive, ids.arjun],
      )
    )[0]?.id as string;

    await t.expectRejection(
      () =>
        t.asUser(
          ids.cpcUser,
          `insert into shortlist_entries (application_id, included) values ($1, true)`,
          [application],
        ),
      /row-level security|policy/i,
    );

    const rows = await t.sql(`select 1 from shortlist_entries where application_id = $1`, [
      application,
    ]);
    expect(rows).toHaveLength(0);
  });
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
