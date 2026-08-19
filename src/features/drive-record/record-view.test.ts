import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseDriveRecordView } from "./record-view";

/**
 * N1 — the canonical drive record, assembled from live rows. The mapper is
 * where snake_case meets the page's contract; a blanket cast here is how
 * `driveType: undefined` shipped once before (0041), so every field the page
 * renders is proved to arrive.
 */
const BASE = "https://project.supabase.co";

const driveRow = {
  id: "d1",
  company_name: "Accenture",
  industry: "Technology",
  company_website: "https://accenture.com",
  role_title: "Jr. Software Engineer",
  additional_designations: ["Support Analyst"],
  role_category: "technical_support_it_ops",
  status: "live",
  drive_type: "internship_convertible",
  drive_mode: "on_campus",
  offer_category: "dream",
  openings: 10,
  ctc_min_lpa: 4,
  ctc_max_lpa: 6,
  ctc_breakup: "30000 + 5000",
  bond_details: "2 years",
  work_locations: "Bengaluru, Chennai",
  application_start: "2026-08-11T10:17:00Z",
  application_end: "2026-08-12T10:18:00Z",
  tentative_date: "2026-08-15",
  shift_type: "night",
  shift_night_timing: "9 PM – 6 AM",
  joining_timeline: "later",
  joining_immediate_notes: null,
  joining_later_notes: "September",
  timeline_notes: null,
  job_description: "IT Coding",
  jd_storage_path: "d1/jd-1.pdf",
  jd_file_name: "Accenture-JD.pdf",
  min_overall_cgpa: 7.5,
  min_overall_cgpa_scale: "cgpa",
  min_tenth_percentage: 70,
  min_twelfth_percentage: null,
  arrears_policy: "no_standing",
  eligible_passing_years: [2026, 2027],
  mandatory_skills: "Coding",
  spoc_name: "TESTABCD",
  spoc_designation: "Recruitment Head",
  spoc_email: "testabcd@example.com",
  spoc_phone: "9876543218",
  created_at: "2026-08-11T10:16:00Z",
  approved_at: "2026-08-11T10:18:00Z",
  published_at: "2026-08-11T10:18:16Z",
  raised_by: { full_name: "AE Test" },
  approver: { full_name: "DH Test" },
  publisher: { full_name: "Radhika" },
  drive_rounds: [
    { sequence: 2, name: "Interview" },
    { sequence: 1, name: "Aptitude" },
  ],
  drive_eligible_degrees: [{ degrees: { name: "B.E" } }],
  drive_eligible_branches: [{ branches: { name: "CSE" } }],
  drive_target_campuses: [{ campuses: { name: "KGiSL" } }],
};

const applicationRow = {
  id: "a1",
  applied_at: "2026-08-12T09:00:00Z",
  profile_snapshot: { academics: { overallCgpa: 7.5 } },
  students: { full_name: "Thanush", roll_number: "21CSE1042", campuses: { name: "KGiSL" } },
};

function stub(opts: { drive?: unknown; applications?: unknown[] } = {}) {
  server.use(
    http.get(`${BASE}/rest/v1/drives`, () =>
      HttpResponse.json(opts.drive === undefined ? driveRow : opts.drive),
    ),
    http.get(`${BASE}/rest/v1/applications`, () =>
      HttpResponse.json(opts.applications ?? [applicationRow]),
    ),
    http.post(`${BASE}/storage/v1/object/sign/job-descriptions/d1/jd-1.pdf`, () =>
      HttpResponse.json({ signedURL: "/signed/jd-1.pdf" }),
    ),
  );
}

const view = () =>
  createSupabaseDriveRecordView(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
  );

describe("createSupabaseDriveRecordView", () => {
  it("maps the whole record, field by field — described shift, joining, bands and rounds in order", async () => {
    stub();
    const record = await view().record("d1");

    expect(record).toMatchObject({
      id: "d1",
      companyName: "Accenture",
      roleTitle: "Jr. Software Engineer",
      additionalDesignations: ["Support Analyst"],
      status: "live",
      offerCategory: "dream",
      ctcLabel: "₹4–6 LPA",
      locations: "Bengaluru, Chennai",
      jobDescription: "IT Coding",
      jobDescriptionName: "Accenture-JD.pdf",
    });
    // Worded by the domain, not restated here.
    expect(record?.shift).toContain("9 PM – 6 AM");
    expect(record?.joining).toContain("September");
    expect(record?.eligibility).toMatchObject({
      cgpaLabel: "≥ 7.5 CGPA",
      tenthLabel: "≥ 70%",
      twelfthLabel: "None declared",
      arrearsLabel: "No standing arrears",
      passingYears: [2026, 2027],
      degrees: ["B.E"],
      branches: ["CSE"],
      campuses: ["KGiSL"],
    });
    expect(record?.rounds).toEqual([
      { sequence: 1, name: "Aptitude" },
      { sequence: 2, name: "Interview" },
    ]);
    expect(record?.recruiter.email).toBe("testabcd@example.com");
    expect(record?.provenance).toMatchObject({
      raisedBy: "AE Test",
      approvedBy: "DH Test",
      publishedBy: "Radhika",
    });
    expect(record?.applicants).toEqual([
      expect.objectContaining({
        applicationId: "a1",
        fullName: "Thanush",
        rollNumber: "21CSE1042",
        campus: "KGiSL",
        snapshot: { academics: { overallCgpa: 7.5 } },
      }),
    ]);
  });

  it("answers null for a drive RLS withholds — the page then says so", async () => {
    stub({ drive: null, applications: [] });
    expect(await view().record("dX")).toBeNull();
  });

  it("copes with a drive that declared almost nothing", async () => {
    stub({
      drive: {
        id: "d2",
        company_name: "Bare Minimum Ltd",
        status: "live",
        ctc_min_lpa: null,
        ctc_max_lpa: null,
        jd_storage_path: null,
      },
      applications: [],
    });
    const record = await view().record("d2");

    expect(record).toMatchObject({
      companyName: "Bare Minimum Ltd",
      ctcLabel: "Not stated",
      jobDescriptionUrl: null,
      applicants: [],
    });
    expect(record?.eligibility.cgpaLabel).toBe("None declared");
    expect(record?.provenance.raisedBy).toBeNull();
  });

  it("states a percentage cutoff on the scale it was declared on", async () => {
    stub({
      drive: { ...driveRow, min_overall_cgpa: 75, min_overall_cgpa_scale: "percentage" },
    });
    const record = await view().record("d1");
    expect(record?.eligibility.cgpaLabel).toBe("≥ 75%");
  });
});
