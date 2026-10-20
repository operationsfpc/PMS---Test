import { PostgrestReadError } from "@lib/postgrest-read";
import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabasePortfolioView, PORTFOLIO_DRIVE_COLUMNS } from "./portfolio-view";

/**
 * The owner's view of their drives, from live rows.
 *
 * Which drives come back at all is RLS's decision - an AE is returned only the
 * drives they raised - so this file is about the shape, not the scope: the
 * applicant list is read from `profile_snapshot`, the frozen copy taken at
 * apply time, never from the live student row. That is both the immutability
 * rule (PRD §7.3) and the only way an AE, who cannot read `students`, can see
 * who applied at all.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const DRIVE = {
  id: "d1",
  application_start: "2026-09-01T00:00:00Z",
  application_end: "2026-09-10T00:00:00Z",
  company_name: "Zoho Corporation",
  role_title: "Member Technical Staff",
  status: "in_rounds",
  on_hold: false,
  created_by: "ae-1",
  approved_by: "dh-1",
  published_by: "cpc-1",
  // Only the round list is embedded; its three satellites are their own reads.
  drive_rounds: [
    { id: "r1", sequence: 1, name: "Online test" },
    { id: "r2", sequence: 2, name: "Technical interview" },
  ],
};

const APPLICATION = {
  id: "app-1",
  drive_id: "d1",
  student_id: "s1",
  profile_snapshot: {
    profile: { fullName: "Anjali Subramanian", rollNumber: "21CSE1042" },
  },
  students: { campuses: { name: "Alliance University" } },
  shortlist_entries: [{ included: true }],
};

/** r1 is the round this applicant was called to, sat and was selected in. */
const ROUND_FACTS = {
  participants: [{ round_id: "r1", application_id: "app-1" }],
  results: [{ round_id: "r1", application_id: "app-1", result: "selected" }],
  attendance: [{ round_id: "r1", application_id: "app-1", status: "present" }],
};

interface Stubbed {
  readonly drives?: unknown[];
  readonly applications?: unknown[];
  readonly offers?: unknown[];
  readonly participants?: unknown[];
  readonly results?: unknown[];
  readonly attendance?: unknown[];
}

function stub(opts: Stubbed = {}) {
  const drivesQueries: string[] = [];
  const offersQueries: string[] = [];

  server.use(
    http.get(`${BASE}/rest/v1/drives`, ({ request }) => {
      drivesQueries.push(new URL(request.url).search);
      return HttpResponse.json(opts.drives ?? [DRIVE]);
    }),
    http.get(`${BASE}/rest/v1/applications`, () =>
      HttpResponse.json(opts.applications ?? [APPLICATION]),
    ),
    http.get(`${BASE}/rest/v1/offers`, ({ request }) => {
      offersQueries.push(new URL(request.url).search);
      return HttpResponse.json(opts.offers ?? []);
    }),
    http.get(`${BASE}/rest/v1/round_participants`, () =>
      HttpResponse.json(opts.participants ?? ROUND_FACTS.participants),
    ),
    http.get(`${BASE}/rest/v1/round_results`, () =>
      HttpResponse.json(opts.results ?? ROUND_FACTS.results),
    ),
    http.get(`${BASE}/rest/v1/attendance`, () =>
      HttpResponse.json(opts.attendance ?? ROUND_FACTS.attendance),
    ),
  );

  return { drivesQueries, offersQueries };
}

/** A handler that answers one page of `all`, the way PostgREST does. */
const paged =
  (all: unknown[]) =>
  ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "1000");
    return HttpResponse.json(all.slice(offset, offset + limit));
  };

const view = () => createSupabasePortfolioView(client());

