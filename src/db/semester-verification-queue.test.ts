import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0061 — the semester (CGPA) verification queue's database half.
 *
 * 2026-08-24 UAT: a semester added after SRF approval sat `pending` forever —
 * no queue, no rejection path. Mirrors certificates (0038): a rejection names
 * its reason on the row, and a REJECTED line becomes the student's to remove,
 * which is how a corrected figure gets re-declared (the unique
 * (student_id, semester_number) key would otherwise block it for good).
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  // current_student_id() maps auth.uid() to the student row.
  await t.sql(`insert into auth.users (id, email) values ($1, 'priya@gmail.com')`, [ids.priyaUser]);
}, 60_000);

async function addPending(semester: number): Promise<string> {
  const [doc] = await t.sql(
    `insert into student_documents (student_id, kind, storage_path, size_bytes)
     values ($1, 'semester_marksheet', $2, 1000) returning id`,
    [ids.priya, `${ids.priya}/sem-${semester}.pdf`],
  );
  const [row] = await t.sql(
    `insert into student_semesters
       (student_id, semester_number, cgpa, current_arrears, history_of_arrears,
        marksheet_id, status)
     values ($1, $2, 7.5, 0, 0, $3, 'pending') returning id`,
    [ids.priya, semester, doc?.id],
  );
  return row?.id as string;
}

describe("0061 — rejecting a declared semester", () => {
  it("records the rejection with its reason", async () => {
    const id = await addPending(3);

    await t.asUser(
      ids.cpcUser,
      `update student_semesters
          set status = 'rejected', rejection_reason = 'Marksheet says 6.9',
              verified_by = $2, verified_at = now()
        where id = $1`,
      [id, ids.cpcUser],
    );

    const [row] = await t.sql(
      `select status, rejection_reason from student_semesters
       where id = $1`,
      [id],
    );
    expect(row?.status).toBe("rejected");
    expect(row?.rejection_reason).toBe("Marksheet says 6.9");
  });

  it("refuses a rejection with no reason", async () => {
    const id = await addPending(4);

    await t.expectRejection(
      () =>
        t.asUser(
          ids.cpcUser,
          `update student_semesters set status = 'rejected', verified_by = $2, verified_at = now()
            where id = $1`,
          [id, ids.cpcUser],
        ),
      /semester_rejected_has_reason/i,
    );
  });

  it("lets the student remove their own REJECTED line, to re-declare it", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `delete from student_semesters where semester_number = 3 and student_id = $1 returning id`,
      [ids.priya],
    );
    expect(rows).toHaveLength(1);
  });

  it("never lets the student remove a VERIFIED line", async () => {
    const id = await addPending(5);
    await t.asUser(
      ids.cpcUser,
      `update student_semesters set status = 'verified', verified_by = $2, verified_at = now()
        where id = $1`,
      [id, ids.cpcUser],
    );

    const rows = await t.asUser(
      ids.priyaUser,
      `delete from student_semesters where id = $1 returning id`,
      [id],
    );
    expect(rows).toHaveLength(0);
  });
});
