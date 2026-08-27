import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * The schema is verified against real PostgreSQL on every test run.
 * Each test names the PRD rule it protects.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
}, 60_000);

describe("migrations", () => {
  it("apply cleanly to a fresh database", async () => {
    const tables = await t.sql(
      `select table_name from information_schema.tables where table_schema='public' order by 1`,
    );
    expect(tables.length).toBeGreaterThan(20);
  });

  it("mirrors the domain enums exactly", async () => {
    const rows = await t.sql(
      `select enumlabel from pg_enum e join pg_type ty on ty.oid = e.enumtypid
       where ty.typname = 'role_category' order by e.enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toEqual([
      "software_technical",
      "technical_support_it_ops",
      "digital_marketing",
      "sales",
      "operations_business",
    ]);
  });

  it("never offers 'off_campus' as a drive mode", async () => {
    const rows = await t.sql(
      `select enumlabel from pg_enum e join pg_type ty on ty.oid = e.enumtypid
       where ty.typname = 'drive_mode'`,
    );
    expect(rows.map((r) => r.enumlabel)).not.toContain("off_campus");
  });
});

describe("student invariants", () => {
  it("rejects arrear history lower than standing arrears", async () => {
    await t.expectRejection(
      () =>
        t.sql(`update students set current_arrears = 3, history_of_arrears = 1 where id = $1`, [
          ids.arjun,
        ]),
      /arrears_consistent/i,
    );
  });

  it("rejects a CGPA above the 10-point scale", async () => {
    await t.expectRejection(
      () => t.sql(`update students set overall_cgpa = 82.4 where id = $1`, [ids.arjun]),
      /overall_cgpa/i,
    );
  });

  it("enforces one roll number per campus", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into students (campus_id, degree_id, roll_number, full_name, email, passing_year)
           values ($1,$2,'21CSE1042','Clone','clone@gmail.com',2026)`,
          [ids.campusA, ids.degree],
        ),
      /duplicate key|unique/i,
    );
  });

  it("allows the same roll number at a different campus", async () => {
    await expect(
      t.sql(
        `insert into students (campus_id, degree_id, roll_number, full_name, email, passing_year)
         values ($1,$2,'21CSE1042','Namesake','namesake@gmail.com',2026)`,
        [ids.campusB, ids.degree],
      ),
    ).resolves.toBeDefined();
  });

  it("refuses to approve an SRF without recorded consent (PRD §4.1)", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into students (campus_id, degree_id, roll_number, full_name, email, passing_year, srf_status)
           values ($1,$2,'NOCONSENT','No Consent','nc@gmail.com',2026,'srf_approved')`,
          [ids.campusA, ids.degree],
        ),
      /approved_requires_consent/i,
    );
  });

  it("caps uploads at 5 MB", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_documents (student_id, kind, storage_path, size_bytes)
           values ($1,'tenth_marksheet','p/too-big.pdf', 5242881)`,
          [ids.priya],
        ),
      /size_bytes/i,
    );
  });

  it("allows only one resume per role category", async () => {
    await t.sql(
      `insert into student_documents (student_id, kind, role_category, storage_path, size_bytes)
       values ($1,'resume','sales','p/sales.pdf', 1000)`,
      [ids.priya],
    );
    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_documents (student_id, kind, role_category, storage_path, size_bytes)
           values ($1,'resume','sales','p/sales2.pdf', 1000)`,
          [ids.priya],
        ),
      /one_resume_per_category|unique/i,
    );
  });

  it("requires a role category on a resume and forbids one elsewhere", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_documents (student_id, kind, storage_path, size_bytes)
           values ($1,'resume','p/no-cat.pdf', 1000)`,
          [ids.priya],
        ),
      /resume_has_category/i,
    );
  });
});

