import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * The academic history the SRF actually collects, from 2026-08-06.
 *
 * The form asked for two school percentages and jumped straight to the degree.
 * It had nowhere to record WHICH school issued them, no diploma at all — the
 * route most polytechnic students take into an engineering degree — and no way
 * to say that a college reports percentages rather than a CGPA.
 *
 * The last of those is not cosmetic: every cutoff in this system is a CGPA on
 * the 10-point scale (`drives.min_overall_cgpa`), so a student whose college
 * reports 78% had to either mistype it as a CGPA of 7.8 (wrong, and a fifth of
 * a grade adrift) or be refused by a check constraint.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const marksheet = async (studentId: string, kind: string) => {
  const rows = await t.sql(
    // Cast explicitly: a uuid parameter reused inside a string concat leaves
    // Postgres unable to deduce one type for it.
    `insert into student_documents (student_id, kind, storage_path, size_bytes)
     values ($1::uuid, $2::document_kind, $1::text || '/' || $2::text || '-' || gen_random_uuid() || '.pdf', 1000)
     returning id`,
    [studentId, kind],
  );
  return rows[0]?.id as string;
};

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
}, 60_000);

describe("where each school figure came from", () => {
  it("records the school that issued the 10th and 12th marks", async () => {
    await t.sql(
      `update students set tenth_institution = $1, twelfth_institution = $2 where id = $3`,
      ["St Xavier's, Chennai", "DAV Higher Secondary", ids.priya],
    );

    const rows = await t.sql(
      `select tenth_institution, twelfth_institution from students where id = $1`,
      [ids.priya],
    );
    expect(rows[0]?.tenth_institution).toBe("St Xavier's, Chennai");
    expect(rows[0]?.twelfth_institution).toBe("DAV Higher Secondary");
  });
});

/**
 * Optional to declare — many students have none — but the moment a figure is
 * declared it is a mark a coordinator must verify against a document.
 */
describe("diploma", () => {
  it("accepts a student with no diploma at all", async () => {
    const rows = await t.sql(
      `select diploma_institution, diploma_marks from students where id = $1`,
      [ids.priya],
    );
    expect(rows[0]?.diploma_institution).toBeNull();
    expect(rows[0]?.diploma_marks).toBeNull();
  });

  it("records the college, the figure and the scale it was declared on", async () => {
    const doc = await marksheet(ids.priya, "diploma_marksheet");

    await t.sql(
      `update students set diploma_institution = $1, diploma_marks = $2,
              diploma_marks_scale = 'percentage', diploma_marksheet_id = $3
        where id = $4`,
      ["Government Polytechnic, Coimbatore", 78.5, doc, ids.priya],
    );

    const rows = await t.sql(
      `select diploma_marks, diploma_marks_scale, diploma_marksheet_id
         from students where id = $1`,
      [ids.priya],
    );
    expect(Number(rows[0]?.diploma_marks)).toBe(78.5);
    expect(rows[0]?.diploma_marks_scale).toBe("percentage");
    expect(rows[0]?.diploma_marksheet_id).toBe(doc);
  });

  it("refuses a declared diploma figure with no evidence behind it", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `update students set diploma_marks = 78.5, diploma_marks_scale = 'percentage'
                where id = $1`,
          [ids.priya],
        ),
      /diploma/i,
    );
  });

  it("refuses a diploma marksheet belonging to a different student", async () => {
    const theirs = await marksheet(ids.arjun, "diploma_marksheet");

    await t.expectRejection(
      () =>
        t.sql(
          `update students set diploma_marks = 78.5, diploma_marks_scale = 'percentage',
                  diploma_marksheet_id = $1 where id = $2`,
          [theirs, ids.priya],
        ),
      /own|student/i,
    );
  });
});

/**
 * "Some colleges have CGPA and some have % in college marks."
 *
 * Both are stored: the DECLARED figure with its scale, because that is what
 * the student typed and what the coordinator checks against the marksheet; and
 * the NORMALISED CGPA, because that is the only thing a cutoff can be compared
 * against. Storing one without the other loses either the audit trail or the
 * comparison.
 */
describe("a college that reports percentages", () => {
  const evidenced = async () => marksheet(ids.priya, "semester_marksheet");

  it("stores a percentage semester beside the CGPA it normalises to", async () => {
    const doc = await evidenced();

    await t.sql(
      `insert into student_semesters
         (student_id, semester_number, cgpa, declared_marks, marks_scale, marksheet_id)
       values ($1, 1, 8.21, 78, 'percentage', $2)`,
      [ids.priya, doc],
    );

    const rows = await t.sql(
      `select cgpa, declared_marks, marks_scale from student_semesters where student_id = $1`,
      [ids.priya],
    );
    // The comparable figure...
    expect(Number(rows[0]?.cgpa)).toBeCloseTo(8.21, 2);
    // ...and the one printed on the marksheet.
    expect(Number(rows[0]?.declared_marks)).toBe(78);
    expect(rows[0]?.marks_scale).toBe("percentage");
  });

  it("defaults to CGPA, so every existing row keeps its meaning", async () => {
    const doc = await evidenced();

    await t.sql(
      `insert into student_semesters (student_id, semester_number, cgpa, marksheet_id)
       values ($1, 1, 8.24, $2)`,
      [ids.priya, doc],
    );

    const rows = await t.sql(`select marks_scale from student_semesters where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows[0]?.marks_scale).toBe("cgpa");
  });

  it("still holds the normalised figure to the 10-point scale", async () => {
    const doc = await evidenced();

    // 78 is a fine percentage and a nonsense CGPA. The normalised column is
    // what every cutoff is compared against, so it may never hold one.
    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_semesters
             (student_id, semester_number, cgpa, declared_marks, marks_scale, marksheet_id)
           values ($1, 1, 78, 78, 'percentage', $2)`,
          [ids.priya, doc],
        ),
      /cgpa/i,
    );
  });

  it("lets a percentage go above 10 in the declared column, which is the point", async () => {
    const doc = await evidenced();

    await expect(
      t.sql(
        `insert into student_semesters
           (student_id, semester_number, cgpa, declared_marks, marks_scale, marksheet_id)
         values ($1, 1, 9.79, 93, 'percentage', $2)`,
        [ids.priya, doc],
      ),
    ).resolves.toBeDefined();
  });
});

/**
 * A postgraduate's completed undergraduate degree. The form asked only for an
 * aggregate CGPA, which told a recruiter nothing about WHERE or IN WHAT.
 */
describe("a postgraduate's completed UG degree", () => {
  it("records the degree, college and branch behind the aggregate", async () => {
    const doc = await marksheet(ids.priya, "ug_consolidated_marksheet");

    await t.sql(
      `update students set programme_level = 'pg', ug_degree = $1, ug_college = $2,
              ug_branch = $3, ug_aggregate_cgpa = 7.85, ug_aggregate_declared = 74.6,
              ug_aggregate_scale = 'percentage', ug_marksheet_id = $4
        where id = $5`,
      ["B.Sc Computer Science", "Loyola College", "Computer Science", doc, ids.priya],
    );

    const rows = await t.sql(
      `select ug_degree, ug_college, ug_branch, ug_aggregate_scale from students where id = $1`,
      [ids.priya],
    );
    expect(rows[0]?.ug_degree).toBe("B.Sc Computer Science");
    expect(rows[0]?.ug_college).toBe("Loyola College");
    expect(rows[0]?.ug_branch).toBe("Computer Science");
    expect(rows[0]?.ug_aggregate_scale).toBe("percentage");
  });
});
