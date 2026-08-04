import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Every declared figure is evidenced by the document that proves it.
 *
 * `student_semesters.marksheet_id` was built in 0003 for exactly this and was
 * never written by anything. The SRF marked the uploads required, let the
 * student pick their files, and discarded them — so a coordinator opened the
 * verification queue, saw a declared CGPA and no document, and "verified" the
 * student's own typing.
 *
 * The application now stores and links them. This file is why that cannot
 * quietly stop being true: the database refuses an unevidenced semester,
 * refuses evidence belonging to somebody else, and refuses a resume dressed up
 * as a marksheet.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const document = async (
  studentId: string,
  kind = "semester_marksheet",
  path = `${studentId}/${kind}-${Math.random()}.pdf`,
) => {
  const rows = await t.sql(
    `insert into student_documents (student_id, kind, storage_path, size_bytes)
     values ($1, $2, $3, 1000) returning id`,
    [studentId, kind, path],
  );
  return rows[0]?.id as string;
};

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
  // Both students claim their rostered accounts: signing in is what binds
  // `auth_user_id`, and every policy below keys off it. Without this the
  // "as the student" tests would prove nothing about a real session.
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [ids.arjunUser]);
}, 60_000);

describe("a semester line and the marksheet that proves it", () => {
  it("accepts a semester evidenced by a marksheet", async () => {
    const marksheet = await document(ids.priya);

    await t.sql(
      `insert into student_semesters (student_id, semester_number, cgpa, marksheet_id)
       values ($1, 1, 8.24, $2)`,
      [ids.priya, marksheet],
    );

    const rows = await t.sql(`select marksheet_id from student_semesters where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows[0]?.marksheet_id).toBe(marksheet);
  });

  /**
   * The rule the whole change exists to enforce. A semester line with no
   * marksheet is a number nobody can check, and it would sit in the
   * verification queue looking exactly like one that had been evidenced.
   */
  it("refuses a semester line with no marksheet at all", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_semesters (student_id, semester_number, cgpa)
           values ($1, 1, 8.24)`,
          [ids.priya],
        ),
      /marksheet|null/i,
    );
  });

  /**
   * The foreign key only says "a document"; it does not say whose. Without
   * this, one student's marksheet could evidence another's CGPA — and the
   * coordinator, opening a correctly-signed link, would never know.
   */
  it("refuses a marksheet belonging to a different student", async () => {
    const arjuns = await document(ids.arjun);

    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_semesters (student_id, semester_number, cgpa, marksheet_id)
           values ($1, 1, 8.24, $2)`,
          [ids.priya, arjuns],
        ),
      /own|student/i,
    );
  });

  it("refuses a resume passed off as a marksheet", async () => {
    const resume = await t.sql(
      `insert into student_documents (student_id, kind, role_category, storage_path, size_bytes)
       values ($1, 'resume', 'software_technical', 'resumes/priya/cv.pdf', 1000) returning id`,
      [ids.priya],
    );

    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_semesters (student_id, semester_number, cgpa, marksheet_id)
           values ($1, 1, 8.24, $2)`,
          [ids.priya, resume[0]?.id],
        ),
      /marksheet/i,
    );
  });

  it("refuses to have the evidence swapped for someone else's afterwards", async () => {
    const mine = await document(ids.priya);
    const theirs = await document(ids.arjun);

    await t.sql(
      `insert into student_semesters (student_id, semester_number, cgpa, marksheet_id)
       values ($1, 1, 8.24, $2)`,
      [ids.priya, mine],
    );

    await t.expectRejection(
      () =>
        t.sql(`update student_semesters set marksheet_id = $1 where student_id = $2`, [
          theirs,
          ids.priya,
        ]),
      /own|student/i,
    );
  });
});

/**
 * A postgraduate declares one aggregate CGPA standing in for an entire
 * completed degree (0017). Unevidenced it is the largest unverifiable figure
 * on the form, so it is treated like any other declared mark (A31).
 */
describe("a postgraduate's completed undergraduate degree", () => {
  it("records the consolidated marksheet that evidences the aggregate", async () => {
    const consolidated = await document(ids.priya, "ug_consolidated_marksheet");

    await t.sql(
      `update students set programme_level = 'pg', ug_aggregate_cgpa = 7.85,
              ug_marksheet_id = $1 where id = $2`,
      [consolidated, ids.priya],
    );

    const rows = await t.sql(`select ug_marksheet_id from students where id = $1`, [ids.priya]);
    expect(rows[0]?.ug_marksheet_id).toBe(consolidated);
  });

  it("refuses a consolidated marksheet belonging to a different student", async () => {
    const arjuns = await document(ids.arjun, "ug_consolidated_marksheet");

    await t.expectRejection(
      () => t.sql(`update students set ug_marksheet_id = $1 where id = $2`, [arjuns, ids.priya]),
      /own|student/i,
    );
  });
});

/**
 * The student writes this themselves, at submission, so it has to work as
 * them — not as the superuser PGlite otherwise runs as, which bypasses RLS
 * and would prove nothing.
 */
describe("as the student who is submitting", () => {
  it("may store their own marksheet and evidence their own semester with it", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `insert into student_documents (student_id, kind, storage_path, size_bytes)
       values ($1, 'semester_marksheet', 'priya/semester-1.pdf', 2048) returning id`,
      [ids.priya],
    );

    await t.asUser(
      ids.priyaUser,
      `insert into student_semesters (student_id, semester_number, cgpa, marksheet_id)
       values ($1, 1, 8.24, $2)`,
      [ids.priya, rows[0]?.id],
    );

    const stored = await t.asUser(
      ids.priyaUser,
      `select cgpa, marksheet_id, status from student_semesters where student_id = $1`,
      [ids.priya],
    );
    expect(stored[0]?.marksheet_id).toBe(rows[0]?.id);
    // Pending: a line the student typed decides nothing until it is verified.
    expect(stored[0]?.status).toBe("pending");
  });

  it("may not store a marksheet against another student", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into student_documents (student_id, kind, storage_path, size_bytes)
           values ($1, 'semester_marksheet', 'arjun/forged.pdf', 2048)`,
          [ids.arjun],
        ),
      /row-level security|policy/i,
    );
  });
});
