import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0033 — a resume per DRIVE, not only per role category.
 *
 * F14 (UAT 2026-08-06): "Ask for a drive specific resume to be uploaded at the
 * time of applying."
 *
 * `one_resume_per_category` (0003) allowed exactly one resume per student per
 * role category. That is right for the profile resume the SRF collects, and
 * fatal for this: a student applying to their second software drive would hit
 * a unique violation and be told, wrongly, that something went wrong.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let driveA: string;
let driveB: string;

const resume = async (over: { driveId?: string | null; path: string }) =>
  (
    await t.sql(
      `insert into student_documents (student_id, kind, role_category, drive_id, storage_path, size_bytes)
       values ($1, 'resume', 'software_technical', $2, $3, 1000) returning id`,
      [ids.priya, over.driveId ?? null, over.path],
    )
  )[0]?.id as string;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  const drives = await t.sql(
    `insert into drives (company_name, role_title) values ('Zoho', 'MTS'), ('Freshworks', 'SDE')
     returning id`,
  );
  driveA = drives[0]?.id as string;
  driveB = drives[1]?.id as string;
});

describe("0033 — a resume attached to one application", () => {
  it("still allows exactly one profile resume per role category", async () => {
    await resume({ path: "priya/profile-software.pdf" });

    await t.expectRejection(
      () => resume({ path: "priya/profile-software-again.pdf" }),
      /one_resume_per_category|duplicate key/i,
    );
  });

  /** The whole point: applying twice in one category must not collide. */
  it("allows a separate resume for each drive in the same category", async () => {
    const first = await resume({ driveId: driveA, path: "priya/zoho.pdf" });
    const second = await resume({ driveId: driveB, path: "priya/freshworks.pdf" });

    expect(first).not.toBe(second);
  });

  it("refuses two resumes for the same drive, which would be a re-upload nobody asked for", async () => {
    // Its own drive: driveA and driveB already carry one each from the test
    // above, and reusing them would fail on the FIRST insert.
    const own = (
      await t.sql(`insert into drives (company_name) values ('Second thoughts') returning id`)
    )[0]?.id as string;

    await resume({ driveId: own, path: "priya/own-v1.pdf" });

    await t.expectRejection(
      () => resume({ driveId: own, path: "priya/own-v2.pdf" }),
      /one_resume_per_drive|duplicate key/i,
    );
  });

  it("keeps the drive resume separate from the profile one", async () => {
    const [row] = await t.sql(
      `select count(*) as n from student_documents
        where student_id = $1 and kind = 'resume' and drive_id is null`,
      [ids.priya],
    );

    expect(Number(row?.n)).toBe(1);
  });

  it("refuses a drive_id on anything that is not a resume", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_documents (student_id, kind, drive_id, storage_path, size_bytes)
           values ($1, 'tenth_marksheet', $2, 'priya/tenth.pdf', 1000)`,
          [ids.priya, driveA],
        ),
      /drive_document_is_a_resume|violates check constraint/i,
    );
  });

  it("drops a drive's resumes with the drive, rather than orphaning them", async () => {
    const doomed = (
      await t.sql(`insert into drives (company_name) values ('Doomed') returning id`)
    )[0]?.id as string;

    await resume({ driveId: doomed, path: "priya/doomed.pdf" });
    await t.sql(`delete from drives where id = $1`, [doomed]);

    const [row] = await t.sql(
      `select count(*) as n from student_documents where storage_path = 'priya/doomed.pdf'`,
    );
    expect(Number(row?.n)).toBe(0);
  });
});
