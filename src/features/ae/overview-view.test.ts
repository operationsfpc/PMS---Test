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
};

const APPLICATIONS = [
  { id: "a1", drive_id: "d1", student_id: "s1" },
  { id: "a2", drive_id: "d1", student_id: "s2" },
];

const SHORTLISTED = [{ application_id: "a1", included: true }];

interface StubOptions {
  readonly drives?: unknown[];
  readonly applications?: unknown[];
  readonly shortlistEntries?: unknown[];
  readonly offers?: unknown[];
  readonly totals?: unknown;
}

/**
 * What each read was asked for, so a test can say which query went out rather
 * than only what came back. `selects`/`ranges` take the table they were sent
 * against, because the page issues several reads at once.
 */
interface Stubbed {
  readonly calls: string[];
  readonly selects: (table: string) => string[];
  readonly ranges: (table: string) => string[];
}

function stub(opts: StubOptions = {}): Stubbed {
  const calls: string[] = [];
  const urls: string[] = [];
  const record = (request: Request) => {
    const url = new URL(request.url);
    calls.push(url.pathname);
    urls.push(request.url);
  };
  /**
   * Honour the `offset`/`limit` the page asked for. A stub that ignored them
   * would answer every page with the whole list, and `readAll` — which stops on
   * a short page — would loop until the test timed out instead of failing.
   */
  const page = (all: unknown[], request: Request) => {
    const params = new URL(request.url).searchParams;
    const from = Number(params.get("offset") ?? 0);
    const size = Number(params.get("limit") ?? all.length);
    return all.slice(from, from + size);
  };
  const rows = {
    drives: opts.drives ?? [DRIVE],
    applications: opts.applications ?? APPLICATIONS,
    shortlist: opts.shortlistEntries ?? SHORTLISTED,
    offers: opts.offers ?? [],
  };
  server.use(
    http.get(`${BASE}/rest/v1/drives`, ({ request }) => {
      record(request);
      return HttpResponse.json(page(rows.drives, request));
    }),
    // Since 2026-10-18 the applicants are their own paged query. Embedded, they
    // were capped at a thousand rows per drive and the AE's cards counted
    // whoever arrived first.
    http.get(`${BASE}/rest/v1/applications`, ({ request }) => {
      record(request);
      return HttpResponse.json(page(rows.applications, request));
    }),
    http.get(`${BASE}/rest/v1/shortlist_entries`, ({ request }) => {
      record(request);
      return HttpResponse.json(page(rows.shortlist, request));
    }),
    http.get(`${BASE}/rest/v1/offers`, ({ request }) => {
      record(request);
      return HttpResponse.json(page(rows.offers, request));
    }),
    http.post(`${BASE}/rest/v1/rpc/placement_totals`, () => {
      calls.push("/rest/v1/rpc/placement_totals");
      return HttpResponse.json(opts.totals ?? [TOTALS]);
    }),
  );
  const of = (table: string) => urls.filter((u) => new URL(u).pathname.endsWith(`/${table}`));
  return {
    calls,
    selects: (table) =>
      of(table).map((u) => decodeURIComponent(new URL(u).searchParams.get("select") ?? "")),
    ranges: (table) =>
      of(table).map((u) => {
        const params = new URL(u).searchParams;
        return `${params.get("offset")}-${params.get("limit")}`;
      }),
  };
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

  /**
   * The one column whose absence no schema test can catch: with the event id
   * missing the read still succeeds, and the page prints one company visit
   * twice (UAT 2026-10-16).
   */
  it("asks drives for their visit id and hands it to the page", async () => {
    const stubbed = stub({ drives: [{ ...DRIVE, company_drive_id: "e1" }] });

    const snapshot = await view().snapshot();

    expect(stubbed.selects("drives")[0]).toContain("company_drive_id");
    expect(snapshot.drives[0]?.companyDriveId).toBe("e1");
  });

  it("marks the applicant who holds an offer on that drive", async () => {
    stub({ offers: [{ drive_id: "d1", student_id: "s1" }] });

    const snapshot = await view().snapshot();

    expect(snapshot.drives[0]?.applicants).toEqual([
      { shortlisted: true, hasOffer: true },
      { shortlisted: false, hasOffer: false },
    ]);
  });

  /**
   * #34/#43, UAT 2026-10-18. Embedded, PostgREST answered the applications with
   * its own thousand-row cap per drive, so an AE reporting on a drive 1,000+
   * students applied to was shown a thousand of them — and a student shortlisted
   * past that line did not appear as shortlisted at all.
   */
  it("pages the applicants past a thousand rows", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({
      id: `a${i + 1}`,
      drive_id: "d1",
      student_id: `s${i + 1}`,
    }));
    const stubbed = stub({
      applications: many,
      shortlistEntries: [{ application_id: "a1001", included: true }],
    });

    const snapshot = await view().snapshot();

    expect(stubbed.ranges("applications")).toEqual(["0-1000", "1000-1000"]);
    expect(snapshot.drives[0]?.applicants).toHaveLength(1001);
    // The mark that the old embed could not reach.
    expect(snapshot.drives[0]?.applicants[1000]).toEqual({ shortlisted: true, hasOffer: false });
  });

  it("asks applications for the pair that ties an outcome to an applicant", async () => {
    const stubbed = stub();

    await view().snapshot();

    expect(stubbed.selects("applications")).toContain("id,drive_id,student_id");
    expect(stubbed.calls).toContain("/rest/v1/shortlist_entries");
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
    const stubbed = stub();
    server.use(
      http.get(`${BASE}/rest/v1/students`, () => {
        studentReads.push("students");
        return HttpResponse.json([]);
      }),
    );

    await view().snapshot();

    expect(studentReads).toEqual([]);
    expect(stubbed.calls).toContain("/rest/v1/rpc/placement_totals");
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
