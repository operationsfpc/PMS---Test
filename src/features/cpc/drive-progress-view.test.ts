import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseDriveProgressView } from "./drive-progress-view";

/**
 * The campus coordinator's full-cycle view (D10, 2026-08-12).
 *
 * No query here filters by campus: RLS does. What this file proves is the
 * ASSEMBLY — the right result against the right round for the right student,
 * because a progress screen that shuffles outcomes between students is worse
 * than none.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const view = () => createSupabaseDriveProgressView(client());

function stub(
  opts: {
    applications?: unknown[];
    rounds?: unknown[];
    attendance?: unknown[];
    results?: unknown[];
    offers?: unknown[];
  } = {},
) {
  server.use(
    http.get(`${BASE}/rest/v1/applications`, () => HttpResponse.json(opts.applications ?? [])),
    http.get(`${BASE}/rest/v1/drive_rounds`, () => HttpResponse.json(opts.rounds ?? [])),
    http.get(`${BASE}/rest/v1/attendance`, () => HttpResponse.json(opts.attendance ?? [])),
    http.get(`${BASE}/rest/v1/round_results`, () => HttpResponse.json(opts.results ?? [])),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
  );
}

const APPLICATION = {
  id: "a1",
  student_id: "s1",
  drive_id: "d1",
  students: { full_name: "Priya Ramesh", roll_number: "21CSE1042" },
  shortlist_entries: [{ included: true }],
  drives: { company_name: "Zoho", role_title: "Engineer", status: "in_rounds" },
};

describe("createSupabaseDriveProgressView", () => {
  it("assembles a student's rounds in sequence, each with its own result", async () => {
    stub({
      applications: [APPLICATION],
      rounds: [
        { id: "r2", drive_id: "d1", sequence: 2, name: "Technical" },
        { id: "r1", drive_id: "d1", sequence: 1, name: "Aptitude" },
      ],
      attendance: [
        { round_id: "r2", application_id: "a1", status: "scheduled" },
        { round_id: "r1", application_id: "a1", status: "present" },
      ],
      results: [{ round_id: "r1", application_id: "a1", result: "selected" }],
    });

    const drives = await view().drives();
    expect(drives).toHaveLength(1);
    expect(drives[0]?.companyName).toBe("Zoho");
    expect(drives[0]?.students[0]?.rounds).toEqual([
      { sequence: 1, name: "Aptitude", attendance: "present", result: "selected" },
      { sequence: 2, name: "Technical", attendance: "scheduled", result: null },
    ]);
  });

  it("never attributes one student's offer to another", async () => {
    stub({
      applications: [
        APPLICATION,
        { ...APPLICATION, id: "a2", student_id: "s2", students: { full_name: "Arjun Menon" } },
      ],
      offers: [{ student_id: "s2", drive_id: "d1", ctc_lpa: 8, offer_category: "dream" }],
    });

    const drives = await view().drives();
    const arjun = drives[0]?.students.find((s) => s.studentName === "Arjun Menon");
    const priya = drives[0]?.students.find((s) => s.studentName === "Priya Ramesh");
    expect(arjun?.offer).toEqual({ ctcLpa: 8, offerCategory: "dream" });
    expect(priya?.offer).toBeNull();
  });

  it("marks an undecided application as not shortlisted", async () => {
    stub({ applications: [{ ...APPLICATION, shortlist_entries: [] }] });

    const drives = await view().drives();
    expect(drives[0]?.students[0]?.shortlisted).toBe(false);
  });

  it("groups applications by drive", async () => {
    stub({
      applications: [
        APPLICATION,
        {
          ...APPLICATION,
          id: "a9",
          drive_id: "d2",
          drives: { company_name: "TCS", role_title: null, status: "live" },
        },
      ],
    });

    const drives = await view().drives();
    expect(drives.map((d) => d.companyName)).toEqual(["TCS", "Zoho"]);
  });

  it("returns nothing quietly when no application is visible", async () => {
    stub();
    expect(await view().drives()).toEqual([]);
  });
});
