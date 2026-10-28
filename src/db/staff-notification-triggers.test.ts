import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * A staff notification must never be able to refuse the student's own write.
 *
 * Found on production on 2026-10-28: no SRF had committed since 2026-10-10T09:25:37, while every
 * other write path kept working. 0095's `notify_cpc_of_srf_submission` inserts the coordinator's
 * `profiles.id` into `notifications.student_id`, which 0006 declared
 * `uuid not null references students(id)` - so the insert raises a foreign-key violation inside
 * `submit_srf`, whose whole form is one transaction, and the submission is rolled back after the
 * files have already been uploaded. 0093 (opt-outs) and 0094 (self-placements) did the same thing;
 * 0097 "fixed notification trigger bugs" without touching it.
 *
 * The proof that this is the trigger and not the payload is the campus with no coordinator
 * assigned: the `select p.id ... where p.role = 'campus_placement_coordinator'` finds nothing, no
 * row is inserted, and the submission lands. That asymmetry is why the fault read as though only
 * some students were affected.
 */

const STUDENT = {
  full_name: "Priya Ramesh",
  mobile: "9840000000",
  alternate_contact: "9840000001",
  tenth_institution: "St Xavier's, Chennai",
  tenth_percentage: 91.4,
  twelfth_institution: "St Xavier's, Chennai",
  twelfth_percentage: 88.2,
  passing_year: 2026,
  programme_level: "ug",
};

const DOCUMENTS = [
  { slot: "tenth", kind: "tenth_marksheet", storage_path: "p/tenth.pdf", size_bytes: 1000 },
  { slot: "twelfth", kind: "twelfth_marksheet", storage_path: "p/twelfth.pdf", size_bytes: 1000 },
  { slot: "semester-1", kind: "semester_marksheet", storage_path: "p/sem1.pdf", size_bytes: 1000 },
];

const SEMESTERS = [
  {
    semester_number: 1,
    cgpa: 8.5,
    declared_marks: 8.5,
    marks_scale: "cgpa",
    current_arrears: 0,
    history_of_arrears: 0,
    marksheet_slot: "semester-1",
  },
];

const submit = (t: TestDb, user: string) =>
  t.asUser(user, `select * from submit_srf($1::jsonb, $2::jsonb, $3::jsonb)`, [
    JSON.stringify(STUDENT),
    JSON.stringify(SEMESTERS),
    JSON.stringify(DOCUMENTS),
  ]);

const optOut = (t: TestDb, student: string, declarationId: string) =>
  t.sql(`insert into opt_out_requests (student_id, reason, declaration_id) values ($1,$2,$3)`, [
    student,
    "Higher studies",
    declarationId,
  ]);

const selfPlace = (t: TestDb, student: string, offerLetterId: string) =>
  t.sql(
    `insert into self_placement_requests (student_id, company_name, ctc_lpa, offer_letter_id)
     values ($1,$2,$3,$4)`,
    [student, "Zoho", 9.5, offerLetterId],
  );

/** The two states of the world: 0122, where the triggers are live, and 0123, where they are not. */
let broken: TestDb;
let fixed: TestDb;
let brokenIds: Awaited<ReturnType<typeof seed>>;
let fixedIds: Awaited<ReturnType<typeof seed>>;
let brokenEvidence: Evidence;
let fixedEvidence: Evidence;

interface Evidence {
  declaration: string;
  offerLetter: string;
}

/**
 * Both students start from `registered`, as a real first-time submitter does, and the signed
 * declaration + offer letter are put on file because 0022 made both requests refuse without one -
 * a check-constraint abort would otherwise stop the write before the trigger ever fired.
 */
