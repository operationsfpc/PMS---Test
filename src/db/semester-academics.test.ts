import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Semester-wise academics, confirmed 2026-08-04.
 *
 * A student declares whether they are pursuing UG or PG. UG records up to 10
 * semester lines, PG up to 4 plus a single aggregate for the UG they already
 * finished. The cap depends on the student's own programme level, which a CHECK
 * constraint cannot see, so it is a trigger.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const addSemesters = (studentId: string, count: number, from = 1) =>
  t.sql(
    `insert into student_semesters (student_id, semester_number, cgpa)
     select $1, generate_series($2::int, $3::int), 8.0`,
    [studentId, from, from + count - 1],
  );

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
}, 60_000);

describe("a student's programme level", () => {
  it("defaults to undergraduate, which is what a campus roster mostly holds", async () => {
    const rows = await t.sql(`select programme_level from students where id = $1`, [ids.priya]);
    expect(rows[0]?.programme_level).toBe("ug");
  });

  it("can be set to postgraduate", async () => {
    await t.sql(`update students set programme_level = 'pg' where id = $1`, [ids.priya]);
    const rows = await t.sql(`select programme_level from students where id = $1`, [ids.priya]);
    expect(rows[0]?.programme_level).toBe("pg");
  });

  it("carries a single aggregate for the UG a postgraduate already finished", async () => {
    await t.sql(
      `update students set programme_level = 'pg', ug_aggregate_cgpa = 7.85 where id = $1`,
      [ids.priya],
    );
    const rows = await t.sql(`select ug_aggregate_cgpa from students where id = $1`, [ids.priya]);
    expect(Number(rows[0]?.ug_aggregate_cgpa)).toBe(7.85);
  });
});

describe("the semester cap", () => {
  it("lets an undergraduate record ten semesters", async () => {
    await addSemesters(ids.priya, 10);
    const rows = await t.sql(`select count(*) as n from student_semesters where student_id = $1`, [
      ids.priya,
    ]);
    expect(Number(rows[0]?.n)).toBe(10);
  });

  it("refuses an eleventh for an undergraduate", async () => {
    await addSemesters(ids.priya, 10);
    await t.expectRejection(
      () => addSemesters(ids.priya, 1, 11),
      /at most 10 semesters|outside the range/i,
    );
  });

  it("lets a postgraduate record four", async () => {
    await t.sql(`update students set programme_level = 'pg' where id = $1`, [ids.priya]);
    await addSemesters(ids.priya, 4);
    const rows = await t.sql(`select count(*) as n from student_semesters where student_id = $1`, [
      ids.priya,
    ]);
    expect(Number(rows[0]?.n)).toBe(4);
  });

  it("refuses a fifth for a postgraduate", async () => {
    await t.sql(`update students set programme_level = 'pg' where id = $1`, [ids.priya]);
    await addSemesters(ids.priya, 4);
    await t.expectRejection(() => addSemesters(ids.priya, 1, 5), /at most 4 semesters/i);
  });

  /** The cap is per student, not global. */
  it("does not count another student's semesters", async () => {
    await addSemesters(ids.priya, 10);
    await expect(addSemesters(ids.arjun, 10)).resolves.toBeDefined();
  });
});
