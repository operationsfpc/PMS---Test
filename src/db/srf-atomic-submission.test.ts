import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Submitting the SRF is ONE transaction.
 *
 * Called out while fixing the re-submission bug, 2026-08-05. The repository
 * wrote the form in four separate round trips - documents, then the student
 * row, then a delete, then the semester lines - and PostgREST gives each its
 * own transaction. So a failure at step three left the first two standing.
 *
 * That is exactly the state the live database was found in: a student row
 * saying `srf_submitted` while the student was being told, correctly, that
 * submission had failed. The verification queue showed a form whose semester
 * lines were never written, and the student could not fix it because
 * re-submitting was itself broken.
 *
 * A half-submitted registration is worse than a rejected one: a coordinator
 * cannot see that anything is missing, so they verify what is there and sign
 * off marks against evidence that was never stored.
 *
 * `submit_srf` closes that. One statement, one transaction, all of it or none.
 * It is SECURITY INVOKER on purpose - RLS, `protect_verified_academics` and
 * every marksheet-ownership trigger still judge the caller, exactly as they
 * did when the writes were separate. Atomicity is the only thing that changes.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const STUDENT = {
  full_name: "Priya Ramesh",
  mobile: "9840000000",
  whatsapp: null,
  alternate_contact: "9840000001",
  tenth_institution: "St Xavier's, Chennai",
  tenth_percentage: 91.4,
  twelfth_institution: "St Xavier's, Chennai",
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
  certifications: null,
  achievements: "Built a web application from scratch",
  linkedin_url: null,
  github_url: null,
  leetcode_url: null,
  hackerrank_url: null,
  other_profiles: [],
};

const DOCUMENTS = [
  { slot: "tenth", kind: "tenth_marksheet", storage_path: "p/tenth.pdf", size_bytes: 1000 },
  { slot: "twelfth", kind: "twelfth_marksheet", storage_path: "p/twelfth.pdf", size_bytes: 1000 },
  {
    slot: "semester-1",
    kind: "semester_marksheet",
    storage_path: "p/sem1.pdf",
    size_bytes: 1000,
  },
];

const SEMESTER = {
  semester_number: 1,
  cgpa: 8.5,
  declared_marks: 8.5,
  marks_scale: "cgpa",
  current_arrears: 0,
  history_of_arrears: 0,
  marksheet_slot: "semester-1",
};

/**
 * Exactly the call src/features/srf/srf-repository.ts makes.
 *
 * Storage paths are stamped per attempt, as the repository stamps them with
 * `Date.now()`: `storage_path` is unique, and a student re-uploading a bad
 * scan is the normal case. The SLOT keys stay put - they are what the
 * semester lines point at.
 */
let attempt = 0;

const submit = (
  user: string,
  overrides: {
    student?: Record<string, unknown>;
    semesters?: Record<string, unknown>[];
    documents?: Record<string, unknown>[];
    certificates?: Record<string, unknown>[];
  } = {},
) => {
  attempt += 1;
  const documents = (overrides.documents ?? DOCUMENTS).map((d) => ({
    ...d,
    storage_path: `${d.storage_path}-${attempt}`,
  }));

  return t.asUser(user, `select * from submit_srf($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)`, [
    JSON.stringify({ ...STUDENT, ...overrides.student }),
    JSON.stringify(overrides.semesters ?? [SEMESTER]),
    JSON.stringify(documents),
    JSON.stringify(overrides.certificates ?? []),
  ]);
};

const countOf = async (table: string, studentId: string) => {
  const rows = await t.sql(`select count(*) as n from ${table} where student_id = $1`, [studentId]);
  return Number(rows[0]?.n);
};

const statusOf = async (studentId: string) => {
  const rows = await t.sql(`select srf_status from students where id = $1`, [studentId]);
  return rows[0]?.srf_status;
};

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [ids.arjunUser]);
  // The seed approves both; a real submitter has not been looked at yet.
  await t.sql(`update students set srf_status = 'registered' where id in ($1,$2)`, [
    ids.priya,
    ids.arjun,
  ]);
}, 60_000);

