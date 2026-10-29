import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseDrivesView } from "./drives-view";

/**
 * N7 — the lists the Drives area shows, assembled from live rows (approved
 * 2026-08-19; narrowed to future drives on 2026-10-29).
 *
 * The classification itself is `@domain/student-drive-lists`; these tests
 * prove the view feeds it honestly: applications joined to their rounds, the
 * ladder's R5 still hiding what it always hid, closed drives and concluded
 * applications kept off the page, and the student's own hold read out.
 */
const BASE = "https://project.supabase.co";

const NOW = new Date("2026-09-05T00:00:00Z");

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
  campuses: { name: "Test Engineering College", cities: { name: "Chennai" } },
  student_documents: [],
};

/** Live, window open — the To-apply shape. */
const openDrive = {
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
  work_locations: "Chennai, Bengaluru",
  drive_rounds: [
    { id: "r1", sequence: 1, name: "Aptitude" },
    { id: "r2", sequence: 2, name: "Interview" },
  ],
};

function stub(
  opts: {
    drives?: unknown[];
    applications?: unknown[];
    offers?: unknown[];
    participants?: unknown[];
    results?: unknown[];
    holds?: unknown[];
  } = {},
) {
  server.use(
    http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json(studentRow)),
    http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json(opts.drives ?? [openDrive])),
    http.get(`${BASE}/rest/v1/applications`, () => HttpResponse.json(opts.applications ?? [])),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
    http.get(`${BASE}/rest/v1/student_holds`, () => HttpResponse.json(opts.holds ?? [])),
    http.get(`${BASE}/rest/v1/round_participants`, () =>
      HttpResponse.json(opts.participants ?? []),
    ),
    http.get(`${BASE}/rest/v1/round_results`, () => HttpResponse.json(opts.results ?? [])),
    http.get(`${BASE}/rest/v1/attendance`, () => HttpResponse.json([])),
  );
}

const view = () =>
  createSupabaseDrivesView(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => "u1",
    () => NOW,
  );

