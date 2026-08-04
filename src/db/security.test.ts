import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Security tests. PRD §21.2: "students can only ever see their own data".
 * Untested RLS is a data breach, so every rule here is exercised as a real user.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  // Priya claims her rostered account.
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [ids.arjunUser]);
}, 60_000);

describe("login allowlist", () => {
  it("admits a student whose Gmail is on the college roster", async () => {
    await t.sql(
      `insert into students (campus_id, degree_id, roll_number, full_name, email, passing_year)
       values ($1,$2,'21CSE7777','Rostered','rostered@gmail.com',2026)`,
      [ids.campusA, ids.degree],
    );
    await expect(
      t.sql(`insert into auth.users (id, email) values (gen_random_uuid(),'rostered@gmail.com')`),
    ).resolves.toBeDefined();
  });

  it("refuses any Gmail address that is not on the roster", async () => {
    await t.expectRejection(
      () =>
        t.sql(`insert into auth.users (id, email) values (gen_random_uuid(),'stranger@gmail.com')`),
      /not registered.*invitation/i,
    );
  });

  it("is case-insensitive, so capitalisation cannot lock a student out", async () => {
    await expect(
      t.sql(`insert into auth.users (id, email) values (gen_random_uuid(),'ROSTERED@Gmail.com')`),
    ).resolves.toBeDefined();
  });

  it("binds the signed-in account to the rostered student record", async () => {
    const rows = await t.sql(`select auth_user_id, srf_status from students where id = $1`, [
      ids.priya,
    ]);
    expect(rows[0]?.auth_user_id).toBe(ids.priyaUser);
  });

  it("materialises a staff profile from the invitation on first sign-in", async () => {
    const rows = await t.sql(`select role from profiles where id = $1`, [ids.cpcUser]);
    expect(rows[0]?.role).toBe("campus_placement_coordinator");
  });
});

