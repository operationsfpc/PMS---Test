import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0063 — the resume rows written with their bucket in front.
 *
 * `apply-repository` recorded `resumes/<student>/<file>` while uploading the
 * object to `<student>/<file>` INSIDE the `resumes` bucket, so the recruiter
 * export asked for `resumes/resumes/<student>/<file>` and failed on the first
 * resume it touched. Verified against production on 2026-08-26: all 14 resume
 * rows were unresolvable — the pack had never once been built.
 *
 * The writer is fixed; this repairs what it already wrote. Participation
 * evidence keeps ITS bucket prefix, deliberately: one column there serves two
 * buckets and its reader splits the bucket back off.
 *
 * The schema is built to 0062, seeded with the rows as they exist today, and
 * only then stepped forward — a data repair cannot be tested against data
 * that was inserted after it ran.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const rows: Record<string, string> = {};

/** A student of their own, so `one_resume_per_category` is not the thing under test. */
const student = async (key: string) =>
  (
    await t.sql(
      `insert into students (campus_id, degree_id, branch_id, full_name, roll_number, email, passing_year)
       values ($1, $2, $3, $4, $5, $6, 2026) returning id`,
      [ids.campusA, ids.degree, ids.branch, `Fixture ${key}`, `ROLL-${key}`, `${key}@gmail.com`],
    )
  )[0]?.id as string;

/** A resume must name its role category and, since 0033, may name a drive. */
const insertDocument = async (key: string, kind: string, path: string) => {
  // 0003 allows ONE profile resume per category, so each fixture resume gets
  // its own student — the same shape the live rows have.
  const [row] = await t.sql(
    `insert into student_documents (student_id, kind, role_category, drive_id, storage_path, size_bytes)
     values ($1, $2, $3, null, $4, 1000) returning id`,
    [
      kind === "resume" ? await student(key) : ids.priya,
      kind,
      kind === "resume" ? "software_technical" : null,
      path,
    ],
  );
  rows[key] = row?.id as string;
};

const pathOf = async (key: string) =>
  (await t.sql(`select storage_path from student_documents where id = $1`, [rows[key]]))[0]
    ?.storage_path as string;

beforeAll(async () => {
  t = await createTestDb({ through: "0062" });
  ids = await seed(t);

  await insertDocument("prefixed", "resume", "student-1/d1-123-images (6).pdf");
  await t.sql(`update student_documents set storage_path = 'resumes/' || storage_path`);

  await insertDocument("bare", "resume", "student-2/profile-sales-abc-cv.pdf");
  await insertDocument("declaration", "opt_out_declaration", "declarations/s1/1785-form.pdf");
  await insertDocument("marksheet", "tenth_marksheet", "s1/tenth.pdf");
  await insertDocument("bucketOnly", "resume", "resumes/");
  await insertDocument("namesake", "resume", "resumes/student-3/resumes/cv.pdf");

  await t.migrateTo("0063");
});

describe("0063 — a resume path is the object key", () => {
  it("strips the bucket from a resume recorded with it", async () => {
    expect(await pathOf("prefixed")).toBe("student-1/d1-123-images (6).pdf");
  });

  it("leaves a resume already stored as a key alone", async () => {
    expect(await pathOf("bare")).toBe("student-2/profile-sales-abc-cv.pdf");
  });

  /**
   * The other buckets are not this bug. Participation evidence carries its
   * bucket ON PURPOSE, and a marksheet never carried one.
   */
  it("does not touch a document of any other kind", async () => {
    expect(await pathOf("declaration")).toBe("declarations/s1/1785-form.pdf");
    expect(await pathOf("marksheet")).toBe("s1/tenth.pdf");
  });

  /** A path that is only the bucket names no object; emptying it would hide that. */
  it("leaves a bare bucket name alone rather than emptying the column", async () => {
    expect(await pathOf("bucketOnly")).toBe("resumes/");
  });

  it("strips only the leading bucket, not a folder that shares its name", async () => {
    expect(await pathOf("namesake")).toBe("student-3/resumes/cv.pdf");
  });

  /** Idempotent: running it twice must not eat a second segment. */
  it("does nothing the second time it runs", async () => {
    await t.sql(
      `update student_documents set storage_path = replace(storage_path, 'resumes/', 'resumes/')`,
    );
    await t.migrateTo("0063");

    expect(await pathOf("prefixed")).toBe("student-1/d1-123-images (6).pdf");
  });
});
