import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Campus scoping, proven as a real user.
 *
 * Confirmed 2026-08-05: **a Key Account Manager looks after a few campuses,
 * and campuses are mapped to them.** So a KAM is campus-scoped, exactly like a
 * CPC - not an organisation-wide reader.
 *
 * That mapping already existed in two places and was consulted by neither:
 * `requiresCampusAssignment()` hands a KAM campuses at invitation time, and
 * `staff_campus_assignments` stores them. No policy ever read them, so a KAM
 * could see nothing at all.
 *
 * The second half of this file is the reason the first half is not enough:
 * `students` was campus-filtered, but `applications`, `offers`, documents and
 * semesters were not. Every application carries a frozen copy of the student's
 * whole profile in `profile_snapshot`, so campus-scoping the student row while
 * leaving the application open is not scoping at all.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const KAM_USER = "31000000-0000-0000-0000-000000000001";
const ER_USER = "31000000-0000-0000-0000-000000000002";
const AE_USER = "31000000-0000-0000-0000-000000000003";
const OTHER_AE_USER = "31000000-0000-0000-0000-000000000004";

/** Their drive, and one application to it from each campus. */
let aeDrive: string;
let otherDrive: string;

async function signIn(userId: string, email: string, name: string, role: string) {
  await t.sql(
    `insert into staff_invitations (email, full_name, role) values ($1,$2,$3::app_role)
     on conflict (email) do nothing`,
    [email, name, role],
  );
  await t.sql(`insert into auth.users (id, email) values ($1,$2)`, [userId, email]);
}

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await signIn(KAM_USER, "kam@faceprep.in", "KAM One", "key_account_manager");
  await signIn(ER_USER, "er@faceprep.in", "ER One", "enterprise_relations");
  await signIn(AE_USER, "ae@faceprep.in", "AE One", "account_executive");
  await signIn(OTHER_AE_USER, "ae2@faceprep.in", "AE Two", "account_executive");

  // Alliance University only. VIT Bangalore belongs to someone else.
  await t.sql(`insert into staff_campus_assignments (profile_id, campus_id) values ($1,$2)`, [
    KAM_USER,
    ids.campusA,
  ]);

  aeDrive = (
    await t.sql(`insert into drives (company_name, created_by) values ('Zoho',$1) returning id`, [
      AE_USER,
    ])
  )[0]?.id as string;
  otherDrive = (
    await t.sql(
      `insert into drives (company_name, created_by) values ('Freshworks',$1) returning id`,
      [OTHER_AE_USER],
    )
  )[0]?.id as string;

  for (const [drive, student] of [
    [aeDrive, ids.priya],
    [aeDrive, ids.arjun],
    [otherDrive, ids.priya],
  ] as const) {
    await t.sql(
      `insert into applications (drive_id, student_id, profile_snapshot)
       values ($1,$2,'{"profile":{"fullName":"secret"}}'::jsonb)`,
      [drive, student],
    );
  }

  for (const student of [ids.priya, ids.arjun]) {
    await t.sql(
      `insert into offers (student_id, drive_id, company_name, drive_type, offer_category, ctc_lpa)
       values ($1,$2,'Zoho','placement','dream',9)`,
      [student, aeDrive],
    );
    await t.sql(
      `insert into student_documents (student_id, kind, role_category, storage_path, size_bytes)
       values ($1,'resume','software_technical',$2,1000)`,
      [student, `${student}/cv.pdf`],
    );
    await t.sql(
      `insert into student_semesters (student_id, semester_number, cgpa)
       values ($1, 4, 8.1)`,
      [student],
    );
  }
}, 60_000);

