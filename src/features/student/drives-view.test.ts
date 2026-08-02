import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
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

function stub(opts: { drives?: unknown[]; applications?: unknown[]; offers?: unknown[] } = {}) {
  server.use(
    http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json(studentRow)),
    http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json(opts.drives ?? [driveRow])),
    http.get(`${BASE}/rest/v1/applications`, () => HttpResponse.json(opts.applications ?? [])),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
  );
}

const view = () =>
  createSupabaseDrivesView(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => "u1",
    () => new Date("2026-09-05T00:00:00Z"),
  );

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