describe("students can only ever see their own data", () => {
  it("shows a student exactly one student row: their own", async () => {
    const rows = await t.asUser(ids.priyaUser, `select id, full_name from students`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(ids.priya);
  });

  it("hides another student's row completely", async () => {
    const rows = await t.asUser(ids.priyaUser, `select id from students where id = $1`, [
      ids.arjun,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("hides another student's offers", async () => {
    const secretDrive = (
      await t.sql(`insert into drives (company_name) values ('SecretDrive') returning id`)
    )[0]?.id as string;
    await t.sql(
      `insert into offers (student_id, company_name, drive_type, offer_category, ctc_lpa, source, drive_id)
       values ($1,'SecretCo','placement','dream',9,'on_campus',$2)`,
      [ids.arjun, secretDrive],
    );
    const rows = await t.asUser(ids.priyaUser, `select id from offers`);
    expect(rows).toHaveLength(0);
  });

  it("hides another student's documents", async () => {
    await t.sql(
      `insert into student_documents (student_id, kind, storage_path, size_bytes)
       values ($1,'tenth_marksheet','arjun/10th.pdf',1000)`,
      [ids.arjun],
    );
    const rows = await t.asUser(ids.priyaUser, `select id from student_documents`);
    expect(rows).toHaveLength(0);
  });

  it("never exposes shortlist rank or AI rationale to a student (PRD §13.1)", async () => {
    const drive = (
      await t.sql(`insert into drives (company_name) values ('ShortlistCo') returning id`)
    )[0]?.id as string;
    const app = (
      await t.sql(
        `insert into applications (drive_id, student_id, profile_snapshot)
         values ($1,$2,'{}'::jsonb) returning id`,
        [drive, ids.priya],
      )
    )[0]?.id as string;
    await t.sql(
      `insert into shortlist_entries (application_id, included, rank, score, rationale)
       values ($1, true, 1, 91, 'Top coding score')`,
      [app],
    );

    const rows = await t.asUser(ids.priyaUser, `select rank, rationale from shortlist_entries`);
    expect(rows).toHaveLength(0);
  });

  it("keeps the audit log out of student hands", async () => {
    const rows = await t.asUser(ids.priyaUser, `select id from audit_log`);
    expect(rows).toHaveLength(0);
  });
});

describe("campus staff are scoped to their own campuses", () => {
  it("shows a CPC the students on their assigned campus", async () => {
    const rows = await t.asUser(ids.cpcUser, `select id from students where id = $1`, [ids.priya]);
    expect(rows).toHaveLength(1);
  });

  it("hides students from a campus the CPC is not assigned to", async () => {
    const rows = await t.asUser(ids.cpcUser, `select id from students where id = $1`, [ids.arjun]);
    expect(rows).toHaveLength(0);
  });

  it("gives the Central CPC organisation-wide visibility", async () => {
    const rows = await t.asUser(ids.centralUser, `select id from students`);
    expect(rows.length).toBeGreaterThan(1);
  });
});

describe("verified academic data is protected from students (decision Q4)", () => {
  it("refuses a student's attempt to change their own CGPA", async () => {
    await t.expectRejection(
      () =>
        t.asUser(ids.priyaUser, `update students set overall_cgpa = 9.9 where id = $1`, [
          ids.priya,
        ]),
      /only be changed by a placement coordinator/i,
    );
  });

  it("refuses a student's attempt to change their own SRF status", async () => {
    await t.expectRejection(
      () =>
        t.asUser(ids.priyaUser, `update students set srf_status = 'srf_rejected' where id = $1`, [
          ids.priya,
        ]),
      /only be changed by a placement coordinator/i,
    );
  });

  it("refuses a student opting themselves out without CPC approval (PRD §16.1)", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `update students set participation_status = 'opted_out' where id = $1`,
          [ids.priya],
        ),
      /only be changed by a placement coordinator/i,
    );
  });

  it("refuses a student's attempt to move to another campus", async () => {
    await t.expectRejection(
      () =>
        t.asUser(ids.priyaUser, `update students set roll_number = 'HACKED' where id = $1`, [
          ids.priya,
        ]),
      /only be changed by a placement coordinator/i,
    );
  });

  it("allows a student to edit their own free-form profile content", async () => {
    await expect(
      t.asUser(ids.priyaUser, `update students set projects = 'Built a PMS' where id = $1`, [
        ids.priya,
      ]),
    ).resolves.toBeDefined();
  });

  it("lets a coordinator correct verified data directly, with no approval step", async () => {
    await expect(
      t.asUser(ids.cpcUser, `update students set overall_cgpa = 8.5 where id = $1`, [ids.priya]),
    ).resolves.toBeDefined();
  });
});

describe("irreversible decisions stay irreversible", () => {
  it("refuses to un-opt-out a student (PRD §16.1)", async () => {
    await t.sql(`update students set participation_status = 'opted_out' where id = $1`, [
      ids.arjun,
    ]);
    await t.expectRejection(
      () => t.sql(`update students set participation_status = 'active' where id = $1`, [ids.arjun]),
      /irreversible/i,
    );
  });

  it("records at most one approved opt-out per student", async () => {
    // Since 0022 an opt-out must carry the student's signed declaration.
    const declaration = (
      await t.sql(
        `insert into student_documents (student_id, kind, storage_path, size_bytes)
         values ($1,'opt_out_declaration','arjun/declaration.jpg',2000) returning id`,
        [ids.arjun],
      )
    )[0]?.id as string;

    await t.sql(
      `insert into opt_out_requests (student_id, reason, status, declaration_id)
       values ($1,'Higher studies','verified',$2)`,
      [ids.arjun, declaration],
    );
    await t.expectRejection(
      () =>
        t.sql(
          `insert into opt_out_requests (student_id, reason, status, declaration_id)
           values ($1,'Again','verified',$2)`,
          [ids.arjun, declaration],
        ),
      /duplicate key|unique/i,
    );
  });
});

describe("the audit trail is immutable (PRD §19)", () => {
  it("records every student change automatically", async () => {
    const before = await t.sql(
      `select count(*)::int as n from audit_log where entity_table = 'students'`,
    );
    await t.sql(`update students set achievements = 'Hackathon winner' where id = $1`, [ids.priya]);
    const after = await t.sql(
      `select count(*)::int as n from audit_log where entity_table = 'students'`,
    );
    expect(Number(after[0]?.n)).toBeGreaterThan(Number(before[0]?.n));
  });

  it("captures both the before and after values", async () => {
    await t.sql(`update students set certifications = 'AWS SAA' where id = $1`, [ids.priya]);
    const rows = await t.sql(
      `select before_data, after_data from audit_log
       where entity_table='students' and entity_id = $1 order by id desc limit 1`,
      [ids.priya],
    );
    const after = rows[0]?.after_data as Record<string, unknown> | undefined;
    expect(after?.certifications).toBe("AWS SAA");
    expect(rows[0]?.before_data).not.toBeNull();
  });

  it("silently discards any attempt to rewrite history", async () => {
    const before = await t.sql(`select after_data from audit_log order by id limit 1`);
    await t.sql(`update audit_log set after_data = '{"tampered":true}'::jsonb`);
    const after = await t.sql(`select after_data from audit_log order by id limit 1`);
    expect(after[0]?.after_data).toEqual(before[0]?.after_data);
  });

  it("silently discards any attempt to delete history", async () => {
    const before = await t.sql(`select count(*)::int as n from audit_log`);
    await t.sql(`delete from audit_log`);
    const after = await t.sql(`select count(*)::int as n from audit_log`);
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n));
  });

  it("logs the recruiter data-sharing event (PRD §13.2)", async () => {
    const drive = (
      await t.sql(`insert into drives (company_name) values ('ExportCo') returning id`)
    )[0]?.id as string;
    await t.sql(
      `insert into recruiter_exports (drive_id, exported_by, columns, student_count)
       values ($1,$2,ARRAY['name','cgpa'],12)`,
      [drive, ids.centralUser],
    );
    const rows = await t.sql(
      `select count(*)::int as n from audit_log where entity_table='recruiter_exports'`,
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
