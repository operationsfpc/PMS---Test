import { summariseCtc } from "@domain/ctc-statistics";
import { computePlacementStats } from "@domain/statistics";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0064 — `placement_totals()`, the organisation's figures as
 * AGGREGATES.
 *
 * Option A, approved 2026-08-26. An Account Executive may quote the
 * organisation's numbers and must still never read a student record, so the
 * numbers arrive from a `security definer` function instead of from rows.
 *
 * Two things have to be true, and both are tested here:
 *
 *  1. the SQL agrees with `computePlacementStats` and `summariseCtc` — a
 *     second definition of "placed" is how two departments come to quote two
 *     figures from one database;
 *  2. an AE calling it still gets NOTHING from `students`.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let aeUser: string;
let studentUser: string;

/**
 * Always called AS SOMEBODY. The function refuses a caller it cannot place,
 * and the superuser has no app role — which is the guard working, so the
 * tests go through a signed-in coordinator by default.
 */
const totals = async (asUserId?: string) => {
  const rows = await t.asUser(asUserId ?? ids.centralUser, "select * from placement_totals()");
  return rows[0] as Record<string, unknown>;
};

const num = (value: unknown) => Number(value);

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  // The real path a staff member takes: invited, then signed in — the profile
  // row is materialised by the accept_staff_invitation trigger.
  aeUser = "30000000-0000-0000-0000-00000000ae01";
  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae@faceprep.in', 'Asha AE', 'account_executive'::app_role)
     on conflict (email) do nothing`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1, 'ae@faceprep.in')`, [aeUser]);
  studentUser = ids.priyaUser;

  // Four students: one placed on campus, one self-placed, one unplaced, one
  // opted out — the cohort src/domain/statistics.test.ts reasons about.
  const extra = await t.sql(
    `insert into students (campus_id, degree_id, branch_id, full_name, roll_number, email, passing_year, participation_status)
     values ($1,$2,$3,'Self Placed','R-SELF','self@gmail.com',2026,'active'),
            ($1,$2,$3,'Opted Out','R-OUT','out@gmail.com',2026,'opted_out')
     returning id`,
    [ids.campusA, ids.degree, ids.branch],
  );
  const selfPlaced = extra[0]?.id as string;

  const drive = (
    await t.sql(
      // A completed drive must carry the whole record (0060), so it does.
      `insert into drives (company_name, role_title, status, drive_type, offer_category,
                           ctc_min_lpa, job_description, work_locations, role_category,
                           application_start, application_end)
       values ('Zoho','MTS','completed','placement','dream',9,'JD','Chennai','software_technical',
               now() - interval '30 days', now() - interval '10 days')
       returning id`,
    )
  )[0]?.id as string;
  // Draft, not live: `live_requires_complete_record` (0060) rightly refuses a
  // published drive with no JD, and this test is about counting, not publishing.
  await t.sql(
    `insert into drives (company_name, role_title, status) values ('Freshworks','SDE','draft')`,
  );

  // Priya: two on-campus offers. R9 reports ONE per student — the higher.
  await t.sql(
    `insert into offers (student_id, drive_id, source, drive_type, offer_category, ctc_lpa, declared_at, company_name)
     values ($1,$2,'on_campus','placement','dream',9, now(), 'Zoho'),
            ($1,$2,'on_campus','placement','regular',4.5, now(), 'Zoho')`,
    [ids.priya, drive],
  );
  // The self-placed offer never counts as an on-campus placement (PRD 16.2).
  // A self-placed offer only exists once a coordinator has approved it (0006).
  await t.sql(
    `insert into offers (student_id, drive_id, source, drive_type, offer_category, ctc_lpa, declared_at, company_name, approved_by)
     values ($1, null, 'self_placed','placement','regular',4.8, now(), 'Elsewhere Ltd', $2)`,
    [selfPlaced, ids.centralUser],
  );
});