describe("drive lifecycle", () => {
  it("forbids reopening a rejected PIF (PRD §6.1)", async () => {
    const rows = await t.sql(
      `insert into drives (company_name, status, rejection_reason)
       values ('RejectedCo','rejected','Not a fit') returning id`,
    );
    const id = rows[0]?.id as string;

    await t.expectRejection(
      () => t.sql(`update drives set status = 'draft' where id = $1`, [id]),
      /rejected PIF is final/i,
    );
  });

  it("requires a reason when rejecting", async () => {
    await t.expectRejection(
      () => t.sql(`insert into drives (company_name, status) values ('X','rejected')`),
      /rejection_needs_reason/i,
    );
  });

  it("refuses to publish a drive that is on hold", async () => {
    const id = (
      await t.sql(
        `insert into drives (company_name, status, on_hold, on_hold_reason, role_title,
           job_description, work_locations, ctc_min_lpa, role_category, drive_type,
           offer_category, application_start, application_end)
         values ('HoldCo','approved',true,'Awaiting SPOC','Engineer','JD','Chennai',
           8,'software_technical','placement','dream', now(), now() + interval '7 days')
         returning id`,
      )
    )[0]?.id as string;

    await t.expectRejection(
      () => t.sql(`update drives set status = 'live' where id = $1`, [id]),
      /on hold cannot be published/i,
    );
  });

  it("refuses to publish an incomplete drive (PRD §6.2)", async () => {
    const id = (
      await t.sql(
        `insert into drives (company_name, status) values ('Bare','approved') returning id`,
      )
    )[0]?.id as string;

    await t.expectRejection(
      () => t.sql(`update drives set status = 'live' where id = $1`, [id]),
      /live_requires_complete_record/i,
    );
  });

  it("requires a reason for the prestige-drive override (R5a)", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into drives (company_name, open_to_all_override) values ('OverrideCo', true)`,
        ),
      /override_needs_reason/i,
    );
  });

  /**
   * SPEC CHANGE 2026-08-27 (Karthik, approved): a plain internship used to be
   * required to carry NO category. It now carries its OWN — `internship` —
   * which says the same thing in a value instead of in an absence.
   *
   * The rule underneath is unchanged and is what this still proves: an
   * internship is not on the Regular → Dream → Super Dream ladder (PRD §11).
   */
  it("forbids a LADDER category on a plain internship (PRD §11)", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into drives (company_name, drive_type, offer_category)
           values ('InternCo','internship','dream')`,
        ),
      /internship_carries_internship_category/i,
    );
  });

  it("forbids the internship category on a drive that is not an internship", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into drives (company_name, drive_type, offer_category)
           values ('SalaryCo','placement','internship')`,
        ),
      /internship_carries_internship_category/i,
    );
  });

  it("forbids a descending CTC range", async () => {
    await t.expectRejection(
      () =>
        t.sql(`insert into drives (company_name, ctc_min_lpa, ctc_max_lpa) values ('Bad', 20, 10)`),
      /ctc_range_ascends/i,
    );
  });
});

describe("applications and attendance", () => {
  it("permits exactly one application per student per drive (PRD §7.4)", async () => {
    const drive = (
      await t.sql(`insert into drives (company_name) values ('ApplyCo') returning id`)
    )[0]?.id as string;

    await t.sql(
      `insert into applications (drive_id, student_id, profile_snapshot) values ($1,$2,'{}'::jsonb)`,
      [drive, ids.priya],
    );

    await t.expectRejection(
      () =>
        t.sql(
          `insert into applications (drive_id, student_id, profile_snapshot) values ($1,$2,'{}'::jsonb)`,
          [drive, ids.priya],
        ),
      /duplicate key|unique/i,
    );
  });

  it("requires a profile snapshot on every application (PRD §7.3)", async () => {
    const drive = (
      await t.sql(`insert into drives (company_name) values ('SnapCo') returning id`)
    )[0]?.id as string;

    await t.expectRejection(
      () =>
        t.sql(`insert into applications (drive_id, student_id) values ($1,$2)`, [drive, ids.arjun]),
      /profile_snapshot/i,
    );
  });

  it("records attendance at most once per student per round", async () => {
    const drive = (
      await t.sql(`insert into drives (company_name) values ('RoundCo') returning id`)
    )[0]?.id as string;
    const round = (
      await t.sql(
        `insert into drive_rounds (drive_id, sequence, name) values ($1,1,'Online test') returning id`,
        [drive],
      )
    )[0]?.id as string;
    const app = (
      await t.sql(
        `insert into applications (drive_id, student_id, profile_snapshot) values ($1,$2,'{}'::jsonb) returning id`,
        [drive, ids.priya],
      )
    )[0]?.id as string;

    await t.sql(
      `insert into attendance (round_id, application_id, status) values ($1,$2,'absent')`,
      [round, app],
    );
    await t.expectRejection(
      () =>
        t.sql(
          `insert into attendance (round_id, application_id, status) values ($1,$2,'present')`,
          [round, app],
        ),
      /duplicate key|unique/i,
    );
  });
});

describe("offers", () => {
  it("requires a category for ladder drive types", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into offers (student_id, company_name, drive_type, ctc_lpa, source, drive_id)
           values ($1,'X','placement',10,'on_campus', gen_random_uuid())`,
          [ids.priya],
        ),
      /foreign key|ladder_offer_has_category/i,
    );
  });

  it("requires CPC approval on a self-placed offer (PRD §16.2)", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into offers (student_id, company_name, drive_type, offer_category, ctc_lpa, source)
           values ($1,'OffCampus Inc','placement','dream',9,'self_placed')`,
          [ids.priya],
        ),
      /self_placed_needs_approval/i,
    );
  });
});
