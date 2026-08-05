import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../mocks/node";
import type { ApplyRepository } from "./apply-repository";
import { createSupabaseDrivesView } from "./drives-view";

/**
 * Turns database rows into the student's list, applying R5.
 *
 * A drive hidden by the ladder, the internship cap, opt-out or eligibility is
 * dropped here - it must never reach the screen at all.
 */
const BASE = "https://project.supabase.co";

const studentRow = {
  id: "s1",
  full_name: "Asha",
  roll_number: "TEC001",
  email: "asha@example.com",
  passing_year: 2027,
  overall_cgpa: 8.24,
  tenth_percentage: 91.4,
  twelfth_percentage: 88,
  current_arrears: 0,
  history_of_arrears: 0,
  technical_skills: "TS",
  srf_status: "srf_approved",
  participation_status: "active",
  degrees: { name: "B.E" },
  branches: { name: "CSE" },
  // Shape mirrors PostgREST: city is an embedded resource, not a column.
  campuses: { name: "Test Engineering College", cities: { name: "Chennai" } },
  student_documents: [],
};

const driveRow = {
  id: "d1",
  company_name: "Zoho",
  role_title: "MTS",
  role_category: "software_technical",
  drive_type: "placement",
  offer_category: "dream",
  open_to_all_override: false,
  status: "live",
  application_start: "2026-09-01T00:00:00Z",
  application_end: "2026-09-10T00:00:00Z",
  ctc_min_lpa: 6.5,
  ctc_max_lpa: 9,
  min_overall_cgpa: null,
  min_tenth_percentage: null,
  min_twelfth_percentage: null,
  arrears_policy: "flexible",
  eligible_passing_years: [],
};

function stub(
  opts: {
    drives?: unknown[];
    applications?: unknown[];
    offers?: unknown[];
    student?: Record<string, unknown>;
  } = {},
) {
  server.use(
    http.get(`${BASE}/rest/v1/students`, () =>
      HttpResponse.json({ ...studentRow, ...(opts.student ?? {}) }),
    ),
    http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json(opts.drives ?? [driveRow])),
    http.get(`${BASE}/rest/v1/applications`, () => HttpResponse.json(opts.applications ?? [])),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
  );
}

const view = (over: { apply?: ApplyRepository["apply"] } = {}) =>
  createSupabaseDrivesView(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => "u1",
    () => new Date("2026-09-05T00:00:00Z"),
    over.apply === undefined ? undefined : ({ apply: over.apply } as ApplyRepository),
  );

/** The row as PostgREST returns it, with only what a test cares about set. */
const liveDrive = (over: Record<string, unknown> = {}) => ({ ...driveRow, ...over });

/**
 * Confirmed 2026-08-04: eligibility is judged on the LATEST VERIFIED semester,
 * not on the single cumulative figure the student typed once.
 *
 * A student enters their own marks, so an unverified line deciding whether
 * they may apply would let anyone qualify for anything by typing 10.
 */
describe("which CGPA eligibility is judged on", () => {
  const cutoff = [{ ...driveRow, min_overall_cgpa: 8 }];

  it("uses the latest verified semester, not students.overall_cgpa", async () => {
    stub({
      drives: cutoff,
      student: {
        overall_cgpa: 9.5,
        student_semesters: [
          {
            semester_number: 1,
            cgpa: 9.5,
            current_arrears: 0,
            history_of_arrears: 0,
            status: "verified",
          },
          {
            semester_number: 2,
            cgpa: 6.2,
            current_arrears: 0,
            history_of_arrears: 0,
            status: "verified",
          },
        ],
      },
    });

    // Latest verified is 6.2, below the 8.0 cutoff, so R5 hides the drive.
    expect(await view().openDrives()).toHaveLength(0);
  });

  it("ignores a later semester nobody has verified", async () => {
    stub({
      drives: cutoff,
      student: {
        student_semesters: [
          {
            semester_number: 1,
            cgpa: 8.6,
            current_arrears: 0,
            history_of_arrears: 0,
            status: "verified",
          },
          {
            semester_number: 2,
            cgpa: 10,
            current_arrears: 0,
            history_of_arrears: 0,
            status: "pending",
          },
        ],
      },
    });

    expect(await view().openDrives()).toHaveLength(1);
  });

  it("takes the arrear counts from that same semester", async () => {
    stub({
      drives: [{ ...driveRow, min_overall_cgpa: null, arrears_policy: "no_standing" }],
      student: {
        current_arrears: 0,
        student_semesters: [
          {
            semester_number: 3,
            cgpa: 9,
            current_arrears: 2,
            history_of_arrears: 2,
            status: "verified",
          },
        ],
      },
    });

    expect(await view().openDrives()).toHaveLength(0);
  });

  /**
   * Falls back to the roster figure rather than locking every student out on
   * the day this ships: nobody has a verified semester yet.
   */
  it("falls back to the roster CGPA when no semester is verified yet", async () => {
    stub({
      drives: cutoff,
      student: { overall_cgpa: 8.24, student_semesters: [] },
    });

    expect(await view().openDrives()).toHaveLength(1);
  });
});

