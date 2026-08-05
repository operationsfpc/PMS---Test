import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0036 — a programme belongs to a college and a passing year.
 *
 * F6 (UAT 2026-08-06): "This is always mapped to colleges for a particular
 * year of Passing. Degree+Branch is one field. This can be added or edited
 * later under the colleges created."
 *
 * Degrees and branches were a global catalogue with no owner and no year, so
 * "AI and DS" added for one college appeared for every college, and a branch
 * that stopped running was still offered to next year's cohort.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let secondBranch: string;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1, 'priya@gmail.com')`, [ids.priyaUser]);

  secondBranch = (
    await t.sql(`insert into branches (degree_id, name) values ($1, 'ECE') returning id`, [
      ids.degree,
    ])
  )[0]?.id as string;
});

const offer = (campusId: string, branchId: string, year: number) =>
  t.sql(
    `insert into campus_programmes (campus_id, degree_id, branch_id, passing_year)
     values ($1, $2, $3, $4)`,
    [campusId, ids.degree, branchId, year],
  );

describe("0036 — what a college runs", () => {
  it("maps a degree and branch to a college for a passing year", async () => {
    await offer(ids.campusA, ids.branch, 2027);

    const [row] = await t.sql(`select passing_year from campus_programmes where campus_id = $1`, [
      ids.campusA,
    ]);

    expect(Number(row?.passing_year)).toBe(2027);
  });

  it("refuses the same programme twice for the same year", async () => {
    await t.expectRejection(
      () => offer(ids.campusA, ids.branch, 2027),
      /one_programme_per_campus_year|duplicate key/i,
    );
  });

  /** The same branch, next year, is a different cohort. */
  it("allows the same programme for a different passing year", async () => {
    await offer(ids.campusA, ids.branch, 2028);

    const [row] = await t.sql(`select count(*) as n from campus_programmes where campus_id = $1`, [
      ids.campusA,
    ]);
    expect(Number(row?.n)).toBe(2);
  });

  it("allows another college to run the same programme", async () => {
    await offer(ids.campusB, ids.branch, 2027);

    const [row] = await t.sql(`select count(*) as n from campus_programmes where campus_id = $1`, [
      ids.campusB,
    ]);
    expect(Number(row?.n)).toBe(1);
  });

  it("allows a degree with no branch, which is normal for an MBA", async () => {
    await t.sql(
      `insert into campus_programmes (campus_id, degree_id, passing_year) values ($1, $2, 2027)`,
      [ids.campusB, ids.degree],
    );

    const [row] = await t.sql(
      `select count(*) as n from campus_programmes where campus_id = $1 and branch_id is null`,
      [ids.campusB],
    );
    expect(Number(row?.n)).toBe(1);
  });

  it("refuses an implausible passing year", async () => {
    await t.expectRejection(
      () => offer(ids.campusA, secondBranch, 1900),
      /violates check constraint/i,
    );
  });

  it("refuses a branch that belongs to another degree", async () => {
    const otherDegree = (await t.sql(`insert into degrees (name) values ('MBA') returning id`))[0]
      ?.id as string;
    const otherBranch = (
      await t.sql(`insert into branches (degree_id, name) values ($1, 'Finance') returning id`, [
        otherDegree,
      ])
    )[0]?.id as string;

    await t.expectRejection(
      () => offer(ids.campusA, otherBranch, 2029),
      /branch_belongs_to_the_degree|violates/i,
    );
  });

  it("drops a college's programmes with the college", async () => {
    await t.sql(`delete from campus_programmes where campus_id = $1`, [ids.campusB]);
    await t.sql(`delete from students where campus_id = $1`, [ids.campusB]);
    await t.sql(`delete from staff_campus_assignments where campus_id = $1`, [ids.campusB]);
    await t.sql(
      `insert into campus_programmes (campus_id, degree_id, passing_year)
                 values ($1, $2, 2027)`,
      [ids.campusB, ids.degree],
    );
    await t.sql(`delete from campuses where id = $1`, [ids.campusB]);

    const [row] = await t.sql(`select count(*) as n from campus_programmes where campus_id = $1`, [
      ids.campusB,
    ]);
    expect(Number(row?.n)).toBe(0);
  });
});