const prepare = async (t: TestDb) => {
  const seeded = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [
    seeded.priyaUser,
  ]);
  await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [
    seeded.arjunUser,
  ]);
  await t.sql(`update students set srf_status = 'registered' where id in ($1,$2)`, [
    seeded.priya,
    seeded.arjun,
  ]);
  const rows = await t.sql(
    `insert into student_documents (student_id, kind, storage_path, size_bytes) values
       ($1,'opt_out_declaration','p/declaration.pdf',1000),
       ($2,'offer_letter','p/offer.pdf',1000)
     returning kind, id`,
    [seeded.priya, seeded.priya],
  );
  const idOf = (kind: string) => String(rows.find((r) => r.kind === kind)?.id);
  return {
    seeded,
    evidence: { declaration: idOf("opt_out_declaration"), offerLetter: idOf("offer_letter") },
  };
};

beforeAll(async () => {
  broken = await createTestDb({ through: "0122" });
  ({ seeded: brokenIds, evidence: brokenEvidence } = await prepare(broken));

  fixed = await createTestDb();
  ({ seeded: fixedIds, evidence: fixedEvidence } = await prepare(fixed));
}, 600_000);

describe("before 0123, the staff notice refuses the student's write", () => {
  it("blocks an SRF submission at a campus that has a coordinator", async () => {
    await broken.expectRejection(
      () => submit(broken, brokenIds.priyaUser),
      /notifications_student_id_fkey/,
    );

    const rows = await broken.sql(`select srf_status from students where id = $1`, [
      brokenIds.priya,
    ]);
    expect(rows[0]?.srf_status).toBe("registered");
  });

  it("blocks an opt-out request the same way", async () => {
    await broken.expectRejection(
      () => optOut(broken, brokenIds.priya, brokenEvidence.declaration),
      /notifications_student_id_fkey/,
    );
  });

  it("blocks a self-placement the same way", async () => {
    await broken.expectRejection(
      () => selfPlace(broken, brokenIds.priya, brokenEvidence.offerLetter),
      /notifications_student_id_fkey/,
    );
  });

  /**
   * Campus B has no coordinator assigned, so the trigger's SELECT finds nothing and inserts
   * nothing. This is what makes the fault look like it hits only some students - and on
   * production it hit every campus but one, because every campus but one has a coordinator.
   */
  it("lets the same submission through where no coordinator is assigned", async () => {
    const rows = await submit(broken, brokenIds.arjunUser);
    expect(rows[0]?.srf_status).toBe("srf_submitted");
  });
});

describe("after 0123, the student's write stands on its own", () => {
  it("leaves no staff-notice trigger on the three tables", async () => {
    const rows = await fixed.sql(
      `select tgname from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where not tgisinternal
          and c.relname in ('students','opt_out_requests','self_placement_requests')
          and tgname like 'notify_cpc%'`,
    );
    expect(rows.map((r) => r.tgname)).toEqual([]);
  });

  it("submits the SRF, documents and all", async () => {
    const rows = await submit(fixed, fixedIds.priyaUser);
    expect(rows[0]?.srf_status).toBe("srf_submitted");

    const docs = await fixed.sql(
      `select count(*) as n from student_documents
        where student_id = $1 and storage_path in ('p/tenth.pdf','p/twelfth.pdf','p/sem1.pdf')`,
      [fixedIds.priya],
    );
    expect(Number(docs[0]?.n)).toBe(3);
  });

  it("takes an opt-out and a self-placement", async () => {
    await optOut(fixed, fixedIds.priya, fixedEvidence.declaration);
    await selfPlace(fixed, fixedIds.priya, fixedEvidence.offerLetter);

    const counts = await fixed.sql(
      `select
         (select count(*) from opt_out_requests where student_id = $1) as opt_outs,
         (select count(*) from self_placement_requests where student_id = $1) as self_placements`,
      [fixedIds.priya],
    );
    expect(Number(counts[0]?.opt_outs)).toBe(1);
    expect(Number(counts[0]?.self_placements)).toBe(1);
  });

  /** The notification is gone, and it was never readable: `notifications_read_self` keys on
   *  `student_id = current_student_id()`, which is NULL for a coordinator. All three writes above
   *  landed, so had the triggers survived they would each have raised this same FK violation. */
  it("writes no staff notification row, which is what was already true in production", async () => {
    const rows = await fixed.sql(
      `select count(*) as n from notifications
        where kind in ('srf_submitted','opt_out_submitted','self_placement_submitted')`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