describe("a Key Account Manager is scoped to the campuses mapped to them", () => {
  it("shows a KAM the students on a campus mapped to them", async () => {
    const rows = await t.asUser(KAM_USER, `select id from students where id = $1`, [ids.priya]);
    expect(rows).toHaveLength(1);
  });

  it("hides students on a campus that is not theirs", async () => {
    const rows = await t.asUser(KAM_USER, `select id from students where id = $1`, [ids.arjun]);
    expect(rows).toHaveLength(0);
  });

  it("shows a KAM the applications of their own campus, and no others", async () => {
    const rows = await t.asUser(KAM_USER, `select student_id from applications`);
    expect(rows).not.toHaveLength(0);
    expect(rows.every((r) => r.student_id === ids.priya)).toBe(true);
  });

  it("shows a KAM the offers of their own campus, and no others", async () => {
    const rows = await t.asUser(KAM_USER, `select student_id from offers`);
    expect(rows).not.toHaveLength(0);
    expect(rows.every((r) => r.student_id === ids.priya)).toBe(true);
  });

  it("keeps a KAM read-only: they may not edit a student they can see", async () => {
    const rows = await t.asUser(
      KAM_USER,
      `update students set overall_cgpa = 9.9 where id = $1 returning id`,
      [ids.priya],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("campus scoping reaches the tables that carry the profile", () => {
  it("hides another campus's applications from a CPC", async () => {
    const rows = await t.asUser(ids.cpcUser, `select student_id from applications`);
    expect(rows).not.toHaveLength(0);
    expect(rows.every((r) => r.student_id === ids.priya)).toBe(true);
  });

  it("hides another campus's offers from a CPC", async () => {
    const rows = await t.asUser(ids.cpcUser, `select student_id from offers`);
    expect(rows.every((r) => r.student_id === ids.priya)).toBe(true);
  });

  it("hides another campus's documents from a CPC", async () => {
    const rows = await t.asUser(ids.cpcUser, `select student_id from student_documents`);
    expect(rows.every((r) => r.student_id === ids.priya)).toBe(true);
  });

  it("hides another campus's semester records from a CPC", async () => {
    const rows = await t.asUser(ids.cpcUser, `select student_id from student_semesters`);
    expect(rows.every((r) => r.student_id === ids.priya)).toBe(true);
  });

  it("still lets a CPC verify a semester on their own campus", async () => {
    const rows = await t.asUser(
      ids.cpcUser,
      `update student_semesters set status = 'verified', verified_by = $2, verified_at = now()
        where student_id = $1 returning id`,
      [ids.priya, ids.cpcUser],
    );
    expect(rows).toHaveLength(1);
  });

  it("leaves the Central CPC organisation-wide", async () => {
    const rows = await t.asUser(ids.centralUser, `select student_id from applications`);
    expect(rows.some((r) => r.student_id === ids.arjun)).toBe(true);
  });
});

describe("an Account Executive can follow the drives they raised", () => {
  it("shows an AE the applicants to their own drive, across campuses", async () => {
    const rows = await t.asUser(
      AE_USER,
      `select student_id from applications where drive_id = $1`,
      [aeDrive],
    );
    expect(rows).toHaveLength(2);
  });

  it("hides the applicants to a drive someone else raised", async () => {
    const rows = await t.asUser(AE_USER, `select id from applications where drive_id = $1`, [
      otherDrive,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("does not let an AE read the students table wholesale", async () => {
    const rows = await t.asUser(AE_USER, `select id from students`);
    expect(rows).toHaveLength(0);
  });

  it("does not let an AE write an application", async () => {
    const rows = await t.asUser(
      AE_USER,
      `update applications set resume_id = null where drive_id = $1 returning id`,
      [aeDrive],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("Enterprise Relations reads the organisation, and writes nothing", () => {
  it("lets ER see students across campuses", async () => {
    const rows = await t.asUser(ER_USER, `select id from students`);
    expect(rows.length).toBeGreaterThan(1);
  });

  it("does not let ER edit a student", async () => {
    const rows = await t.asUser(
      ER_USER,
      `update students set overall_cgpa = 9.9 where id = $1 returning id`,
      [ids.priya],
    );
    expect(rows).toHaveLength(0);
  });
});
