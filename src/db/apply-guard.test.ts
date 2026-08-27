import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
    // SPEC CHANGE 2026-08-27 (approved, 0070): an internship offer records a
    // stipend and no CTC. The rule under test — that it consumes the cap —
    // is untouched.
    await giveOffer({
      company_name: "Intern Corp",
      drive_type: "internship",
      offer_category: "internship",
      ctc_lpa: null,
      stipend_monthly: 15000,
    });
    const drive = await makeDrive({ drive_type: "internship", offer_category: "internship" });
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

  /**
   * SPEC CHANGE 2026-08-27 (Karthik, approved — PB2): an internship offer used
   * to carry NO category. It now carries its own, `internship`, so that "is
   * this an internship?" has exactly one answer in the data rather than two
   * spellings of the same fact.
   *
   * What has not changed, and is what this protects: an internship is on no
   * rung of the ladder, so it can never be given one.
   */
  it("takes the internship category on a self-placed internship, and no rung", async () => {
    await t.sql(`delete from offers where student_id = $1`, [ids.arjun]);
    await giveOffer({
      student_id: ids.arjun,
      drive_type: "internship",
      offer_category: "internship",
      ctc_lpa: null,
      stipend_monthly: 15000,
    });
    const rows = await t.sql(`select id from offers where student_id = $1`, [ids.arjun]);
    expect(rows).toHaveLength(1);

    await t.sql(`delete from offers where student_id = $1`, [ids.arjun]);
    await t.expectRejection(
      () =>
        giveOffer({
          student_id: ids.arjun,
          drive_type: "internship",
          offer_category: "dream",
          ctc_lpa: null,
          stipend_monthly: 15000,
        }),
      /internship_carries_internship_category/i,
    );
  });
});

/**
 * 0050 — the area the drive is for, and the school-marks bars.
 *
 * Both rules exist in the domain and are asked by every screen. These prove the
 * DATABASE agrees: the publish screen counts an audience, and a gate looser
 * than that count makes the number a coordinator was shown a promise the
 * database will break.
 */
describe("the area the drive is for", () => {
  /**
   * This file shares ONE database across its tests (`beforeAll`), and the
   * ladder tests above leave Priya holding offers. Clearing them here keeps
   * these tests about the area and nothing else - a refusal from the ladder
   * would otherwise read as a pass or a fail of the wrong rule.
   */
  beforeEach(async () => {
    await t.sql(`delete from offers where student_id = $1`, [ids.priya]);
    await t.sql(`delete from applications where student_id = $1`, [ids.priya]);
    await t.sql(`delete from student_role_preferences where student_id = $1`, [ids.priya]);
    await t.sql(
      `update students set tenth_percentage = 91, twelfth_percentage = 88 where id = $1`,
      [ids.priya],
    );
  });

  const prefer = async (category: string) =>
    await t.sql(
      `insert into student_role_preferences (student_id, category) values ($1, $2)
       on conflict do nothing`,
      [ids.priya, category],
    );

  it("accepts an application to an area the student chose", async () => {
    await prefer("software_technical");

    await expect(apply(await makeDrive())).resolves.toHaveLength(1);
  });

  it("refuses one to an area they did not choose, saying so", async () => {
    await prefer("sales");

    await t.expectRejection(
      async () => await apply(await makeDrive({ role_category: "software_technical" })),
      /area you did not choose/i,
    );
  });

  it("accepts it when they chose several areas including this one", async () => {
    await prefer("sales");
    await prefer("software_technical");

    await expect(apply(await makeDrive())).resolves.toHaveLength(1);
  });

  /**
   * Silence is not refusal. Every form submitted before 0049 recorded no
   * preference at all, and reading that as "wants nothing" would lock the whole
   * existing roster out of every drive, with nothing on screen to explain it.
   */
  it("accepts it from a student who has recorded no preference at all", async () => {
    await expect(apply(await makeDrive())).resolves.toHaveLength(1);
  });

  /**
   * A drive with NO area cannot be live at all - `live_requires_complete_record`
   * (0004) has demanded a role category since the beginning, so the "declares
   * no area" case the domain handles is a DRAFT, and a draft is refused by the
   * status gate long before this rule is reached. The domain still covers it
   * (`src/domain/visibility.test.ts`), because that layer also judges drives
   * that are not live yet - on the publish screen, before they are published.
   */
  it("cannot even be asked about a live drive with no area", async () => {
    await t.expectRejection(
      async () => await makeDrive({ role_category: null }),
      /live_requires_complete_record/i,
    );
  });

  /** A preference, not a sanction — so R5a's override still bypasses it. */
  it("is bypassed by the open-to-all override", async () => {
    await prefer("sales");

    await expect(
      apply(
        await makeDrive({
          open_to_all_override: true,
          // `override_needs_reason` (0004): an override is audit-logged prose,
          // never a bare flag.
          open_to_all_reason: "Prestige drive — the client asked for the whole cohort.",
        }),
      ),
    ).resolves.toHaveLength(1);
  });
});

describe("the 10th and 12th bars", () => {
  beforeEach(async () => {
    await t.sql(`delete from offers where student_id = $1`, [ids.priya]);
    await t.sql(`delete from applications where student_id = $1`, [ids.priya]);
    await t.sql(`delete from student_role_preferences where student_id = $1`, [ids.priya]);
  });

  it("accepts a student who clears both", async () => {
    await t.sql(
      `update students set tenth_percentage = 91, twelfth_percentage = 88 where id = $1`,
      [ids.priya],
    );

    await expect(
      apply(await makeDrive({ min_tenth_percentage: 60, min_twelfth_percentage: 60 })),
    ).resolves.toHaveLength(1);
  });

  it("refuses one who misses the 10th bar, naming it", async () => {
    await t.sql(`update students set tenth_percentage = 55 where id = $1`, [ids.priya]);

    await t.expectRejection(
      async () => await apply(await makeDrive({ min_tenth_percentage: 60 })),
      /at least 60.*10th/i,
    );
  });

  it("refuses one who misses the 12th bar", async () => {
    await t.sql(`update students set twelfth_percentage = 59.99 where id = $1`, [ids.priya]);

    await t.expectRejection(
      async () => await apply(await makeDrive({ min_twelfth_percentage: 60 })),
      /at least 60.*12th/i,
    );
  });

  /** "We do not know" cannot clear a threshold. */
  it("refuses one whose 10th percentage is not on record", async () => {
    await t.sql(`update students set tenth_percentage = null where id = $1`, [ids.priya]);

    await t.expectRejection(
      async () => await apply(await makeDrive({ min_tenth_percentage: 60 })),
      /at least 60.*10th/i,
    );
  });

  /**
   * The override is about placement HISTORY - the ladder and the internship
   * cap. It was never a way past the company's own bar, and the domain checks
   * eligibility before it for the same reason.
   */
  it("is not bypassed by the open-to-all override", async () => {
    await t.sql(`update students set tenth_percentage = 40 where id = $1`, [ids.priya]);

    await t.expectRejection(
      async () =>
        await apply(
          await makeDrive({
            min_tenth_percentage: 60,
            open_to_all_override: true,
            open_to_all_reason: "Prestige drive — the client asked for the whole cohort.",
          }),
        ),
      /at least 60.*10th/i,
    );
  });
});
