import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseAeOverviewView } from "./overview-view";

/**
 * Feeds the Account Executive's landing page.
 *
 * Their own drives come from `drives` — RLS returns only the ones they raised,
 * so this file never filters on `created_by`; a browser-side filter would be a
 * second, weaker copy of the rule the database enforces.
 *
 * The organisation's figures come from `placement_totals()` (0064) and NOT
 * from `students`, which an AE may not read at all. That is the whole of
 * option A: numbers, never records.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const TOTALS = {
  eligible: 598,
  placed: 231,
  self_placed: 17,
  opted_out: 9,
  completed_drives: 27,
  highest_lpa: "18.00",
  lowest_lpa: "3.60",
  average_lpa: "6.40",
  median_lpa: "5.50",
};

const DRIVE = {
  id: "d1",
  company_name: "Accenture",
  role_title: "Junior Analyst",
  status: "live",
  ctc_min_lpa: "4.00",
  ctc_max_lpa: "5.00",
  created_at: "2026-08-20T09:00:00Z",
  applications: [
    { id: "a1", shortlist_entries: [{ included: true }] },
    { id: "a2", shortlist_entries: [] },
  ],
};

function stub(opts: { drives?: unknown[]; offers?: unknown[]; totals?: unknown } = {}) {
  const calls: string[] = [];
  server.use(
    http.get(`${BASE}/rest/v1/drives`, ({ request }) => {
      calls.push(new URL(request.url).pathname);
      return HttpResponse.json(opts.drives ?? [DRIVE]);
    }),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
    http.post(`${BASE}/rest/v1/rpc/placement_totals`, () => {
      calls.push("/rest/v1/rpc/placement_totals");
      return HttpResponse.json(opts.totals ?? [TOTALS]);
    }),
  );
  return calls;
}

const view = () => createSupabaseAeOverviewView(client());

describe("createSupabaseAeOverviewView", () => {
  it("reads the AE's own drives, with their applicants and shortlist marks", async () => {
    stub();

    const snapshot = await view().snapshot();

    expect(snapshot.drives).toHaveLength(1);
    expect(snapshot.drives[0]?.companyName).toBe("Accenture");
    expect(snapshot.drives[0]?.applicants).toEqual([
      { shortlisted: true, hasOffer: false },
      { shortlisted: false, hasOffer: false },
    ]);
  });

  it("marks the applicant who holds an offer on that drive", async () => {
    stub({
      offers: [{ drive_id: "d1", student_id: "s1" }],
      drives: [
        {
          ...DRIVE,
          applications: [
            { id: "a1", student_id: "s1", shortlist_entries: [{ included: true }] },
            { id: "a2", student_id: "s2", shortlist_entries: [] },
          ],
        },
      ],
    });

    const snapshot = await view().snapshot();

    expect(snapshot.drives[0]?.applicants).toEqual([
      { shortlisted: true, hasOffer: true },
      { shortlisted: false, hasOffer: false },
    ]);
  });

  it("numbers arrive as numbers, whatever PostgREST calls them", async () => {
    stub();

    const { totals, drives } = await view().snapshot();

    expect(totals.eligible).toBe(598);
    expect(totals.placed).toBe(231);
    expect(totals.selfPlaced).toBe(17);
    expect(totals.optedOut).toBe(9);
    expect(totals.completedDrives).toBe(27);
    expect(totals.highestLpa).toBe(18);
    expect(totals.medianLpa).toBe(5.5);
    expect(drives[0]?.ctcMinLpa).toBe(4);
  });

  /** The point of option A: the org figures come from the aggregate, not the roster. */
  it("never reads the student roster", async () => {
    const studentReads: string[] = [];
    const calls = stub();
    server.use(
      http.get(`${BASE}/rest/v1/students`, () => {
        studentReads.push("students");
        return HttpResponse.json([]);
      }),
    );

    await view().snapshot();

    expect(studentReads).toEqual([]);
    expect(calls).toContain("/rest/v1/rpc/placement_totals");
  });

  it("reports no packages rather than zero when nobody is placed", async () => {
    stub({
      totals: [
        {
          ...TOTALS,
          placed: 0,
          highest_lpa: null,
          lowest_lpa: null,
          average_lpa: null,
          median_lpa: null,
        },
      ],
    });

    const { totals } = await view().snapshot();

    expect(totals.highestLpa).toBeNull();
    expect(totals.averageLpa).toBeNull();
  });

  it("survives an AE who has raised nothing", async () => {
    stub({ drives: [] });

    const snapshot = await view().snapshot();

    expect(snapshot.drives).toEqual([]);
    expect(snapshot.totals.eligible).toBe(598);
  });

  /** A refused or missing aggregate must not read as an organisation with no students. */
  it("throws rather than reporting zeroes when the totals cannot be read", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json([DRIVE])),
      http.post(
        `${BASE}/rest/v1/rpc/placement_totals`,
        () => new HttpResponse(null, { status: 403 }),
      ),
    );

    await expect(view().snapshot()).rejects.toThrow(/placement/i);
  });
});