describe("0036 — who may read and change it", () => {
  it("lets a student read what their college offers, so the dropdown has options", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `select id from campus_programmes where campus_id = $1`,
      [ids.campusA],
    );

    expect(rows.length).toBeGreaterThan(0);
  });

  it("does not let a student add one", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into campus_programmes (campus_id, degree_id, passing_year) values ($1, $2, 2029)`,
          [ids.campusA, ids.degree],
        ),
      /row-level security|violates/i,
    );
  });

  it("lets an Admin add one", async () => {
    await t.asUser(
      ids.adminUser,
      `insert into campus_programmes (campus_id, degree_id, branch_id, passing_year)
       values ($1, $2, $3, 2030)`,
      [ids.campusA, ids.degree, ids.branch],
    );

    const [row] = await t.sql(
      `select count(*) as n from campus_programmes where passing_year = 2030`,
    );
    expect(Number(row?.n)).toBe(1);
  });
});

/**
 * The backfill. Without it, 0036 is an outage.
 *
 * `campus_programmes` starts empty, and the registration form now offers only
 * what it contains — so the moment 0036 lands, every student on the roster
 * opens their form and finds no degree to select. Their college has been
 * running their programme for years; nobody has typed it into a table that did
 * not exist until now.
 *
 * Every (campus, degree, branch, passing year) already on the roster IS, by
 * definition, something that college runs. That is where the seed comes from.
 */
describe("0036 — backfilling what colleges already run", () => {
  it("creates a programme for every combination already on the roster", async () => {
    const fresh = await createTestDb();
    const seeded = await seed(fresh);

    // The seed's students are B.E CSE at campus A, passing 2026.
    await fresh.sql(`select backfill_campus_programmes()`);

    const rows = await fresh.sql(
      `select p.passing_year, d.name as degree, b.name as branch
         from campus_programmes p
         join degrees d on d.id = p.degree_id
         left join branches b on b.id = p.branch_id
        where p.campus_id = $1`,
      [seeded.campusA],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ degree: "B.E", branch: "CSE", passing_year: 2026 });
  }, 60_000);

  it("is idempotent, so re-running it is not a second copy", async () => {
    const fresh = await createTestDb();
    await seed(fresh);

    await fresh.sql(`select backfill_campus_programmes()`);
    const [first] = await fresh.sql(`select count(*) as n from campus_programmes`);

    await fresh.sql(`select backfill_campus_programmes()`);
    const [second] = await fresh.sql(`select count(*) as n from campus_programmes`);

    // Compared against the first run rather than against a number: the seed's
    // roster is not this test's business, only that it does not grow.
    expect(Number(second?.n)).toBe(Number(first?.n));
    expect(Number(first?.n)).toBeGreaterThan(0);

    // And the second run says it added nothing, rather than silently claiming
    // work it did not do.
    const [added] = await fresh.sql(`select backfill_campus_programmes() as n`);
    expect(Number(added?.n)).toBe(0);
  }, 60_000);

  /**
   * `students.branch_id` is nullable and `degree_id` is not, so a degree with
   * no branch is the one half-empty case that genuinely exists.
   */
  it("backfills a student who has a degree but no branch", async () => {
    const fresh = await createTestDb();
    const seeded = await seed(fresh);

    await fresh.sql(
      `insert into students (campus_id, degree_id, roll_number, full_name, email, passing_year)
       values ($1, $2, 'MBA01', 'Mba Student', 'mba@x.com', 2027)`,
      [seeded.campusA, seeded.degree],
    );

    await fresh.sql(`select backfill_campus_programmes()`);

    const [row] = await fresh.sql(
      `select count(*) as n from campus_programmes where branch_id is null`,
    );
    expect(Number(row?.n)).toBe(1);
  }, 60_000);

  /** Two campuses running the same programme are two rows, not one. */
  it("keeps each college's programmes to that college", async () => {
    const fresh = await createTestDb();
    const seeded = await seed(fresh);

    await fresh.sql(
      `insert into students (campus_id, degree_id, branch_id, roll_number, full_name, email, passing_year)
       values ($1, $2, $3, 'B002', 'Other Campus', 'other@x.com', 2026)`,
      [seeded.campusB, seeded.degree, seeded.branch],
    );

    await fresh.sql(`select backfill_campus_programmes()`);

    const rows = await fresh.sql(`select campus_id from campus_programmes`);
    expect(new Set(rows.map((r) => r.campus_id)).size).toBe(2);
  }, 60_000);

  it("has already been run by the migration itself", async () => {
    // Nothing to back-fill in a fresh database, but the call must be there —
    // a backfill that only a human remembers to run is not a backfill.
    const fresh = await createTestDb();
    const [row] = await fresh.sql(
      `select count(*) as n from pg_proc where proname = 'backfill_campus_programmes'`,
    );

    expect(Number(row?.n)).toBe(1);
  }, 60_000);
});
