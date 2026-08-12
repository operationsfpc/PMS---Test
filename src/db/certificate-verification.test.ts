import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0038 — a certificate is verified by the coordinator.
 *
 * Asked for 2026-08-06: "skill certifications uploaded by students will also
 * need verification of campus placement coordinator similar to CGPA approval.
 * This is applicable for first upload as well as subsequent additions."
 *
 * 0034 stored a name and a document and stopped there. Nothing recorded
 * whether anyone had ever opened the file, so a recruiter reading a profile
 * could not tell a checked certificate from a claim typed five minutes ago.
 *
 * The half that is easy to get wrong is the interaction with `submit_srf`,
 * which replaces the certificate list wholesale. A verified certificate must
 * survive that AND must not collide with the payload that re-declares it -
 * the collision is exactly what made the SRF unsubmittable before (0027).
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const STUDENT = {
  full_name: "Priya Ramesh",
  mobile: "9840000000",
  whatsapp: null,
  alternate_contact: "9840000001",
  tenth_institution: "St Xavier's",
  tenth_percentage: 91.4,
  twelfth_institution: "St Xavier's",
  twelfth_percentage: 88.2,
  diploma_institution: null,
  diploma_marks: null,
  diploma_marks_scale: null,
  diploma_marksheet_slot: null,
  passing_year: 2026,
  programme_level: "ug",
  ug_degree: null,
  ug_college: null,
  ug_branch: null,
  ug_aggregate_declared: null,
  ug_aggregate_scale: null,
  ug_aggregate_cgpa: null,
  ug_marksheet_slot: null,
  technical_skills: "TypeScript",
  areas_of_interest: "Frontend",
  areas_of_expertise: "Web",
  projects: "MERN",
  achievements: "Shipped a thing",
  linkedin_url: null,
  github_url: null,
  leetcode_url: null,
  hackerrank_url: null,
  other_profiles: [],
};

const SEMESTER = {
  semester_number: 1,
  cgpa: 8.5,
  declared_marks: 8.5,
  marks_scale: "cgpa",
  current_arrears: 0,
  history_of_arrears: 0,
  marksheet_slot: "semester-1",
};

let attempt = 0;

/** Exactly the call the SRF repository makes. */
const submit = (user: string, certificates: Record<string, unknown>[] = []) => {
  attempt += 1;
  const documents = [
    {
      slot: "tenth",
      kind: "tenth_marksheet",
      storage_path: `p/tenth-${attempt}.pdf`,
      size_bytes: 1,
    },
    {
      slot: "twelfth",
      kind: "twelfth_marksheet",
      storage_path: `p/twelfth-${attempt}.pdf`,
      size_bytes: 1,
    },
    {
      slot: "semester-1",
      kind: "semester_marksheet",
      storage_path: `p/sem1-${attempt}.pdf`,
      size_bytes: 1,
    },
    ...certificates.map((_c, i) => ({
      slot: `certificate-${i}`,
      kind: "certificate",
      storage_path: `p/cert-${attempt}-${i}.pdf`,
      size_bytes: 1,
    })),
  ];

  return t.asUser(user, `select * from submit_srf($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)`, [
    JSON.stringify(STUDENT),
    JSON.stringify([SEMESTER]),
    JSON.stringify(documents),
    JSON.stringify(certificates.map((c, i) => ({ ...c, document_slot: `certificate-${i}` }))),
  ]);
};

/** A certificate written directly, for the cases that are not about the SRF. */
const certificate = async (name: string, student = ids.priya) => {
  const documentId = (
    await t.sql(
      `insert into student_documents (student_id, kind, storage_path, size_bytes)
       values ($1, 'certificate', $2, 1000) returning id`,
      [student, `${student}/${name}-${Math.random()}.pdf`],
    )
  )[0]?.id as string;

  return (
    await t.sql(
      `insert into student_certificates (student_id, name, document_id) values ($1,$2,$3)
       returning id`,
      [student, name, documentId],
    )
  )[0]?.id as string;
};

