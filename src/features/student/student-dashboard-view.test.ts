import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseStudentDashboardView } from "./student-dashboard-view";

/**
 * Assembles ONE student's dashboard from live rows.
 *
 * The interesting work is the join: a round belongs to a drive, but whether
 * the student sat it, and how it went, live in three separate tables keyed by
 * application. Getting that wrong shows a student someone else's round result,
 * so it is asserted here rather than trusted.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const STUDENT = {
  id: "s1",
  full_name: "Anjali Subramanian",
  roll_number: "21CSE1042",
  passing_year: 2026,
  srf_status: "srf_approved",
  participation_status: "active",
  degrees: { name: "B.E" },
  branches: { name: "CSE" },
  campuses: { name: "Alliance University" },
  student_semesters: [
    { semester_number: 5, cgpa: "8.40", status: "verified" },
    { semester_number: 6, cgpa: "8.60", status: "pending" },
  ],
};

/** A live drive with no cutoff the seeded student fails. */
const OPEN_DRIVE = {
  id: "d1",
  company_name: "Zoho Corporation",
  role_title: "MTS",
  role_category: "software_technical",
  drive_type: "placement",
  offer_category: "dream",
  open_to_all_override: false,
  status: "live",
  application_start: "2020-01-01T00:00:00Z",
  application_end: "2030-01-01T00:00:00Z",
  ctc_min_lpa: 6.5,
  ctc_max_lpa: 9,
  min_overall_cgpa: null,
  min_tenth_percentage: null,
  min_twelfth_percentage: null,
  arrears_policy: "flexible",
  eligible_passing_years: [],
};

const APPLICATION = {
  id: "app-1",
  // Real applications carry the foreign key as well as the embedded drive:
  // the drives view reads drive_id, this one reads the embed.
  drive_id: "d1",
  applied_at: "2026-07-01T04:30:00Z",
  drives: {
    id: "d1",
    company_name: "Zoho Corporation",
    role_title: "Member Technical Staff",
    drive_rounds: [
      { id: "r1", sequence: 1, name: "Online test" },
      { id: "r2", sequence: 2, name: "Technical interview" },
    ],
  },
};

function stub(
  opts: {
    student?: Record<string, unknown> | null;
    applications?: unknown[];
    offers?: unknown[];
    participants?: unknown[];
    results?: unknown[];
    attendance?: unknown[];
    drives?: unknown[];
  } = {},
) {
  server.use(
    http.get(`${BASE}/rest/v1/students`, () =>
      HttpResponse.json(opts.student === undefined ? STUDENT : opts.student),
    ),
    http.get(`${BASE}/rest/v1/applications`, () =>
      HttpResponse.json(opts.applications ?? [APPLICATION]),
    ),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
    http.get(`${BASE}/rest/v1/round_participants`, () =>
      HttpResponse.json(opts.participants ?? []),
    ),
    http.get(`${BASE}/rest/v1/round_results`, () => HttpResponse.json(opts.results ?? [])),
    http.get(`${BASE}/rest/v1/attendance`, () => HttpResponse.json(opts.attendance ?? [])),
    // Open drives are counted by running R5 over the live ones, so this is a
    // full read rather than a head count.
    http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json(opts.drives ?? [])),
  );
}

const view = () => createSupabaseStudentDashboardView(client(), async () => "u1");