describe("submit_srf writes the whole form", () => {
  it("moves the form into the verification queue", async () => {
    const rows = await submit(ids.priyaUser);

    expect(rows[0]?.srf_status).toBe("srf_submitted");
  });

  it("records the declared marks, the semester lines and their evidence", async () => {
    await submit(ids.priyaUser);

    const rows = await t.sql(
      `select s.declared_marks, d.storage_path from student_semesters s
         join student_documents d on d.id = s.marksheet_id
        where s.student_id = $1`,
      [ids.priya],
    );

    expect(Number(rows[0]?.declared_marks)).toBe(8.5);
    expect(rows[0]?.storage_path).toMatch(/^p\/sem1\.pdf/);
  });

  it("clears the draft, which has served its purpose", async () => {
    await t.sql(`update students set srf_draft = '{"mobile":"1"}'::jsonb where id = $1`, [
      ids.priya,
    ]);

    await submit(ids.priyaUser);

    const rows = await t.sql(`select srf_draft from students where id = $1`, [ids.priya]);
    expect(rows[0]?.srf_draft).toBeNull();
  });

  it("replaces the lines from an earlier submission rather than colliding", async () => {
    await submit(ids.priyaUser);

    await submit(ids.priyaUser, {
      semesters: [{ ...SEMESTER, cgpa: 9.1, declared_marks: 9.1 }],
    });

    const rows = await t.sql(`select declared_marks from student_semesters where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.declared_marks)).toBe(9.1);
  });
});

/**
 * The point of the exercise. Each of these fails at a DIFFERENT step, and in
 * every case the database must look exactly as it did before the call.
 */
describe("submit_srf is all or nothing", () => {
  it("writes no documents when a semester line is refused", async () => {
    // Eleven semesters for an undergraduate: refused by the 0017 cap trigger,
    // which fires on the LAST write the function makes.
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      ...SEMESTER,
      semester_number: i + 1,
      marksheet_slot: "semester-1",
    }));

    await t.expectRejection(
      () => submit(ids.priyaUser, { semesters: eleven }),
      /at most 10 semesters/i,
    );

    expect(await countOf("student_documents", ids.priya)).toBe(0);
  });

  it("leaves the form out of the verification queue when a semester line is refused", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      ...SEMESTER,
      semester_number: i + 1,
      marksheet_slot: "semester-1",
    }));

    await t.expectRejection(
      () => submit(ids.priyaUser, { semesters: eleven }),
      /at most 10 semesters/i,
    );

    expect(await statusOf(ids.priya)).toBe("registered");
  });

  /**
   * The live failure that started this. A duplicate semester line used to be
   * reached with the student row already written and already saying submitted.
   */
  it("does not keep the earlier semester lines when the new ones are refused", async () => {
    await submit(ids.priyaUser);

    await t.expectRejection(
      () =>
        submit(ids.priyaUser, {
          semesters: [{ ...SEMESTER, cgpa: 99 }],
        }),
      /cgpa|check constraint/i,
    );

    const rows = await t.sql(`select declared_marks from student_semesters where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.declared_marks)).toBe(8.5);
  });

  it("writes nothing at all when the student may no longer submit", async () => {
    await t.sql(`update students set srf_status = 'srf_approved' where id = $1`, [ids.priya]);

    await t.expectRejection(() => submit(ids.priyaUser), /placement coordinator/i);

    expect(await countOf("student_documents", ids.priya)).toBe(0);
    expect(await countOf("student_semesters", ids.priya)).toBe(0);
  });
});

/**
 * The function is a transaction boundary, not a way around the rules. Every
 * guard that applied to the four separate statements still applies.
 */
