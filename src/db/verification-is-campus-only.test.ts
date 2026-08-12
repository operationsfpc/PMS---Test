import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * D3 (2026-08-12): "Certificate verification, student verification will only
 * be done by the campus placement coordinator. It will not be done by the
 * Central PC."
 *
 * The Central CPC ran both queues while the campus seat was empty; the seat
 * is filled now and the client keeps it that way. Enforced in the DATABASE
 * (0042), not just hidden in the nav — an authority that only the UI removes
 * is still an authority.
 *
 * Accepted consequence, recorded in the spec: if the campus CPC seat is ever
 * empty, verification halts until an Admin fills it.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

let certificate: string;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await t.sql(
    `update students set srf_status = 'srf_submitted', consent_given_at = now()
      where id = $1`,
    [ids.priya],
  );

  const doc = await t.sql(
    `insert into student_documents (student_id, kind, storage_path, size_bytes)
     values ($1::uuid, 'certificate', $1::text || '/aws.pdf', 1024) returning id`,
    [ids.priya],
  );
  certificate = (
    await t.sql(
      `insert into student_certificates (student_id, name, document_id)
       values ($1, 'AWS Cloud Practitioner', $2) returning id`,
      [ids.priya, doc[0]?.id],
    )
  )[0]?.id as string;
});

describe("registration-form decisions (0042)", () => {
  it("refuses the CENTRAL coordinator", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.centralUser,
          `update students set srf_status = 'srf_approved', srf_decided_by = $2, srf_decided_at = now()
            where id = $1`,
          [ids.priya, ids.centralUser],
        ),
      /campus placement coordinator/i,
    );
    const row = await t.sql(`select srf_status from students where id = $1`, [ids.priya]);
    expect(row[0]?.srf_status).toBe("srf_submitted");
  });

  it("refuses an admin — verification is a coordinator's job, not a switch", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.adminUser,
          `update students set srf_status = 'srf_rejected', srf_decided_by = $2, srf_decided_at = now(),
                  srf_rejection_reason = 'test' where id = $1`,
          [ids.priya, ids.adminUser],
        ),
      /campus placement coordinator/i,
    );
  });

  it("lets the CAMPUS coordinator decide their own student's form", async () => {
    await t.asUser(
      ids.cpcUser,
      `update students set srf_status = 'srf_approved', srf_decided_by = $2, srf_decided_at = now()
        where id = $1`,
      [ids.priya, ids.cpcUser],
    );
    const row = await t.sql(`select srf_status from students where id = $1`, [ids.priya]);
    expect(row[0]?.srf_status).toBe("srf_approved");
  });
});

describe("certificate decisions (0042)", () => {
  beforeAll(async () => {
    // The first certificate was verified by 0039's trigger the moment the
    // campus CPC approved the form above — which is that trigger doing its
    // job. A LATER upload lands pending (the standing queue), and that is
    // what these tests decide.
    const doc = await t.sql(
      `insert into student_documents (student_id, kind, storage_path, size_bytes)
       values ($1::uuid, 'certificate', $1::text || '/azure.pdf', 1024) returning id`,
      [ids.priya],
    );
    certificate = (
      await t.sql(
        `insert into student_certificates (student_id, name, document_id)
         values ($1, 'Azure Fundamentals', $2) returning id`,
        [ids.priya, doc[0]?.id],
      )
    )[0]?.id as string;
  });

  it("refuses the CENTRAL coordinator — RLS filters the row away silently", async () => {
    await t.asUser(
      ids.centralUser,
      `update student_certificates set status = 'verified', verified_by = $2, verified_at = now()
        where id = $1`,
      [certificate, ids.centralUser],
    );
    const row = await t.sql(`select status from student_certificates where id = $1`, [certificate]);
    expect(row[0]?.status).toBe("pending");
  });

  it("lets the CAMPUS coordinator verify their own student's certificate", async () => {
    await t.asUser(
      ids.cpcUser,
      `update student_certificates set status = 'verified', verified_by = $2, verified_at = now()
        where id = $1`,
      [certificate, ids.cpcUser],
    );
    const row = await t.sql(`select status, verified_by from student_certificates where id = $1`, [
      certificate,
    ]);
    expect(row[0]?.status).toBe("verified");
    expect(row[0]?.verified_by).toBe(ids.cpcUser);
  });
});
