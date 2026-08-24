import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0060 — a drive whose JD is the recruiter's attached PDF may go
 * live.
 *
 * J1 (2026-08-18, answer 2) made the typed job description optional; the
 * attached PDF is the document of record. The 2026-08-24 morning fix taught
 * `missingBeforeGoLive` that — and missed the rule's database twin:
 * `live_requires_complete_record` (0004) still said `job_description IS NOT
 * NULL`, so the live Infosys drive passed every checklist tick and then died
 * in the PATCH with a message the screen swallowed. Change both or neither.
 */
let t: TestDb;
let seq = 0;

const AE_USER = "30000000-0000-0000-0000-0000000000aa";

async function insertLive(over: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  seq += 1;
  const row: Record<string, unknown> = {
    company_name: `JD Drive ${seq}`,
    created_by: AE_USER,
    status: "live",
    drive_type: "placement",
    offer_category: "dream",
    application_start: "2026-08-01T00:00:00Z",
    application_end: "2036-08-31T00:00:00Z",
    role_title: "Engineer",
    work_locations: "Chennai",
    ctc_min_lpa: 6,
    role_category: "software_technical",
    ...over,
  };
  const cols = Object.keys(row);
  return t.sql(
    `insert into drives (${cols.join(",")})
     values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    Object.values(row),
  );
}

beforeAll(async () => {
  t = await createTestDb();
  await seed(t);
  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-jd@faceprep.in','JD AE','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-jd@faceprep.in')`, [AE_USER]);
}, 60_000);

describe("0060 — going live with the recruiter's own JD", () => {
  it("accepts a live drive whose JD is the attached PDF, typed text blank", async () => {
    const rows = await insertLive({
      job_description: null,
      jd_storage_path: "some-drive/jd.pdf",
      jd_file_name: "jd.pdf",
      jd_size_bytes: 42_000,
    });
    expect(rows).toHaveLength(1);
  });

  it("still accepts typed text with no attachment", async () => {
    const rows = await insertLive({ job_description: "Build things", jd_storage_path: null });
    expect(rows).toHaveLength(1);
  });

  it("still refuses a live drive with neither text nor attachment", async () => {
    await t.expectRejection(
      () => insertLive({ job_description: null, jd_storage_path: null }),
      /live_requires_complete_record/i,
    );
  });
});