describe("createSupabaseStudentDashboardView", () => {
  it("reads the signed-in student's own identity, not a hardcoded one", async () => {
    stub();
    const snapshot = await view().snapshot();

    expect(snapshot.fullName).toBe("Anjali Subramanian");
    expect(snapshot.rollNumber).toBe("21CSE1042");
    expect(snapshot.degree).toBe("B.E");
    expect(snapshot.branch).toBe("CSE");
    expect(snapshot.campus).toBe("Alliance University");
  });

  it("marks a semester as verified only when a coordinator has verified it", async () => {
    stub();
    const snapshot = await view().snapshot();

    expect(snapshot.semesters).toEqual([
      { semesterNumber: 5, cgpa: 8.4, verified: true },
      { semesterNumber: 6, cgpa: 8.6, verified: false },
    ]);
  });

  it("attaches every round of the drive, marking the ones the student sat", async () => {
    stub({
      participants: [{ round_id: "r1", application_id: "app-1" }],
      results: [{ round_id: "r1", application_id: "app-1", result: "selected" }],
      attendance: [{ round_id: "r1", application_id: "app-1", status: "present" }],
    });

    const [application] = (await view().snapshot()).applications;

    expect(application?.rounds).toEqual([
      {
        sequence: 1,
        name: "Online test",
        participating: true,
        attendance: "present",
        result: "selected",
      },
      {
        sequence: 2,
        name: "Technical interview",
        participating: false,
        attendance: null,
        result: null,
      },
    ]);
  });

  it("never attributes another application's round result to this one", async () => {
    stub({
      participants: [{ round_id: "r1", application_id: "someone-else" }],
      results: [{ round_id: "r1", application_id: "someone-else", result: "rejected" }],
    });

    const [application] = (await view().snapshot()).applications;

    expect(application?.rounds[0]?.participating).toBe(false);
    expect(application?.rounds[0]?.result).toBeNull();
  });

  it("ties an offer to the application it came from", async () => {
    stub({
      offers: [
        {
          id: "o1",
          drive_id: "d1",
          company_name: "Zoho Corporation",
          role_title: "MTS",
          ctc_lpa: "9.00",
          offer_category: "dream",
          declared_at: "2026-07-20T04:30:00Z",
          source: "on_campus",
        },
      ],
    });

    const snapshot = await view().snapshot();

    expect(snapshot.offers[0]?.ctcLpa).toBe(9);
    expect(snapshot.applications[0]?.hasOffer).toBe(true);
  });

  it("does not mark an application as won by an unrelated offer", async () => {
    stub({
      offers: [
        {
          id: "o1",
          drive_id: "other-drive",
          company_name: "Elsewhere",
          role_title: null,
          ctc_lpa: "9.00",
          offer_category: "dream",
          declared_at: "2026-07-20T04:30:00Z",
          source: "on_campus",
        },
      ],
    });

    expect((await view().snapshot()).applications[0]?.hasOffer).toBe(false);
  });

  it("carries a self-placed offer through with its source intact", async () => {
    stub({
      offers: [
        {
          id: "o1",
          drive_id: null,
          company_name: "Family business",
          role_title: null,
          ctc_lpa: "4.00",
          offer_category: null,
          declared_at: "2026-07-20T04:30:00Z",
          source: "self_placed",
        },
      ],
    });

    expect((await view().snapshot()).offers[0]?.source).toBe("self_placed");
  });

  it("counts the student's attendance across every drive, for R8", async () => {
    stub({
      attendance: [
        { round_id: "r1", application_id: "app-1", status: "absent" },
        { round_id: "r2", application_id: "app-1", status: "present" },
      ],
    });

    const snapshot = await view().snapshot();

    expect(snapshot.attendance).toHaveLength(2);
    expect(snapshot.attendance.map((a) => a.status)).toContain("absent");
  });

  /**
   * "3 drives are open to you" must mean three drives THEY can apply to.
   * Counting every live drive would promise a student who is eligible for none
   * of them a list that turns out to be empty - and R5 exists precisely so a
   * student is never shown a drive they can never apply to.
   */
  it("counts only the drives the student may actually apply to (R5)", async () => {
    stub({
      drives: [
        { ...OPEN_DRIVE, id: "d8" },
        { ...OPEN_DRIVE, id: "d9", min_overall_cgpa: 9.9 },
      ],
    });

    expect((await view().snapshot()).openDrives).toBe(1);
  });

  it("does not count a drive whose application window has not opened", async () => {
    stub({
      drives: [
        {
          ...OPEN_DRIVE,
          id: "d8",
          application_start: "2030-01-01T00:00:00Z",
          application_end: "2030-02-01T00:00:00Z",
        },
      ],
    });

    expect((await view().snapshot()).openDrives).toBe(0);
  });

  it("does not count a drive the student has already applied to", async () => {
    stub({ drives: [OPEN_DRIVE], applications: [APPLICATION] });

    expect((await view().snapshot()).openDrives).toBe(0);
  });

  it("refuses to guess when there is no session", async () => {
    stub();
    const anonymous = createSupabaseStudentDashboardView(client(), async () => null);

    await expect(anonymous.snapshot()).rejects.toThrow(/sign in/i);
  });

  it("refuses to guess when the account has no student record", async () => {
    stub({ student: null });

    await expect(view().snapshot()).rejects.toThrow(/student record/i);
  });
});
