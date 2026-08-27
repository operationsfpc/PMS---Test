import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * `0056` — UAT 2026-08-21:
 *
 * Item 1 (Q1b): the internship cap refuses PLAIN internship drives only.
 *   An internship-convertible drive is primarily a placement, so the
 *   category ladder decides it — the student placed Regular via a
 *   convertible offer (TestShash, live, 21/08) keeps Dream convertibles
 *   open. Supersedes decision Q2 (2026-08-12).
 *
 * Item 2 (Q4/Q5): `drives.venue` exists, nullable — NULL is "venue not yet
 *   confirmed", recorded late by the Central CPC.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const AE_USER = "63000000-0000-0000-0000-000000000001";

let seq = 0;
async function makeDrive(over: Partial<Record<string, unknown>> = {}): Promise<string> {
  seq += 1;
  const defaults: Record<string, unknown> = {
    company_name: `Cap Drive ${seq}`,
    created_by: AE_USER,
    status: "live",
    drive_type: "placement",
    offer_category: "dream",
    application_start: "2026-08-01T00:00:00Z",
    application_end: "2036-08-31T00:00:00Z",
    open_to_all_override: false,
    role_title: "Engineer",
    job_description: "Build things",
    work_locations: "Chennai",
    ctc_min_lpa: 6,
    role_category: "software_technical",
  };
  const row = { ...defaults, ...over };
  const cols = Object.keys(row);
  const inserted = await t.sql(
    `insert into drives (${cols.join(",")})
     values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    Object.values(row),
  );
  return inserted[0]?.id as string;
}

const applyAs = (driveId: string) =>
  t.asUser(
    ids.priyaUser,
    `insert into applications (drive_id, student_id, profile_snapshot)
     values ($1, $2, '{}'::jsonb) returning id`,
    [driveId, ids.priya],
  );

/** Priya holds a Regular offer from an internship-convertible drive. */
async function placePriyaViaConvertible(): Promise<void> {
  const sourceDrive = await makeDrive({
    drive_type: "internship_convertible",
    offer_category: "regular",
    stipend_min_monthly: 20000,
  });
  await t.sql(
    `insert into offers (student_id, drive_id, company_name, drive_type, offer_category, ctc_lpa, source)
     values ($1, $2, 'Deloitte', 'internship_convertible', 'regular', 5, 'on_campus')`,
    [ids.priya, sourceDrive],
  );
}

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-cap@faceprep.in','AE Cap','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-cap@faceprep.in')`, [AE_USER]);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);

  await placePriyaViaConvertible();
}, 60_000);

describe("item 1 — the cap refuses plain internships only (Q1b)", () => {
  it("admits a convertible-placed student to a HIGHER-category convertible drive", async () => {
    // The 21/08 report, replayed against the schema: Regular via convertible,
    // then a Dream internship-convertible drive.
    const dream = await makeDrive({
      drive_type: "internship_convertible",
      offer_category: "dream",
      stipend_min_monthly: 25000,
    });
    const rows = await applyAs(dream);
    expect(rows).toHaveLength(1);
  });

  it("still refuses them a PLAIN internship drive — the allowance is used", async () => {
    const internship = await makeDrive({
      drive_type: "internship",
      // 2026-08-27: an internship carries its own category (PB2).
      offer_category: "internship",
      stipend_min_monthly: 15000,
    });
    await t.expectRejection(() => applyAs(internship), /already accepted an internship/i);
  });

  it("still refuses an EQUAL-category convertible — the ladder, not the cap", async () => {
    const regular = await makeDrive({
      drive_type: "internship_convertible",
      offer_category: "regular",
      stipend_min_monthly: 20000,
    });
    await t.expectRejection(() => applyAs(regular), /already placed at this category or higher/i);
  });
});

describe("item 2 — the venue column", () => {
  it("exists, nullable — NULL is 'venue not yet confirmed'", async () => {
    const driveId = await makeDrive({ drive_mode: "physical_outside_campus" });
    const [row] = await t.sql(`select venue from drives where id = $1`, [driveId]);
    expect(row?.venue).toBeNull();

    await t.sql(`update drives set venue = 'HCL Campus, Sholinganallur' where id = $1`, [driveId]);
    const [after] = await t.sql(`select venue from drives where id = $1`, [driveId]);
    expect(after?.venue).toBe("HCL Campus, Sholinganallur");
  });
});