describe("createSupabaseDrivesView", () => {
  it("lists a live drive the student is eligible for, and offers to apply", async () => {
    stub();
    const rows = await view().openDrives();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.companyName).toBe("Zoho");
    expect(rows[0]?.canApply).toBe(true);
    expect(rows[0]?.ctcLabel).toBe("₹6.5–9 LPA");
  });

  it("marks a drive already applied to, and does not offer it again", async () => {
    stub({ applications: [{ drive_id: "d1" }] });
    const rows = await view().openDrives();

    expect(rows[0]?.applied).toBe(true);
    expect(rows[0]?.canApply).toBe(false);
  });

  it("drops a drive the student fails eligibility for, rather than showing it", async () => {
    stub({ drives: [{ ...driveRow, min_overall_cgpa: 9.5 }] });
    const rows = await view().openDrives();

    expect(rows).toHaveLength(0);
  });

  it("shows a fixed CTC without a range", async () => {
    stub({ drives: [{ ...driveRow, ctc_max_lpa: null }] });
    const rows = await view().openDrives();

    expect(rows[0]?.ctcLabel).toBe("₹6.5 LPA");
  });
});

/**
 * Drive TARGETING — the degrees, branches and campuses the Central CPC picks
 * on the publish screen.
 *
 * `evaluateEligibility` documents that an empty list means "any, never none",
 * so a view that does not load the link tables at all silently makes every
 * targeted drive open to everybody. A drive raised for B.E CSE at one campus
 * was visible to a BCA student at another, and applyable by them.
 */
describe("drive targeting is enforced, not just recorded", () => {
  const targeted = (over: Record<string, unknown>) => [{ ...driveRow, ...over }];

  it("hides a drive targeted at a different degree", async () => {
    stub({ drives: targeted({ drive_eligible_degrees: [{ degrees: { name: "B.Tech" } }] }) });

    expect(await view().openDrives()).toHaveLength(0);
  });

  it("shows a drive targeted at the student's own degree", async () => {
    stub({ drives: targeted({ drive_eligible_degrees: [{ degrees: { name: "B.E" } }] }) });

    expect(await view().openDrives()).toHaveLength(1);
  });

  it("hides a drive targeted at a different branch", async () => {
    stub({ drives: targeted({ drive_eligible_branches: [{ branches: { name: "ECE" } }] }) });

    expect(await view().openDrives()).toHaveLength(0);
  });

  it("hides a drive targeted at another campus", async () => {
    stub({
      drives: targeted({
        drive_target_campuses: [
          { campuses: { name: "VIT Bangalore", cities: { name: "Bengaluru" } } },
        ],
      }),
    });

    expect(await view().openDrives()).toHaveLength(0);
  });

  it("shows a drive targeted at the student's own campus", async () => {
    stub({
      drives: targeted({
        drive_target_campuses: [
          { campuses: { name: "Test Engineering College", cities: { name: "Chennai" } } },
        ],
      }),
    });

    expect(await view().openDrives()).toHaveLength(1);
  });

  it("leaves an untargeted drive open to everyone, as an empty list means any", async () => {
    stub({
      drives: targeted({
        drive_eligible_degrees: [],
        drive_eligible_branches: [],
        drive_target_campuses: [],
      }),
    });

    expect(await view().openDrives()).toHaveLength(1);
  });
});

/**
 * F14 (UAT 2026-08-06): "Add a view more button to view further details on the
 * drives displayed" and "Ask for a drive specific resume to be uploaded at the
 * time of applying."
 *
 * The list carried a company, a role and a CTC. A student deciding whether to
 * commit to every round of a drive had nothing else to go on.
 */
describe("createSupabaseDrivesView — the detail behind View more", () => {
  it("carries the job description, locations and package detail", async () => {
    stub({
      drives: [
        liveDrive({
          job_description: "Build and maintain backend services.",
          work_locations: "Chennai, Tenkasi",
          ctc_breakup: "6.5 fixed + 2.5 variable",
          mandatory_skills: "TypeScript, SQL",
          bond_details: "No bond",
          shift_type: "General",
          openings: 25,
          drive_mode: "on_campus",
        }),
      ],
    });

    const [drive] = await view().openDrives();

    expect(drive?.details.jobDescription).toBe("Build and maintain backend services.");
    expect(drive?.details.locations).toBe("Chennai, Tenkasi");
    expect(drive?.details.ctcBreakup).toBe("6.5 fixed + 2.5 variable");
    expect(drive?.details.mandatorySkills).toBe("TypeScript, SQL");
    expect(drive?.details.openings).toBe(25);
  });

  /** F7: one interview process may cover several designations. */
  it("carries the other designations this one process covers", async () => {
    stub({ drives: [liveDrive({ additional_designations: ["Associate Engineer"] })] });

    expect((await view().openDrives())[0]?.details.designations).toEqual(["Associate Engineer"]);
  });

  /** Applying is a promise to attend all of them, so the student sees them. */
  it("lists the rounds in order", async () => {
    stub({
      drives: [
        liveDrive({
          drive_rounds: [
            { sequence: 2, name: "Technical interview" },
            { sequence: 1, name: "Aptitude test" },
          ],
        }),
      ],
    });

    expect((await view().openDrives())[0]?.details.rounds).toEqual([
      { sequence: 1, name: "Aptitude test" },
      { sequence: 2, name: "Technical interview" },
    ]);
  });

  it("says nothing rather than null when the drive left a field empty", async () => {
    stub({ drives: [liveDrive({ job_description: null, work_locations: null })] });

    const [drive] = await view().openDrives();

    expect(drive?.details.jobDescription).toBe("");
    expect(drive?.details.locations).toBe("");
    expect(drive?.details.designations).toEqual([]);
    expect(drive?.details.rounds).toEqual([]);
  });

  it("hands the drive resume to the apply repository", async () => {
    const apply = vi.fn();
    stub({ drives: [liveDrive()] });
    const resume = new File(["cv"], "zoho.pdf", { type: "application/pdf" });

    await view({ apply }).apply("d1", resume);

    expect(apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.any(Date),
      resume,
    );
  });
});
