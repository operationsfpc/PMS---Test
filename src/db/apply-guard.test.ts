import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * The apply gate, enforced IN the database (0041).
 *
 * Until 2026-08-12 the category ladder ran only in the browser — and not even
 * there, because the offers select named a non-existent column and the error
 * was swallowed. A student could apply to any drive by crafting one POST.
 * These tests prove the gates that protect other people's opportunities as a
 * REAL student through RLS, not as the superuser.
 *
 * D5 (2026-08-12): self-placed offers now climb the ladder and consume the
 * internship cap, exactly like on-campus offers.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const AE_USER = "61000000-0000-0000-0000-000000000001";

/** Each test gets its own drive so refusals cannot leak between them. */
let seq = 0;
async function makeDrive(over: Partial<Record<string, unknown>> = {}): Promise<string> {
  seq += 1;
  const defaults: Record<string, unknown> = {
    company_name: `Drive ${seq}`,
    created_by: AE_USER,
    status: "live",
    drive_type: "placement",
    offer_category: "dream",
    application_start: "2026-08-01T00:00:00Z",
    application_end: "2036-08-31T00:00:00Z",
    open_to_all_override: false,
    // live_requires_complete_record (PRD 6.2)
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

async function apply(driveId: string): Promise<Record<string, unknown>[]> {
  return t.asUser(
    ids.priyaUser,
    `insert into applications (drive_id, student_id, profile_snapshot)
     values ($1, $2, '{}'::jsonb) returning id`,
    [driveId, ids.priya],
  );
}

/** An offer already held by Priya, written by the trusted server context. */
async function giveOffer(over: Partial<Record<string, unknown>> = {}): Promise<void> {
  const defaults: Record<string, unknown> = {
    student_id: ids.priya,
    drive_id: null,
    source: "self_placed",
    company_name: "Elsewhere Ltd",
    drive_type: "placement",
    offer_category: "dream",
    ctc_lpa: 8,
    approved_by: ids.centralUser,
    approved_at: "2026-08-01T00:00:00Z",
  };
  const row = { ...defaults, ...over };
  const cols = Object.keys(row);
  await t.sql(
    `insert into offers (${cols.join(",")})
     values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(row),
  );
}

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-guard@faceprep.in','AE Guard','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-guard@faceprep.in')`, [AE_USER]);

  // Priya claims her rostered account — the real sign-in path.
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
});

describe("gates every application must pass (0041)", () => {
  it("lets an approved, active student apply to a live in-window drive", async () => {
    const drive = await makeDrive();
    const rows = await apply(drive);
    expect(rows).toHaveLength(1);
  });

  it("refuses a drive that is not live", async () => {
    const drive = await makeDrive({
      status: "approved",
      application_start: null,
      application_end: null,
    });
    await t.expectRejection(() => apply(drive), /not open/i);
  });

  it("refuses an application outside the window", async () => {
    const drive = await makeDrive({
      application_start: "2026-01-01T00:00:00Z",
      application_end: "2026-01-02T00:00:00Z",
    });
    await t.expectRejection(() => apply(drive), /window|closed/i);
  });

  it("refuses a student whose form is not approved", async () => {
    await t.sql(`update students set srf_status = 'srf_submitted' where id = $1`, [ids.priya]);
    const drive = await makeDrive();
    await t.expectRejection(() => apply(drive), /registration form/i);
    await t.sql(`update students set srf_status = 'srf_approved' where id = $1`, [ids.priya]);
  });

  it("refuses an opted-out student", async () => {
    // Their own student row: opting out is IRREVERSIBLE (0012's guard), so
    // doing this to Priya would poison every later test in this file.
    const LEELA_USER = "62000000-0000-0000-0000-000000000001";
    const LEELA = "52000000-0000-0000-0000-000000000001";
    await t.sql(
      `insert into students (id, campus_id, degree_id, branch_id, roll_number, full_name, email,
                             passing_year, srf_status, participation_status, consent_given_at)
       values ($1,$2,$3,$4,'21CSE7777','Leela K','leela@gmail.com',2026,'srf_approved','opted_out', now())`,
      [LEELA, ids.campusA, ids.degree, ids.branch],
    );
    await t.sql(`insert into auth.users (id, email) values ($1,'leela@gmail.com')`, [LEELA_USER]);

    const drive = await makeDrive();
    await t.expectRejection(
      () =>
        t.asUser(
          LEELA_USER,
          `insert into applications (drive_id, student_id, profile_snapshot)
           values ($1, $2, '{}'::jsonb) returning id`,
          [drive, LEELA],
        ),
      /opted out/i,
    );
  });

  it("refuses a drive targeted at somebody else's campus", async () => {
    const drive = await makeDrive();
    await t.sql(`insert into drive_target_campuses (drive_id, campus_id) values ($1,$2)`, [
      drive,
      ids.campusB,
    ]);
    await t.expectRejection(() => apply(drive), /campus/i);
  });

  it("allows a drive targeted at the student's own campus", async () => {
    const drive = await makeDrive();
    await t.sql(`insert into drive_target_campuses (drive_id, campus_id) values ($1,$2)`, [
      drive,
      ids.campusA,
    ]);
    expect(await apply(drive)).toHaveLength(1);
  });
});

describe("the category ladder, server-side (D5: self-placed offers count)", () => {
  it("refuses an equal-category drive once a self-placed offer holds that rung", async () => {
    await giveOffer({ offer_category: "dream" });
    const drive = await makeDrive({ offer_category: "dream" });
    await t.expectRejection(() => apply(drive), /already placed/i);
  });

  it("refuses a lower-category drive", async () => {
    const drive = await makeDrive({ offer_category: "regular" });
    await t.expectRejection(() => apply(drive), /already placed/i);
  });

  it("allows the next rung up", async () => {
    const drive = await makeDrive({ offer_category: "super_dream" });
    expect(await apply(drive)).toHaveLength(1);
  });

  it("open_to_all_override bypasses the ladder (R5a)", async () => {
    const drive = await makeDrive({
      offer_category: "regular",
      open_to_all_override: true,
      open_to_all_reason: "Prestige employer",
    });
    expect(await apply(drive)).toHaveLength(1);
  });

  it("a self-placed INTERNSHIP consumes the cap and blocks internship drives", async () => {
    await giveOffer({
      company_name: "Intern Corp",
      drive_type: "internship",
      offer_category: null,
    });
    const drive = await makeDrive({ drive_type: "internship", offer_category: null });
    await t.expectRejection(() => apply(drive), /internship/i);
  });
});

describe("a self-placed ladder offer must carry a category (D6)", () => {
  it("refuses a self-placed job offer without one", async () => {
    await t.expectRejection(
      () =>
        giveOffer({
          student_id: ids.arjun,
          offer_category: null,
        }),
      /category/i,
    );
  });

  it("still allows a self-placed internship without one — internships are never classified", async () => {
    await t.sql(`delete from offers where student_id = $1`, [ids.arjun]);
    await giveOffer({
      student_id: ids.arjun,
      drive_type: "internship",
      offer_category: null,
    });
    const rows = await t.sql(`select id from offers where student_id = $1`, [ids.arjun]);
    expect(rows).toHaveLength(1);
  });
});