describe("submit_srf grants no new power", () => {
  it("submits the CALLER's form, whatever the payload claims", async () => {
    await submit(ids.arjunUser, { student: { full_name: "Arjun Menon", id: ids.priya } });

    expect(await statusOf(ids.arjun)).toBe("srf_submitted");
    expect(await statusOf(ids.priya)).toBe("registered");
  });

  it("refuses a student who has no student record at all", async () => {
    await t.expectRejection(() => submit(ids.cpcUser), /student record/i);
  });

  it("cannot be used to approve a form", async () => {
    await submit(ids.priyaUser, { student: { srf_status: "srf_approved" } });

    expect(await statusOf(ids.priya)).toBe("srf_submitted");
  });

  it("cannot be used to write a field the student never owns", async () => {
    await submit(ids.priyaUser, {
      student: { roll_number: "HACKED", overall_cgpa: 9.9, campus_id: ids.campusB },
    });

    const rows = await t.sql(
      `select roll_number, campus_id, overall_cgpa from students where id = $1`,
      [ids.priya],
    );
    expect(rows[0]?.roll_number).toBe("21CSE1042");
    expect(rows[0]?.campus_id).toBe(ids.campusA);
  });

  it("cannot file a document against another student", async () => {
    await submit(ids.arjunUser, {
      documents: DOCUMENTS.map((d) => ({ ...d, student_id: ids.priya })),
    });

    expect(await countOf("student_documents", ids.priya)).toBe(0);
    expect(await countOf("student_documents", ids.arjun)).toBe(3);
  });
});

/**
 * F17 (UAT 2026-08-06): certificates travel with the form, in the same
 * transaction as everything else it declares.
 *
 * They cannot be a second round trip. The whole reason `submit_srf` exists is
 * that a partial submission is worse than a failed one: a coordinator opening
 * the queue cannot see what is missing, so they verify what is in front of
 * them.
 */
describe("submit_srf — certificates", () => {
  it("stores each certificate against the document that evidences it", async () => {
    await submit(ids.priyaUser, {
      documents: [
        ...DOCUMENTS,
        { slot: "cert-0", kind: "certificate", storage_path: "p/aws.pdf", size_bytes: 100 },
      ],
      certificates: [{ name: "AWS Cloud Practitioner", document_slot: "cert-0" }],
    });

    const rows = await t.sql(
      `select c.name, d.storage_path
         from student_certificates c
         join student_documents d on d.id = c.document_id
        where c.student_id = $1`,
      [ids.priya],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("AWS Cloud Practitioner");
    // The helper stamps each attempt's paths, as the repository does.
    expect(rows[0]?.storage_path).toMatch(/^p\/aws\.pdf/);
  });

  /**
   * Re-submitting shows the student's whole record, so what is on screen must
   * be what ends up stored — the same rule the semester lines follow.
   */
  it("replaces the certificate list wholesale on a re-submission", async () => {
    await submit(ids.priyaUser, {
      documents: [
        ...DOCUMENTS,
        { slot: "cert-0", kind: "certificate", storage_path: "p/azure.pdf", size_bytes: 100 },
      ],
      certificates: [{ name: "Azure Fundamentals", document_slot: "cert-0" }],
    });

    const rows = await t.sql(`select name from student_certificates where student_id = $1`, [
      ids.priya,
    ]);

    expect(rows.map((r) => r.name)).toEqual(["Azure Fundamentals"]);
  });

  it("accepts a form with no certificates at all", async () => {
    await submit(ids.priyaUser, {
      documents: DOCUMENTS,
      certificates: [],
    });

    const [row] = await t.sql(
      `select count(*) as n from student_certificates where student_id = $1`,
      [ids.priya],
    );
    expect(Number(row?.n)).toBe(0);
  });

  /** F9, enforced where no screen can forget it. */
  it("refuses a submission naming the same certificate twice", async () => {
    await t.expectRejection(
      () =>
        submit(ids.priyaUser, {
          documents: [
            ...DOCUMENTS,
            { slot: "cert-0", kind: "certificate", storage_path: "p/a.pdf", size_bytes: 100 },
            { slot: "cert-1", kind: "certificate", storage_path: "p/b.pdf", size_bytes: 100 },
          ],
          certificates: [
            { name: "AWS Cloud Practitioner", document_slot: "cert-0" },
            { name: "aws cloud practitioner", document_slot: "cert-1" },
          ],
        }),
      /one_certificate_per_name|duplicate key/i,
    );
  });
});
