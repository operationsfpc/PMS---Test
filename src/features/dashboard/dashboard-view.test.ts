import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseDashboardView } from "./dashboard-view";

/**
 * The shared reporting dashboard: CEO, ER, ER Head, Campus Manager and - since
 * 0018 - the Key Account Manager, whose campuses are now mapped to them.
 *
 * It was never tested at this layer, and it is the only screen a KAM has. What
 * matters here is that it gathers FACTS and judges nothing: the placement rate
 * is computed by src/domain/statistics.ts from the rows this view returns, so
 * a miscounted row is a wrong number on the CEO's screen.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const student = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  srf_status: "srf_approved",
  participation_status: "active",
  campus_id: "c1",
  campuses: { name: "Alliance University" },
  ...over,
});

function stub(
  opts: {
    students?: unknown[];
    offers?: unknown[];
    drives?: unknown[];
    applications?: unknown[];
  } = {},
): {
  studentQueries: string[];
} {
  const studentQueries: string[] = [];

  server.use(
    http.get(`${BASE}/rest/v1/students`, ({ request }) => {
      studentQueries.push(new URL(request.url).search);
      return HttpResponse.json(opts.students ?? [student()]);
    }),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
    http.get(`${BASE}/rest/v1/drives`, ({ request }) => {
      const all = (opts.drives ?? []) as Array<Record<string, unknown>>;
      // The live-drive query filters server-side; emulate it, or the assertion
      // that only open drives are listed would pass whatever the code did.
      const status = new URL(request.url).searchParams.get("status");
      return HttpResponse.json(status === "eq.live" ? all.filter((d) => d.status === "live") : all);
    }),
    http.get(`${BASE}/rest/v1/applications`, () => HttpResponse.json(opts.applications ?? [])),
  );

  return { studentQueries };
}

describe("createSupabaseDashboardView", () => {
  it("returns one fact row per student for the domain to count", async () => {
    stub({ students: [student(), student({ id: "s2", participation_status: "opted_out" })] });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students).toHaveLength(2);
    expect(snapshot.students[1]?.participationStatus).toBe("opted_out");
  });

  it("counts a placement offer as an on-campus placement", async () => {
    stub({
      offers: [
        { student_id: "s1", source: "on_campus", drive_type: "placement", offer_category: "dream" },
      ],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students[0]?.hasOnCampusPlacement).toBe(true);
    expect(snapshot.offersByCategory).toEqual({ dream: 1 });
  });

  it("counts a convertible internship as a placement, and a plain one as neither", async () => {
    stub({
      students: [student(), student({ id: "s2" })],
      offers: [
        {
          student_id: "s1",
          source: "on_campus",
          drive_type: "internship_convertible",
          offer_category: "regular",
        },
        { student_id: "s2", source: "on_campus", drive_type: "internship", offer_category: null },
      ],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students[0]?.hasOnCampusPlacement).toBe(true);
    expect(snapshot.students[1]?.hasOnCampusPlacement).toBe(false);
    // A plain internship has no category, so it never lands on the ladder.
    expect(snapshot.offersByCategory).toEqual({ regular: 1 });
  });

  it("keeps a self-placed offer out of the on-campus count entirely (PRD §16.2)", async () => {
    stub({
      offers: [
        {
          student_id: "s1",
          source: "self_placed",
          drive_type: "placement",
          offer_category: "dream",
        },
      ],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students[0]?.hasSelfPlacement).toBe(true);
    expect(snapshot.students[0]?.hasOnCampusPlacement).toBe(false);
    expect(snapshot.offersByCategory).toEqual({});
  });

  it("counts drives by status", async () => {
    stub({ drives: [{ status: "live" }, { status: "live" }, { status: "completed" }] });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.drivesByStatus).toEqual({ live: 2, completed: 1 });
  });

  it("breaks the same definitions down per campus, so a row cannot disagree with the headline", async () => {
    stub({
      students: [
        student(),
        student({ id: "s2", campus_id: "c2", campuses: { name: "VIT Bangalore" } }),
        student({ id: "s3", participation_status: "opted_out" }),
      ],
      offers: [
        { student_id: "s1", source: "on_campus", drive_type: "placement", offer_category: "dream" },
      ],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.campuses).toEqual([
      { campusId: "c1", campusName: "Alliance University", eligible: 1, placed: 1 },
      { campusId: "c2", campusName: "VIT Bangalore", eligible: 1, placed: 0 },
    ]);
  });

  it("names a student with no campus rather than dropping them from the report", async () => {
    stub({ students: [student({ campus_id: null, campuses: null })] });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.campuses[0]?.campusName).toBe("Unassigned campus");
  });

  /**
   * Scoping is RLS's job - a KAM is returned only the students on the campuses
   * mapped to them (0018). The optional filter is a narrowing on top of that,
   * and passing none must never mean "no students".
   */
  it("asks for every student it is allowed to see when given no campus filter", async () => {
    const { studentQueries } = stub();

    await createSupabaseDashboardView(client()).snapshot();

    expect(studentQueries[0]).not.toMatch(/campus_id=in/);
  });

  it("narrows to the given campuses when it is given some", async () => {
    const { studentQueries } = stub();

    await createSupabaseDashboardView(client(), ["c1", "c2"]).snapshot();

    expect(studentQueries[0]).toMatch(/campus_id=in\.%28c1%2Cc2%29/);
  });

  it("does not treat an empty campus list as 'no campuses'", async () => {
    const { studentQueries } = stub();

    await createSupabaseDashboardView(client(), []).snapshot();

    expect(studentQueries[0]).not.toMatch(/campus_id=in/);
  });

  it("skips the offer query entirely when there are no students to ask about", async () => {
    stub({ students: [] });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students).toEqual([]);
    expect(snapshot.offersByCategory).toEqual({});
  });
});