const statusOf = async (id: string) =>
  (
    await t.sql(
      `select status, verified_by, rejection_reason from student_certificates where id = $1`,
      [id],
    )
  )[0];

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [ids.arjunUser]);
  await t.sql(`update students set srf_status = 'registered' where id in ($1,$2)`, [
    ids.priya,
    ids.arjun,
  ]);
}, 60_000);

describe("0038 — a certificate arrives unverified", () => {
  it("lands pending, however it was uploaded", async () => {
    const id = await certificate("AWS Cloud Practitioner");
    expect((await statusOf(id))?.status).toBe("pending");
  });

  it("lands pending when it arrives with the registration form too", async () => {
    await submit(ids.priyaUser, [{ name: "Azure Fundamentals" }]);

    const rows = await t.sql(`select status from student_certificates where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows.map((r) => r.status)).toEqual(["pending"]);
  });
});

describe("0038 — the coordinator decides", () => {
  it("lets the campus coordinator verify their own campus's student", async () => {
    const id = await certificate("AWS Cloud Practitioner");

    await t.asUser(
      ids.cpcUser,
      `update student_certificates set status = 'verified', verified_by = $2, verified_at = now()
       where id = $1`,
      [id, ids.cpcUser],
    );

    const row = await statusOf(id);
    expect(row?.status).toBe("verified");
    expect(row?.verified_by).toBe(ids.cpcUser);
  });

  it("lets the coordinator reject one with a reason", async () => {
    const id = await certificate("AWS Cloud Practitioner");

    await t.asUser(
      ids.cpcUser,
      `update student_certificates
          set status = 'rejected', verified_by = $2, verified_at = now(), rejection_reason = $3
        where id = $1`,
      [id, ids.cpcUser, "The document is a screenshot, not the certificate"],
    );

    expect((await statusOf(id))?.rejection_reason).toBe(
      "The document is a screenshot, not the certificate",
    );
  });

  /** Mirrors student_semesters' own constraint: a claim must name its maker. */
  it("refuses a verified certificate that names no verifier", async () => {
    const id = await certificate("AWS Cloud Practitioner");

    await t.expectRejection(
      () => t.sql(`update student_certificates set status = 'verified' where id = $1`, [id]),
      /certificate_verified_has_verifier/i,
    );
  });

  /** F1's rule: a rejection the student cannot act on is not a decision. */
  it("refuses a rejection with no reason", async () => {
    const id = await certificate("AWS Cloud Practitioner");

    await t.expectRejection(
      () =>
        t.sql(
          `update student_certificates set status = 'rejected', verified_by = $2 where id = $1`,
          [id, ids.cpcUser],
        ),
      /certificate_rejected_has_reason/i,
    );
  });

  it("refuses a coordinator from another campus", async () => {
    const id = await certificate("AWS Cloud Practitioner", ids.arjun);

    // Arjun is on campus B; the CPC is mapped to campus A. RLS filters the
    // row out entirely, so the update matches nothing rather than erroring.
    await t.asUser(
      ids.cpcUser,
      `update student_certificates set status = 'verified', verified_by = $2 where id = $1`,
      [id, ids.cpcUser],
    );

    expect((await statusOf(id))?.status).toBe("pending");
  });

  it("refuses the student their own verification", async () => {
    const id = await certificate("AWS Cloud Practitioner");

    await t.asUser(
      ids.priyaUser,
      `update student_certificates set status = 'verified', verified_by = $2 where id = $1`,
      [id, ids.cpcUser],
    );

    expect((await statusOf(id))?.status).toBe("pending");
  });

  it("audits the decision — a verification is a claim someone made", async () => {
    const id = await certificate("AWS Cloud Practitioner");
    await t.asUser(
      ids.cpcUser,
      `update student_certificates set status = 'verified', verified_by = $2, verified_at = now()
       where id = $1`,
      [id, ids.cpcUser],
    );

    const [row] = await t.sql(
      `select count(*)::int as n from audit_log
        where entity_table = 'student_certificates' and action = 'update'`,
    );
    expect(Number(row?.n)).toBeGreaterThan(0);
  });
});

describe("0038 — what the student may still remove", () => {
  it("lets them remove one that is still pending", async () => {
    const id = await certificate("AWS Cloud Practitioner");

    await t.asUser(ids.priyaUser, `delete from student_certificates where id = $1`, [id]);

    expect(await statusOf(id)).toBeUndefined();
  });

  it("lets them remove one that was rejected, which is how they replace it", async () => {
    const id = await certificate("AWS Cloud Practitioner");
    await t.sql(
      `update student_certificates
          set status='rejected', verified_by=$2, verified_at=now(), rejection_reason='Illegible'
        where id = $1`,
      [id, ids.cpcUser],
    );

    await t.asUser(ids.priyaUser, `delete from student_certificates where id = $1`, [id]);

    expect(await statusOf(id)).toBeUndefined();
  });

  /** Q4 applied to certificates: verified data is not the student's to change. */
  it("refuses to let them remove a verified one", async () => {
    const id = await certificate("AWS Cloud Practitioner");
    await t.sql(
      `update student_certificates set status='verified', verified_by=$2, verified_at=now()
        where id = $1`,
      [id, ids.cpcUser],
    );

    await t.asUser(ids.priyaUser, `delete from student_certificates where id = $1`, [id]);

    expect((await statusOf(id))?.status).toBe("verified");
  });
});

/**
 * The dangerous half.
 *
 * `submit_srf` replaces the certificate list wholesale. Once a certificate can
 * be verified, that delete must skip verified rows - and the insert must then
 * skip re-declaring them, or `one_certificate_per_name` raises 23505 and the
 * WHOLE submission fails. That is precisely the failure that made the SRF
 * unsubmittable for every student before 0027: an RLS-filtered delete matching
 * nothing, followed by a unique violation nobody could see the cause of.
 */
describe("0038 — re-submitting the form around a verified certificate", () => {
  it("keeps the verified certificate and still accepts the submission", async () => {
    await submit(ids.priyaUser, [{ name: "AWS Cloud Practitioner" }]);
    await t.sql(
      `update student_certificates set status='verified', verified_by=$1, verified_at=now()
        where student_id = $2`,
      [ids.cpcUser, ids.priya],
    );

    // The form shows what is on file, so it re-declares the same certificate.
    await submit(ids.priyaUser, [
      { name: "AWS Cloud Practitioner" },
      { name: "Azure Fundamentals" },
    ]);

    const rows = await t.sql(
      `select name, status from student_certificates where student_id = $1 order by name`,
      [ids.priya],
    );
    expect(rows.map((r) => `${r.name}:${r.status}`)).toEqual([
      "AWS Cloud Practitioner:verified",
      "Azure Fundamentals:pending",
    ]);
  });

  it("does not collide when the payload re-declares it under different spacing", async () => {
    await submit(ids.priyaUser, [{ name: "AWS Cloud Practitioner" }]);
    await t.sql(
      `update student_certificates set status='verified', verified_by=$1, verified_at=now()
        where student_id = $2`,
      [ids.cpcUser, ids.priya],
    );

    await submit(ids.priyaUser, [{ name: "  aws   cloud practitioner " }]);

    const rows = await t.sql(`select status from student_certificates where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows.map((r) => r.status)).toEqual(["verified"]);
  });

  it("still replaces a pending certificate the student dropped from the form", async () => {
    await submit(ids.priyaUser, [{ name: "AWS Cloud Practitioner" }]);
    await submit(ids.priyaUser, [{ name: "Azure Fundamentals" }]);

    const rows = await t.sql(`select name from student_certificates where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Azure Fundamentals"]);
  });
});
