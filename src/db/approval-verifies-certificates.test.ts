import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0039 — approving a registration form also confirms the
 * certificates that came with it.
 *
 * Asked for 2026-08-06, after A37 was put to the client: "make approving the
 * registration form also confirm the certificates that came with it, and keep
 * the standing queue for later uploads."
 *
 * This SUPERSEDES half of A37. 0038 verified every certificate one at a time;
 * a coordinator processing a new student therefore did two jobs. Now the
 * initial batch rides along with the form's approval, exactly as the semester
 * lines do (0031), and anything uploaded afterwards still goes to
 * `/cpc/certificates`.
 *
 * The safety condition is the same one 0031 depends on and states outright:
 * approval verifies these rows ONLY because the queue puts each certificate
 * and its document in front of the coordinator first. That screen change ships
 * with this migration, not after it.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const certificate = async (studentId: string, name: string) => {
  const documentId = (
    await t.sql(
      `insert into student_documents (student_id, kind, storage_path, size_bytes)
       values ($1, 'certificate', $2, 1000) returning id`,
      [studentId, `${studentId}/${name}.pdf`],
    )
  )[0]?.id as string;

  return (
    await t.sql(
      `insert into student_certificates (student_id, name, document_id) values ($1,$2,$3)
       returning id`,
      [studentId, name, documentId],
    )
  )[0]?.id as string;
};

const approve = (studentId: string) =>
  t.sql(
    `update students
        set srf_status = 'srf_approved', srf_decided_by = $2, srf_decided_at = now()
      where id = $1`,
    [studentId, ids.cpcUser],
  );

const stateOf = async (id: string) =>
  (
    await t.sql(
      `select status, verified_by, verified_at is not null as stamped, rejection_reason
         from student_certificates where id = $1`,
      [id],
    )
  )[0];

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`update students set srf_status = 'srf_submitted' where id in ($1,$2)`, [
    ids.priya,
    ids.arjun,
  ]);
}, 60_000);

describe("0039 — approving the form confirms the certificates on it", () => {
  it("verifies the pending certificates, naming the coordinator who approved", async () => {
    const id = await certificate(ids.priya, "AWS Cloud Practitioner");

    await approve(ids.priya);

    const state = await stateOf(id);
    expect(state?.status).toBe("verified");
    expect(state?.verified_by).toBe(ids.cpcUser);
    expect(state?.stamped).toBe(true);
  });

  it("verifies every certificate that came with the form, not just the first", async () => {
    const aws = await certificate(ids.priya, "AWS Cloud Practitioner");
    const azure = await certificate(ids.priya, "Azure Fundamentals");

    await approve(ids.priya);

    expect((await stateOf(aws))?.status).toBe("verified");
    expect((await stateOf(azure))?.status).toBe("verified");
  });

  /**
   * A coordinator who already looked at a certificate and refused it has made
   * a decision. Approving the form must not quietly reverse it.
   */
  it("leaves a certificate that was already rejected alone", async () => {
    const id = await certificate(ids.priya, "AWS Cloud Practitioner");
    await t.sql(
      `update student_certificates
          set status='rejected', verified_by=$2, verified_at=now(), rejection_reason='Illegible'
        where id = $1`,
      [id, ids.cpcUser],
    );

    await approve(ids.priya);

    const state = await stateOf(id);
    expect(state?.status).toBe("rejected");
    expect(state?.rejection_reason).toBe("Illegible");
  });

  it("touches nobody else's certificates", async () => {
    const mine = await certificate(ids.priya, "AWS Cloud Practitioner");
    const theirs = await certificate(ids.arjun, "AWS Cloud Practitioner");

    await approve(ids.priya);

    expect((await stateOf(mine))?.status).toBe("verified");
    expect((await stateOf(theirs))?.status).toBe("pending");
  });

  /** The other half of the request: later uploads still go to the queue. */
  it("leaves a certificate uploaded AFTER approval pending", async () => {
    await approve(ids.priya);

    const later = await certificate(ids.priya, "Azure Fundamentals");

    expect((await stateOf(later))?.status).toBe("pending");
  });

  it("does not fire on any other change to the student row", async () => {
    const id = await certificate(ids.priya, "AWS Cloud Practitioner");

    await t.sql(`update students set mobile = '9840000009' where id = $1`, [ids.priya]);

    expect((await stateOf(id))?.status).toBe("pending");
  });

  /** A form sent back and approved later sweeps up what arrived meanwhile. */
  it("confirms certificates added between a rejection and a later approval", async () => {
    await t.sql(
      `update students set srf_status='srf_rejected', srf_rejection_reason='Fix your marks'
        where id = $1`,
      [ids.priya],
    );
    const added = await certificate(ids.priya, "Azure Fundamentals");
    await t.sql(`update students set srf_status='srf_submitted' where id = $1`, [ids.priya]);

    await approve(ids.priya);

    expect((await stateOf(added))?.status).toBe("verified");
  });

  it("records the confirmation in the audit log", async () => {
    await certificate(ids.priya, "AWS Cloud Practitioner");

    await approve(ids.priya);

    const [row] = await t.sql(
      `select count(*)::int as n from audit_log
        where entity_table = 'student_certificates' and action = 'update'`,
    );
    expect(Number(row?.n)).toBeGreaterThan(0);
  });
});
