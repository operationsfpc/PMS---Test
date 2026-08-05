import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Approving a registration form verifies the semesters it declared.
 *
 * Found 2026-08-05 while fixing why published drives were invisible. All three
 * approved students in production carry `student_semesters.status = 'pending'`
 * - the coordinator approved their SRF, and the semester rows never moved.
 *
 * That matters because `academicStandingFrom` counts only VERIFIED semesters
 * (§7.2: eligibility is evaluated against verified data). With none verified
 * it returns null, the drives view falls back to `students.overall_cgpa` -
 * which the SRF deliberately never writes, because it is not the student's to
 * declare - and every one of them is judged at a CGPA of ZERO.
 *
 * Both live drives happen to set no CGPA cutoff, so nothing is wrong today.
 * The next drive that sets one silently excludes the entire cohort, and the
 * failure looks exactly like the one just fixed: an eligible student sees an
 * empty list and nobody can tell why.
 *
 * Approving the SRF is the coordinator saying "I have checked these figures
 * against these marksheets" - the queue shows them the semester lines and the
 * documents side by side. So approval is what verifies them.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const marksheet = async (studentId: string, n: number) => {
  const rows = await t.sql(
    `insert into student_documents (student_id, kind, storage_path, size_bytes)
     values ($1::uuid, 'semester_marksheet', $1::uuid::text || '/sem' || $2::text || '.pdf', 1000)
     returning id`,
    [studentId, n],
  );
  return rows[0]?.id as string;
};

const declare = async (studentId: string, n: number, cgpa: number) =>
  t.sql(
    `insert into student_semesters (student_id, semester_number, cgpa, declared_marks,
                                    marks_scale, current_arrears, history_of_arrears, marksheet_id)
     values ($1, $2, $3, $3, 'cgpa', 0, 0, $4)`,
    [studentId, n, cgpa, await marksheet(studentId, n)],
  );

const semestersOf = (studentId: string) =>
  t.sql(
    `select semester_number, status, verified_by, verified_at
       from student_semesters where student_id = $1 order by semester_number`,
    [studentId],
  );

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  await t.sql(`update students set srf_status = 'srf_submitted' where id = $1`, [ids.priya]);
  await declare(ids.priya, 1, 8.1);
  await declare(ids.priya, 2, 8.5);
}, 60_000);

describe("when a coordinator approves the form", () => {
  const approve = () =>
    t.asUser(
      ids.cpcUser,
      `update students set srf_status = 'srf_approved', srf_decided_at = now(), srf_decided_by = $2
        where id = $1`,
      [ids.priya, ids.cpcUser],
    );

  it("marks every declared semester verified", async () => {
    await approve();

    const rows = await semestersOf(ids.priya);
    expect(rows.map((r) => r.status)).toEqual(["verified", "verified"]);
  });

  /** `verified_has_verifier`: a verified line must name who verified it. */
  it("records who verified them", async () => {
    await approve();

    const rows = await semestersOf(ids.priya);
    expect(rows.every((r) => r.verified_by === ids.cpcUser)).toBe(true);
    expect(rows.every((r) => r.verified_at !== null)).toBe(true);
  });

  it("leaves the figures themselves untouched", async () => {
    await approve();

    const rows = await t.sql(
      `select cgpa from student_semesters where student_id = $1 and semester_number = 2`,
      [ids.priya],
    );
    expect(Number(rows[0]?.cgpa)).toBe(8.5);
  });
});

describe("when a coordinator does not approve", () => {
  it("leaves the semesters pending when the form is sent back", async () => {
    await t.asUser(
      ids.cpcUser,
      `update students set srf_status = 'srf_rejected', srf_rejection_reason = 'Marks do not match',
              srf_decided_at = now(), srf_decided_by = $2
        where id = $1`,
      [ids.priya, ids.cpcUser],
    );

    const rows = await semestersOf(ids.priya);
    expect(rows.map((r) => r.status)).toEqual(["pending", "pending"]);
  });

  /**
   * A resubmission replaces the semester rows outright (`submit_srf`), so the
   * new lines arrive pending and must be checked again. This asserts the
   * default rather than the trigger, because that is what protects a student
   * from carrying a verification across a change of figures.
   */
  it("leaves a freshly declared semester pending", async () => {
    await declare(ids.priya, 3, 9.0);

    const rows = await semestersOf(ids.priya);
    expect(rows[2]?.status).toBe("pending");
  });
});