describe("createSupabasePortfolioView", () => {
  it("carries the ownership through, so the screen can say whose drive it is", async () => {
    stub();
    const [drive] = await view().drives();

    expect(drive?.createdBy).toBe("ae-1");
    expect(drive?.approvedBy).toBe("dh-1");
    expect(drive?.publishedBy).toBe("cpc-1");
  });

  it("counts a round as decided only once a result has been declared in it", async () => {
    stub();
    const [drive] = await view().drives();

    expect(drive?.totalRounds).toBe(2);
    expect(drive?.roundsDecided).toBe(1);
  });

  it("names applicants from the frozen snapshot, not the live student row", async () => {
    stub();
    const [drive] = await view().drives();

    expect(drive?.applicants[0]?.studentName).toBe("Anjali Subramanian");
    expect(drive?.applicants[0]?.rollNumber).toBe("21CSE1042");
    expect(drive?.applicants[0]?.campus).toBe("Alliance University");
  });

  /** #39: the list says who, and each name has to reach that person's record. */
  it("carries each applicant's student id through to the screen", async () => {
    stub();
    const [drive] = await view().drives();

    expect(drive?.applicants[0]?.studentId).toBe("s1");
  });

  it("still shows an applicant whose campus it is not allowed to read", async () => {
    stub({ applications: [{ ...APPLICATION, students: null }] });
    const [drive] = await view().drives();

    expect(drive?.applicants[0]?.studentName).toBe("Anjali Subramanian");
    expect(drive?.applicants[0]?.campus).toBe("—");
  });

  it("attaches each applicant's rounds, marking the ones that named them", async () => {
    stub();
    const rounds = (await view().drives())[0]?.applicants[0]?.rounds;

    expect(rounds).toEqual([
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

  it("reads whether a coordinator included the applicant in the recruiter list", async () => {
    stub();
    expect((await view().drives())[0]?.applicants[0]?.shortlisted).toBe(true);
  });

  it("treats a shortlist it cannot read as not shortlisted, never as included", async () => {
    stub({ applications: [{ ...APPLICATION, shortlist_entries: [] }] });

    expect((await view().drives())[0]?.applicants[0]?.shortlisted).toBe(false);
  });

  it("marks the applicants who ended with an offer from this drive", async () => {
    stub({ offers: [{ drive_id: "d1", student_id: "s1" }] });
    const [drive] = await view().drives();

    expect(drive?.applicants[0]?.hasOffer).toBe(true);
  });

  it("does not credit this drive with an offer that came from another", async () => {
    stub({ offers: [{ drive_id: "elsewhere", student_id: "s1" }] });

    expect((await view().drives())[0]?.applicants[0]?.hasOffer).toBe(false);
  });

  it("carries the application window so the owner can see the time left", async () => {
    stub();
    const [drive] = await view().drives();

    expect(drive?.applicationStart).toBe("2026-09-01T00:00:00Z");
    expect(drive?.applicationEnd).toBe("2026-09-10T00:00:00Z");
  });

  it("reports an unpublished drive's window as unset rather than guessing one", async () => {
    stub({ drives: [{ ...DRIVE, application_start: null, application_end: null }] });
    const [drive] = await view().drives();

    expect(drive?.applicationStart).toBeNull();
    expect(drive?.applicationEnd).toBeNull();
  });

  it("survives a drive with no rounds and no applicants", async () => {
    stub({
      drives: [{ ...DRIVE, id: "d2", drive_rounds: [], role_title: null }],
      applications: [],
    });
    const [drive] = await view().drives();

    expect(drive?.totalRounds).toBe(0);
    expect(drive?.applicants).toEqual([]);
    expect(drive?.roleTitle).toBe("Role not specified");
  });

  it("returns nothing when RLS returns nothing, rather than failing", async () => {
    stub({ drives: [] });
    expect(await view().drives()).toEqual([]);
  });

  it("does not ask any satellite table when the portfolio has no rounds", async () => {
    let asked = false;
    stub({ drives: [{ ...DRIVE, drive_rounds: [] }] });
    server.use(
      http.get(`${BASE}/rest/v1/round_participants`, () => {
        asked = true;
        return HttpResponse.json([]);
      }),
    );

    await view().drives();

    expect(asked).toBe(false);
  });
});

/**
 * 2026-08-26: the portfolio sorts by when the drive was raised, so it has to
 * carry that date. The query already ordered by `created_at` and then threw
 * the column away, which meant the page could not offer an order of its own.
 */
describe("createSupabasePortfolioView — the raised date", () => {
  it("carries created_at through to the drive", async () => {
    stub({ drives: [{ ...DRIVE, created_at: "2026-08-10T09:00:00Z" }] });

    const [drive] = await view().drives();

    expect(drive?.createdAt).toBe("2026-08-10T09:00:00Z");
  });

  it("says null rather than inventing a date it was not given", async () => {
    stub({ drives: [{ ...DRIVE, created_at: null }] });

    const [drive] = await view().drives();

    expect(drive?.createdAt).toBeNull();
  });
});

/**
 * 2026-08-27: the list filters and tags by drive type, so the view has to
 * fetch it. It did not before — the column was simply absent from the select.
 */
describe("createSupabasePortfolioView — the drive type", () => {
  it("carries the type through to the screen", async () => {
    stub({ drives: [{ ...DRIVE, drive_type: "internship" }] });

    const [drive] = await view().drives();

    expect(drive?.driveType).toBe("internship");
  });

  it("asks the database for the column, rather than inventing a default", () => {
    expect(PORTFOLIO_DRIVE_COLUMNS).toMatch(/\bdrive_type\b/);
  });

  it("reports a drive that never declared one as null, never as a guess", async () => {
    stub({ drives: [{ ...DRIVE, drive_type: null }] });

    const [drive] = await view().drives();

    expect(drive?.driveType).toBeNull();
  });
});

/**
 * 2026-10-19: the portfolio was ONE unpaged query with everything embedded
 * under it. Past a thousand rows the read answered with the first thousand,
 * and every `in(...)` list built from those rows — offers, participants — was
 * one URL long enough for the gateway to refuse, which came back as an empty
 * list, not an error. A refused read and an owner with nothing both looked
 * like the same quiet portfolio.
 */
describe("reading a portfolio bigger than one page", () => {
  const manyDrives = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ ...DRIVE, id: `d${i}`, drive_rounds: [] }));

  it("asks for the drives a page at a time rather than trusting the 1000-row cap", async () => {
    const { drivesQueries } = stub();

    await view().drives();

    expect(drivesQueries[0]).toContain("offset=0&limit=1000");
  });

  it("walks every page instead of stopping at the first thousand", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drives`, paged(manyDrives(1400))),
      http.get(`${BASE}/rest/v1/applications`, paged([])),
      http.get(`${BASE}/rest/v1/offers`, paged([])),
    );

    const drives = await view().drives();

    expect(drives).toHaveLength(1400);
  });

  it("splits the offers filter into batches the gateway will answer", async () => {
    const offersQueries: string[] = [];
    const answer = paged([]);
    server.use(
      http.get(`${BASE}/rest/v1/drives`, paged(manyDrives(450))),
      http.get(`${BASE}/rest/v1/applications`, answer),
      http.get(`${BASE}/rest/v1/offers`, (context) => {
        offersQueries.push(new URL(context.request.url).search);
        return answer(context);
      }),
    );

    await view().drives();

    // 450 ids never go into one URL: 3 batches of at most 200.
    expect(offersQueries).toHaveLength(3);
  });

  it("throws rather than showing an empty portfolio it could not read", async () => {
    stub();
    server.use(
      http.get(`${BASE}/rest/v1/drives`, () =>
        HttpResponse.json({ message: "permission denied" }, { status: 401 }),
      ),
    );

    await expect(view().drives()).rejects.toThrow(PostgrestReadError);
  });
});