describe("0064 — placement_totals()", () => {
  it("counts the cohort exactly as computePlacementStats does", async () => {
    const row = await totals();

    // priya + arjun + self-placed are active; the opted-out one leaves.
    const domain = computePlacementStats({
      students: [
        {
          studentId: "priya",
          participationStatus: "active",
          hasOnCampusPlacement: true,
          hasSelfPlacement: false,
        },
        {
          studentId: "arjun",
          participationStatus: "active",
          hasOnCampusPlacement: false,
          hasSelfPlacement: false,
        },
        {
          studentId: "self",
          participationStatus: "active",
          hasOnCampusPlacement: false,
          hasSelfPlacement: true,
        },
        {
          studentId: "out",
          participationStatus: "opted_out",
          hasOnCampusPlacement: false,
          hasSelfPlacement: false,
        },
      ],
    });

    expect(num(row.eligible)).toBe(domain.eligible);
    expect(num(row.placed)).toBe(domain.placed);
    expect(num(row.self_placed)).toBe(domain.selfPlaced);
    expect(num(row.opted_out)).toBe(domain.optedOut);
  });

  it("counts completed drives, not every drive", async () => {
    expect(num((await totals()).completed_drives)).toBe(1);
  });

  /** ONE figure per placed student (R9), so two offers must not average twice. */
  it("summarises the package exactly as summariseCtc does", async () => {
    const row = await totals();
    const domain = summariseCtc([{ studentId: "priya", ctcLpa: 9, category: "dream" }]);

    expect(num(row.highest_lpa)).toBe(domain.highestLpa);
    expect(num(row.lowest_lpa)).toBe(domain.lowestLpa);
    expect(num(row.average_lpa)).toBe(domain.averageLpa);
    expect(num(row.median_lpa)).toBe(domain.medianLpa);
  });

  it("leaves the package figures null when nobody is placed rather than calling it zero", async () => {
    const empty = await createTestDb();
    const emptyIds = await seed(empty);
    const [row] = await empty.asUser(emptyIds.centralUser, "select * from placement_totals()");

    expect(row?.highest_lpa).toBeNull();
    expect(row?.average_lpa).toBeNull();
    expect(num(row?.placed)).toBe(0);
  });
});

describe("0064 — who may call it", () => {
  it("answers an Account Executive", async () => {
    const row = await totals(aeUser);
    expect(num(row.eligible)).toBe(3);
  });

  /**
   * THE POINT OF OPTION A. The AE gets the organisation's numbers and still
   * cannot read a single student row.
   */
  it("gives that same Account Executive no student rows at all", async () => {
    const rows = await t.asUser(aeUser, "select id from students");
    expect(rows).toEqual([]);
  });

  it("still answers the Central CPC", async () => {
    expect(num((await totals(ids.centralUser)).eligible)).toBe(3);
  });

  /** A student must not be able to pull the organisation's placement figures. */
  it("refuses a student", async () => {
    await t.expectRejection(
      () => t.asUser(studentUser, "select * from placement_totals()"),
      /not permitted|denied/i,
    );
  });

  it("refuses a caller with no session", async () => {
    await t.expectRejection(
      () => t.asUser(null, "select * from placement_totals()"),
      /not permitted|denied/i,
    );
  });
});

/**
 * Defence in depth. The guard inside the function already refuses a caller
 * with no session, but Supabase grants EXECUTE on every new function in
 * `public` to `anon` by default, and a signed-out visitor should not be able
 * to reach the organisation's placement figures at all — not even to be told
 * no.
 */
describe("0065 — the signed-out visitor cannot even call it", () => {
  it("does not let anon execute the function", async () => {
    const [row] = await t.sql(
      `select has_function_privilege('anon', 'placement_totals()', 'execute') as may_call,
              has_function_privilege('authenticated', 'placement_totals()', 'execute') as staff_may_call`,
    );

    expect(row?.may_call).toBe(false);
    expect(row?.staff_may_call).toBe(true);
  });
});
