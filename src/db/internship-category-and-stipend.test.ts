import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migrations 0066 + 0067 — the Internship category, and a drive that pays a
 * stipend instead of a salary.
 *
 * Karthik, 2026-08-27: "add one more there, as Internship" · "Change all these
 * to just Internship. all data is test so far." · "yes, relax it" (the go-live
 * gate, blocker P10).
 *
 * The rules under test are the DATABASE half of pairs whose other half lives
 * in `src/domain/offer-category.ts` and `src/domain/drive-lifecycle.ts`.
 * Neither half is allowed to be right on its own.
 */
let t: TestDb;
let seq = 0;

const AE_USER = "30000000-0000-0000-0000-0000000000ab";

async function insertDrive(over: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  seq += 1;
  const row: Record<string, unknown> = {
    company_name: `Cat Drive ${seq}`,
    created_by: AE_USER,
    status: "live",
    drive_type: "placement",
    offer_category: "dream",
    application_start: "2026-08-01T00:00:00Z",
    application_end: "2036-08-31T00:00:00Z",
    role_title: "Engineer",
    job_description: "Build things",
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

/** A plain internship: no CTC, a monthly stipend, its own category. */
const internship = (over: Record<string, unknown> = {}) => ({
  drive_type: "internship",
  offer_category: "internship",
  ctc_min_lpa: null,
  stipend_min_monthly: 15000,
  stipend_max_monthly: 20000,
  ...over,
});

beforeAll(async () => {
  t = await createTestDb();
  await seed(t);
  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-cat@faceprep.in','Cat AE','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-cat@faceprep.in')`, [AE_USER]);
}, 60_000);

describe("0066 — the enum value", () => {
  /**
   * PB1: appended, 'internship' would sort ABOVE 'super_dream', and the first
   * `max(offer_category)` anyone writes would make an internship outrank every
   * real offer — hiding that student from every drive on the ladder. Placed
   * first, an accidental ordering fails safe instead.
   */
  it("sorts below every rung of the ladder, so a stray ordering fails safe", async () => {
    const rows = (await t.sql(
      `select string_agg(c::text, ',' order by c) as ordered
         from unnest(enum_range(null::offer_category)) as c`,
    )) as { ordered: string }[];
    expect(rows[0]?.ordered).toBe("internship,regular,dream,super_dream");
  });
});

describe("0067 — drives: the type and the category are a pair", () => {
  it("accepts an internship drive classified as an internship", async () => {
    expect(await insertDrive(internship())).toHaveLength(1);
  });

  it("refuses to put an internship on a rung of the ladder", async () => {
    await t.expectRejection(
      () => insertDrive(internship({ offer_category: "dream" })),
      /internship_carries_internship_category/i,
    );
  });

  it("refuses to call a full-time drive an internship", async () => {
    await t.expectRejection(
      () => insertDrive({ drive_type: "placement", offer_category: "internship" }),
      /internship_carries_internship_category/i,
    );
  });

  it("refuses it for a convertible drive too — that one becomes a salary", async () => {
    await t.expectRejection(
      () => insertDrive({ drive_type: "internship_convertible", offer_category: "internship" }),
      /internship_carries_internship_category/i,
    );
  });

  it("still lets an unclassified draft exist — the category is set at approval", async () => {
    const rows = await insertDrive({
      status: "draft",
      drive_type: "internship",
      offer_category: null,
      ctc_min_lpa: null,
    });
    expect(rows).toHaveLength(1);
  });
});

describe("0067 — going live on a stipend (P10)", () => {
  it("publishes an internship that pays a stipend and no salary", async () => {
    expect(await insertDrive(internship())).toHaveLength(1);
  });

  it("accepts a floor with no ceiling", async () => {
    expect(await insertDrive(internship({ stipend_max_monthly: null }))).toHaveLength(1);
  });

  it("refuses an internship that records no pay at all", async () => {
    await t.expectRejection(
      () => insertDrive(internship({ stipend_min_monthly: null, stipend_max_monthly: null })),
      /live_requires_complete_record/i,
    );
  });

  it("treats a stipend of zero as no stipend", async () => {
    await t.expectRejection(
      () => insertDrive(internship({ stipend_min_monthly: 0, stipend_max_monthly: 0 })),
      /live_requires_complete_record/i,
    );
  });

  it("does NOT let a full-time drive go live on a stipend", async () => {
    await t.expectRejection(
      () =>
        insertDrive({
          ctc_min_lpa: null,
          stipend_min_monthly: 15000,
          stipend_max_monthly: 20000,
        }),
      /live_requires_complete_record/i,
    );
  });

  it("now requires a category of every live drive, internships included", async () => {
    await t.expectRejection(
      () => insertDrive(internship({ offer_category: null })),
      /live_requires_complete_record/i,
    );
  });
});
