// @ts-nocheck
// TEMPORARY diagnostic for the notifications FK violation — delete after running.
import { beforeAll, describe, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
const AE_USER = "61000000-0000-0000-0000-000000000001";

async function step(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`OK   ${label}`);
  } catch (error) {
    console.log(`FAIL ${label}: ${error.message}`);
  }
}

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-guard@faceprep.in','AE Guard','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-guard@faceprep.in')`, [AE_USER]);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
});

describe("where does the notifications FK violation come from", () => {
  it("step by step", async () => {
    await step("update srf_submitted", () =>
      t.sql(`update students set srf_status = 'srf_submitted' where id = $1`, [ids.priya]),
    );

    await step("insert live drive", () =>
      t.sql(
        `insert into drives (company_name, created_by, status, drive_type, offer_category,
                             application_start, application_end, role_title, job_description,
                             work_locations, ctc_min_lpa, role_category)
         values ('Diag Drive',$1,'live','placement','dream','2026-08-01T00:00:00Z',
                 '2036-08-31T00:00:00Z','Engineer','Build things','Chennai',6,'software_technical')`,
        [AE_USER],
      ),
    );

    await step("apply as priya (expected refusal)", () =>
      t.asUser(
        ids.priyaUser,
        `insert into applications (drive_id, student_id, profile_snapshot)
         values ((select id from drives where company_name='Diag Drive'), $1, '{}'::jsonb)`,
        [ids.priya],
      ),
    );

    await step("restore srf_approved", () =>
      t.sql(`update students set srf_status = 'srf_approved' where id = $1`, [ids.priya]),
    );

    await step("what notifications exist", async () => {
      const rows = await t.sql(`select student_id, kind, drive_id from notifications`);
      console.log("   notifications:", JSON.stringify(rows));
    });
  });
});