/**
 * The figures added 2026-08-05: the registration funnel and the package.
 *
 * The rule that matters is R9 — a student with several offers contributes ONE
 * figure, at their placement record. Feeding every offer row into the average
 * would inflate the package and disagree with the placed count printed beside
 * it on the same screen.
 */
describe("the funnel and package inputs", () => {
  it("carries each student's registration state for the funnel", async () => {
    stub({ students: [student({ srf_status: "srf_approved" })] });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students[0]?.srfStatus).toBe("srf_approved");
  });

  it("defaults a student with no recorded SRF state to invited", async () => {
    stub({ students: [student({ srf_status: null })] });

    expect((await createSupabaseDashboardView(client()).snapshot()).students[0]?.srfStatus).toBe(
      "invited",
    );
  });

  it("knows which students have applied to something", async () => {
    stub({
      students: [student(), student({ id: "s2" })],
      applications: [{ student_id: "s1" }],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students[0]?.hasApplied).toBe(true);
    expect(snapshot.students[1]?.hasApplied).toBe(false);
  });

  it("reduces a student's offers to the one that is their placement record", async () => {
    stub({
      offers: [
        {
          id: "o1",
          student_id: "s1",
          drive_id: "d1",
          source: "on_campus",
          drive_type: "placement",
          offer_category: "dream",
          ctc_lpa: "7.00",
          declared_at: "2026-06-01T00:00:00Z",
        },
        {
          id: "o2",
          student_id: "s1",
          drive_id: "d2",
          source: "on_campus",
          drive_type: "placement",
          offer_category: "super_dream",
          ctc_lpa: "14.00",
          declared_at: "2026-06-10T00:00:00Z",
        },
      ],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    // One student, one figure — the higher package (R9).
    expect(snapshot.placements).toEqual([{ studentId: "s1", ctcLpa: 14, category: "super_dream" }]);
  });

  it("keeps a self-placed offer out of the package figures (PRD §16.2)", async () => {
    stub({
      offers: [
        {
          id: "o1",
          student_id: "s1",
          drive_id: null,
          source: "self_placed",
          drive_type: "placement",
          offer_category: "dream",
          ctc_lpa: "20.00",
          declared_at: "2026-06-01T00:00:00Z",
        },
      ],
    });

    expect((await createSupabaseDashboardView(client()).snapshot()).placements).toEqual([]);
  });

  it("reports no placements when nobody holds an offer", async () => {
    stub();

    expect((await createSupabaseDashboardView(client()).snapshot()).placements).toEqual([]);
  });
});

/**
 * Live drives: eligible, applied, offers.
 *
 * "Eligible" is the honest R5 number — the students the drive is actually open
 * to — not "everyone on the roster". Counting the roster would make every
 * conversion look terrible and every targeted drive look ignored.
 */
describe("live drive figures", () => {
  const LIVE_DRIVE = {
    id: "d1",
    company_name: "Zoho Corporation",
    role_title: "MTS",
    status: "live",
    drive_type: "placement",
    offer_category: "dream",
    open_to_all_override: false,
    application_start: "2026-09-01T00:00:00Z",
    application_end: "2026-09-10T00:00:00Z",
    min_overall_cgpa: null,
    min_tenth_percentage: null,
    min_twelfth_percentage: null,
    arrears_policy: "flexible",
    eligible_passing_years: [],
    drive_eligible_degrees: [],
    drive_eligible_branches: [],
    drive_target_campuses: [],
  };

  const eligibleStudent = (over: Record<string, unknown> = {}) =>
    student({
      srf_status: "srf_approved",
      passing_year: 2026,
      overall_cgpa: 8.4,
      tenth_percentage: 90,
      twelfth_percentage: 88,
      current_arrears: 0,
      history_of_arrears: 0,
      degrees: { name: "B.E" },
      branches: { name: "CSE" },
      campuses: { name: "Alliance University", cities: { name: "Chennai" } },
      ...over,
    });

  it("counts the students a live drive is genuinely open to", async () => {
    stub({
      students: [eligibleStudent(), eligibleStudent({ id: "s2" })],
      drives: [LIVE_DRIVE],
    });

    const [drive] = (await createSupabaseDashboardView(client()).snapshot()).liveDrives;

    expect(drive?.eligible).toBe(2);
  });

  it("does not count a student whose form is not verified", async () => {
    stub({
      students: [eligibleStudent(), eligibleStudent({ id: "s2", srf_status: "srf_submitted" })],
      drives: [LIVE_DRIVE],
    });

    expect((await createSupabaseDashboardView(client()).snapshot()).liveDrives[0]?.eligible).toBe(
      1,
    );
  });

  it("does not count a student the drive's cutoff excludes", async () => {
    stub({
      students: [eligibleStudent(), eligibleStudent({ id: "s2", overall_cgpa: 5 })],
      drives: [{ ...LIVE_DRIVE, min_overall_cgpa: 7 }],
    });

    expect((await createSupabaseDashboardView(client()).snapshot()).liveDrives[0]?.eligible).toBe(
      1,
    );
  });

  it("does not count a student at a campus the drive does not target", async () => {
    stub({
      students: [eligibleStudent()],
      drives: [
        {
          ...LIVE_DRIVE,
          drive_target_campuses: [
            { campuses: { name: "VIT Bangalore", cities: { name: "Bengaluru" } } },
          ],
        },
      ],
    });

    expect((await createSupabaseDashboardView(client()).snapshot()).liveDrives[0]?.eligible).toBe(
      0,
    );
  });

  it("counts applications and offers against the drive they belong to", async () => {
    stub({
      students: [eligibleStudent()],
      drives: [LIVE_DRIVE],
      applications: [
        { student_id: "s1", drive_id: "d1" },
        { student_id: "s1", drive_id: "other" },
      ],
      offers: [
        {
          id: "o1",
          student_id: "s1",
          drive_id: "d1",
          source: "on_campus",
          drive_type: "placement",
          offer_category: "dream",
          ctc_lpa: "9.00",
          declared_at: "2026-06-01T00:00:00Z",
        },
      ],
    });

    const [drive] = (await createSupabaseDashboardView(client()).snapshot()).liveDrives;

    expect(drive?.applied).toBe(1);
    expect(drive?.offers).toBe(1);
  });

  it("lists only drives that are open, not every drive ever raised", async () => {
    stub({
      students: [eligibleStudent()],
      drives: [LIVE_DRIVE, { ...LIVE_DRIVE, id: "d2", status: "completed" }],
    });

    const { liveDrives } = await createSupabaseDashboardView(client()).snapshot();

    expect(liveDrives.map((d) => d.driveId)).toEqual(["d1"]);
  });

  it("stamps the snapshot with the instant it was taken", async () => {
    stub({ drives: [] });

    const snapshot = await createSupabaseDashboardView(
      client(),
      undefined,
      () => new Date("2026-09-05T10:00:00Z"),
    ).snapshot();

    expect(snapshot.now).toBe("2026-09-05T10:00:00.000Z");
  });
});
