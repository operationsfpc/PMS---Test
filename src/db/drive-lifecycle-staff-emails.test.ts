import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

describe("0080: Drive Lifecycle Staff Email Triggers", () => {
  let t: TestDb;

  const aeId = "11111111-1111-1111-1111-111111111111";
  const dhId = "22222222-2222-2222-2222-222222222222";
  const cpcCentralId = "33333333-3333-3333-3333-333333333333";
  const cpcCampusId = "44444444-4444-4444-4444-444444444444";
  const campusA = "55555555-5555-5555-5555-555555555555";
  const studentId = "66666666-6666-6666-6666-666666666666";
  const degreeId = "77777777-7777-7777-7777-777777777777";
  const branchId = "88888888-8888-8888-8888-888888888888";
  let driveId: string;

  beforeAll(async () => {
    t = await createTestDb();

    const cityId = "99999999-9999-9999-9999-999999999999";
    await t.sql(`insert into cities (id, name, state) values ($1, 'Chennai', 'Tamil Nadu')`, [cityId]);
    await t.sql(
      `insert into campuses (id, name, city_id, code, address, primary_contact_name, primary_contact_email, primary_contact_phone)
       values ($1, 'Test Campus', $2, 'TC', 'Address', 'Contact', 'c@test.com', '9999999999')`,
      [campusA, cityId],
    );
    await t.sql(`insert into degrees (id, name) values ($1, 'B.Tech')`, [degreeId]);
    await t.sql(`insert into branches (id, degree_id, name) values ($1, $2, 'CSE')`, [branchId, degreeId]);

    // Setup staff accounts
    const staff = [
      { id: aeId, email: "ae@faceprep.in", name: "Alice AE", role: "account_executive" },
      { id: dhId, email: "dh@faceprep.in", name: "David DH", role: "delivery_head" },
      { id: cpcCentralId, email: "central@faceprep.in", name: "Charlie Central", role: "central_placement_coordinator" },
      { id: cpcCampusId, email: "campuscpc@faceprep.in", name: "Clara Campus", role: "campus_placement_coordinator" },
    ];

    for (const s of staff) {
      await t.sql(
        `insert into staff_invitations (email, full_name, role) values ($1, $2, $3::app_role)`,
        [s.email, s.name, s.role],
      );
      await t.sql(`insert into auth.users (id, email) values ($1, $2)`, [s.id, s.email]);
    }

    // Assign campus CPC to campusA
    await t.sql(
      `insert into staff_campus_assignments (profile_id, campus_id) values ($1, $2)`,
      [cpcCampusId, campusA],
    );

    // Setup student on campusA
    await t.sql(
      `insert into students (id, campus_id, degree_id, branch_id, roll_number, full_name, email, passing_year, srf_status, consent_given_at)
       values ($1, $2, $3, $4, 'ROLL001', 'Sam Student', 'sam@student.edu', 2026, 'srf_approved', now())`,
      [studentId, campusA, degreeId, branchId],
    );
  });

  it("queues DH1 email to Delivery Head when AE submits PIF", async () => {
    // Clear email deliveries
    await t.sql(`delete from email_deliveries`);

    const inserted = await t.sql(
      `insert into drives (company_name, role_title, ctc_min_lpa, ctc_max_lpa, created_by, status)
       values ('Alpha Tech', 'Software Engineer', 6.0, 8.5, $1, 'submitted')
       returning id`,
      [aeId],
    );
    driveId = inserted[0]?.id as string;

    const emails = await t.sql(
      `select recipient_email, subject, status from email_deliveries where recipient_email = 'dh@faceprep.in'`,
    );

    expect(emails).toHaveLength(1);
    expect(emails[0]?.status).toBe("queued");
    expect(emails[0]?.subject).toContain("PIF Submitted for Review — Alpha Tech");
  });

  it("queues A1 to AE and CP1 to Central CPC when Delivery Head approves PIF", async () => {
    await t.sql(`delete from email_deliveries`);

    await t.sql(
      `update drives
          set status = 'approved',
              offer_category = 'dream',
              approved_by = $1,
              approved_at = now()
        where id = $2`,
      [dhId, driveId],
    );

    const aeEmails = await t.sql(
      `select recipient_email, subject, status from email_deliveries where recipient_email = 'ae@faceprep.in'`,
    );
    expect(aeEmails).toHaveLength(1);
    expect(aeEmails[0]?.subject).toContain("PIF Approved — Alpha Tech");

    const centralEmails = await t.sql(
      `select recipient_email, subject, status from email_deliveries where recipient_email = 'central@faceprep.in'`,
    );
    expect(centralEmails).toHaveLength(1);
    expect(centralEmails[0]?.subject).toContain("Drive Approved: Ready for Round Setup & Publishing");
  });

  it("queues A2 to AE when PIF is rejected with reason", async () => {
    await t.sql(`delete from email_deliveries`);

    const rejectedInserted = await t.sql(
      `insert into drives (company_name, role_title, ctc_min_lpa, ctc_max_lpa, created_by, status)
       values ('Beta Solutions', 'QA Engineer', 4.0, 5.0, $1, 'submitted')
       returning id`,
      [aeId],
    );
    const rejectedDriveId = rejectedInserted[0]?.id as string;

    await t.sql(`delete from email_deliveries`);

    await t.sql(
      `update drives
          set status = 'rejected',
              rejection_reason = 'Stipend and CTC breakup required'
        where id = $1`,
      [rejectedDriveId],
    );

    const aeEmails = await t.sql(
      `select recipient_email, subject, status from email_deliveries where recipient_email = 'ae@faceprep.in'`,
    );
    expect(aeEmails).toHaveLength(1);
    expect(aeEmails[0]?.subject).toContain("Action Required: PIF Revision Requested — Beta Solutions");
  });

  it("queues A3 to AE and C1 to targeted Campus CPCs when Drive goes Live", async () => {
    await t.sql(`delete from email_deliveries`);

    // Target campusA
    await t.sql(
      `insert into drive_target_campuses (drive_id, campus_id) values ($1, $2)`,
      [driveId, campusA],
    );

    // Complete all mandatory live fields
    await t.sql(
      `update drives
          set job_description = 'Full-stack software engineering position',
              work_locations = 'Chennai, Bengaluru',
              role_category = 'software_technical',
              drive_type = 'placement',
              application_start = now(),
              application_end = now() + interval '7 days',
              status = 'live',
              published_by = $1,
              published_at = now()
        where id = $2`,
      [cpcCentralId, driveId],
    );

    const aeEmails = await t.sql(
      `select recipient_email, subject, status from email_deliveries where recipient_email = 'ae@faceprep.in'`,
    );
    expect(aeEmails).toHaveLength(1);
    expect(aeEmails[0]?.subject).toContain("Placement Drive Published — Alpha Tech");

    const campusEmails = await t.sql(
      `select recipient_email, subject, status from email_deliveries where recipient_email = 'campuscpc@faceprep.in'`,
    );
    expect(campusEmails).toHaveLength(1);
    expect(campusEmails[0]?.subject).toContain("New Campus Placement Drive Active — Alpha Tech");
  });

  it("queues C6 to Campus CPC when an offer is declared for their student", async () => {
    await t.sql(`delete from email_deliveries`);

    await t.sql(
      `insert into offers (student_id, drive_id, company_name, drive_type, ctc_lpa, offer_category, source)
       values ($1, $2, 'Alpha Tech', 'placement', 8.5, 'dream', 'on_campus')`,
      [studentId, driveId],
    );

    const cpcEmails = await t.sql(
      `select recipient_email, subject, status from email_deliveries where recipient_email = 'campuscpc@faceprep.in'`,
    );
    expect(cpcEmails).toHaveLength(1);
    expect(cpcEmails[0]?.subject).toContain("Placement Success: Candidate Placed — Sam Student");
  });
});