describe("lists — future drives and applications still moving", () => {
  it("puts a live, open, unapplied drive under To apply, with its role area and locations", async () => {
    stub();
    const lists = await view().lists();

    expect(lists.toApply.map((d) => d.companyName)).toEqual(["Zoho"]);
    expect(lists.toApply[0]?.roleCategory).toBe("software_technical");
    expect(lists.inProgress).toEqual([]);
  });

  it("stops showing a drive whose window has closed", async () => {
    stub({
      drives: [
        { ...openDrive, status: "applications_closed", application_end: "2026-09-02T00:00:00Z" },
      ],
    });
    const lists = await view().lists();

    expect(lists.toApply).toEqual([]);
    expect(lists.inProgress).toEqual([]);
  });

  it("still hides what R5 hides — a drive they were never eligible for", async () => {
    stub({
      drives: [
        {
          ...openDrive,
          status: "applications_closed",
          application_end: "2026-09-02T00:00:00Z",
          min_overall_cgpa: 9.9,
        },
      ],
    });
    const lists = await view().lists();

    expect(lists.toApply).toEqual([]);
    expect(lists.inProgress).toEqual([]);
  });

  it("an application mid-rounds is In progress, wearing its current round", async () => {
    stub({
      drives: [{ ...openDrive, status: "in_rounds", application_end: "2026-09-02T00:00:00Z" }],
      applications: [{ id: "a1", drive_id: "d1", applied_at: "2026-09-01T12:00:00Z" }],
      participants: [{ round_id: "r1", application_id: "a1" }],
    });
    const lists = await view().lists();

    expect(lists.inProgress).toEqual([
      expect.objectContaining({
        id: "d1",
        companyName: "Zoho",
        progressLabel: "Round 1 of 2 — Aptitude",
      }),
    ]);
  });

  /**
   * The outcome is still the student's to read — on the dashboard's "My
   * applications", which carries every application and its stage. This page
   * is for doors still open, and a rejection is not one.
   */
  it("leaves a concluded application off the page, even while the drive runs on", async () => {
    stub({
      drives: [{ ...openDrive, status: "in_rounds", application_end: "2026-09-02T00:00:00Z" }],
      applications: [{ id: "a1", drive_id: "d1", applied_at: "2026-09-01T12:00:00Z" }],
      participants: [{ round_id: "r1", application_id: "a1" }],
      results: [{ round_id: "r1", application_id: "a1", result: "rejected" }],
    });
    const lists = await view().lists();

    expect(lists.inProgress).toEqual([]);
    expect(lists.toApply).toEqual([]);
  });

  it("leaves a completed drive off the page even when it carried an offer", async () => {
    stub({
      drives: [{ ...openDrive, status: "completed", application_end: "2026-09-02T00:00:00Z" }],
      applications: [{ id: "a1", drive_id: "d1", applied_at: "2026-09-01T12:00:00Z" }],
      offers: [
        {
          id: "o1",
          drive_id: "d1",
          drive_type: "placement",
          offer_category: "dream",
          ctc_lpa: 8,
          declared_at: "2026-09-04T00:00:00Z",
          source: "on_campus",
        },
      ],
    });
    const lists = await view().lists();

    expect(lists.inProgress).toEqual([]);
    expect(lists.toApply).toEqual([]);
  });

  /** Q2 (UAT 2026-08-21): the banner's honesty about the internship cap. */
  it("reports the rung held AND whether the internship allowance is used", async () => {
    stub({
      offers: [
        {
          id: "o1",
          drive_id: "d9",
          drive_type: "internship_convertible",
          offer_category: "regular",
          ctc_lpa: 5,
          declared_at: "2026-09-01T00:00:00Z",
          source: "on_campus",
        },
      ],
    });
    const lists = await view().lists();

    expect(lists.placedAt).toBe("regular");
    expect(lists.internshipCapConsumed).toBe(true);
  });

  it("reports the allowance untouched for a student with no internship offer", async () => {
    stub({
      offers: [
        {
          id: "o1",
          drive_id: "d9",
          drive_type: "placement",
          offer_category: "regular",
          ctc_lpa: 5,
          declared_at: "2026-09-01T00:00:00Z",
          source: "on_campus",
        },
      ],
    });
    const lists = await view().lists();

    expect(lists.placedAt).toBe("regular");
    expect(lists.internshipCapConsumed).toBe(false);
  });

  it("an applied drive is In progress even when the student is no longer 'eligible' — history is not re-judged", async () => {
    stub({
      drives: [
        {
          ...openDrive,
          status: "in_rounds",
          application_end: "2026-09-02T00:00:00Z",
          min_overall_cgpa: 9.9,
        },
      ],
      applications: [{ id: "a1", drive_id: "d1", applied_at: "2026-09-01T12:00:00Z" }],
    });
    const lists = await view().lists();

    expect(lists.inProgress).toEqual([
      expect.objectContaining({ id: "d1", progressLabel: "Applied — awaiting shortlist" }),
    ]);
  });
});

/**
 * 0125/0130: the student reads their own unreleased hold row. A pending
 * self-placed request is the same row with `confirmed_at` still null, so the
 * screen can tell "held" from "waiting" without a second read.
 */
describe("the student's own hold", () => {
  const heldRow = {
    kind: "fees",
    reason: "Two semesters of fees unpaid.",
    starts_at: "2026-09-01",
    ends_at: "2026-12-15",
    confirmed_at: "2026-09-01T10:00:00Z",
  };

  it("carries the kind, reason and window of a live hold", async () => {
    stub({ holds: [heldRow] });

    expect((await view().lists()).hold).toEqual({
      kind: "fees",
      reason: "Two semesters of fees unpaid.",
      startsAt: "2026-09-01",
      endsAt: "2026-12-15",
      confirmedAt: "2026-09-01T10:00:00Z",
    });
  });

  it("carries a pending request with no confirmation yet", async () => {
    stub({ holds: [{ ...heldRow, kind: "self_placed", confirmed_at: null }] });

    expect((await view().lists()).hold?.confirmedAt).toBeNull();
  });

  it("says there is no hold when the student has none", async () => {
    stub();

    expect((await view().lists()).hold).toBeNull();
  });
});
