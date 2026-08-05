import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0034 — a certificate is a name and a document.
 *
 * F17 (UAT 2026-08-06): "Name of certificate + upload certificate."
 * F9: "students can upload certificates multiple times, which should be
 * restricted to a single upload."
 *
 * The form collected a free-text "Certifications" box, so nothing was
 * verifiable and nothing was unique.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const document = async (path: string) =>
  (
    await t.sql(
      `insert into student_documents (student_id, kind, storage_path, size_bytes)
       values ($1, 'certificate', $2, 1000) returning id`,
      [ids.priya, path],
    )
  )[0]?.id as string;

const certificate = async (name: string, path: string) =>
  t.sql(`insert into student_certificates (student_id, name, document_id) values ($1, $2, $3)`, [
    ids.priya,
    name,
    await document(path),
  ]);

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  // `current_student_id()` maps auth.uid() to the student row, so the RLS
  // tests below need the student to have signed in at all.
  await t.sql(`insert into auth.users (id, email) values ($1, 'priya@gmail.com')`, [ids.priyaUser]);
}, 60_000);

describe("0034 — student certificates", () => {
  it("stores a certificate against its document", async () => {
    await certificate("AWS Cloud Practitioner", "priya/aws.pdf");

    const [row] = await t.sql(
      `select name, document_id from student_certificates where student_id = $1`,
      [ids.priya],
    );

    expect(row?.name).toBe("AWS Cloud Practitioner");
    expect(row?.document_id).not.toBeNull();
  });

  /** F9, in the schema: no screen can forget to enforce it. */
  it("refuses the same certificate twice", async () => {
    await t.expectRejection(
      () => certificate("AWS Cloud Practitioner", "priya/aws-again.pdf"),
      /one_certificate_per_name|duplicate key/i,
    );
  });

  it("refuses it however it is capitalised or spaced", async () => {
    await t.expectRejection(
      () => certificate("  aws   cloud practitioner ", "priya/aws-third.pdf"),
      /one_certificate_per_name|duplicate key/i,
    );
  });

  it("allows a genuinely different certificate", async () => {
    await certificate("Azure Fundamentals", "priya/azure.pdf");

    const [row] = await t.sql(
      `select count(*) as n from student_certificates where student_id = $1`,
      [ids.priya],
    );
    expect(Number(row?.n)).toBe(2);
  });

  it("refuses a certificate with no name", async () => {
    await t.expectRejection(
      () => certificate("   ", "priya/unnamed.pdf"),
      /certificate_has_a_name|violates check constraint/i,
    );
  });

  /** A name with no document is exactly the unverifiable claim F17 removes. */
  it("refuses a certificate with no document", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_certificates (student_id, name) values ($1, 'Nothing attached')`,
          [ids.priya],
        ),
      /not-null|null value/i,
    );
  });

  it("lets another student hold the same certificate", async () => {
    const doc = (
      await t.sql(
        `insert into student_documents (student_id, kind, storage_path, size_bytes)
         values ($1, 'certificate', 'arjun/aws.pdf', 1000) returning id`,
        [ids.arjun],
      )
    )[0]?.id as string;

    await t.sql(
      `insert into student_certificates (student_id, name, document_id) values ($1, $2, $3)`,
      [ids.arjun, "AWS Cloud Practitioner", doc],
    );

    const [row] = await t.sql(
      `select count(*) as n from student_certificates where student_id = $1`,
      [ids.arjun],
    );
    expect(Number(row?.n)).toBe(1);
  });

  it("removes the certificate with the student, rather than orphaning it", async () => {
    await t.sql(`delete from students where id = $1`, [ids.arjun]);

    const [row] = await t.sql(
      `select count(*) as n from student_certificates where student_id = $1`,
      [ids.arjun],
    );
    expect(Number(row?.n)).toBe(0);
  });
});

describe("0034 — who may see a certificate", () => {
  it("lets the student read their own", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `select id from student_certificates where student_id = $1`,
      [ids.priya],
    );

    expect(rows.length).toBeGreaterThan(0);
  });

  it("does not let one student read another's", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `select id from student_certificates where student_id <> $1`,
      [ids.priya],
    );

    expect(rows).toHaveLength(0);
  });

  it("lets the coordinator who verifies them read them", async () => {
    const rows = await t.asUser(ids.cpcUser, `select id from student_certificates`);

    expect(rows.length).toBeGreaterThan(0);
  });
});
