import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseOfferView } from "./offer-view";

/**
 * Feeds the final-selection screen.
 *
 * The rule that matters here is *who may be declared*: the students `selected`
 * in the drive's LAST round. Not everyone who applied, and not everyone merely
 * un-rejected. Getting this list wrong declares an offer for someone who never
 * received one, and an offer is the placement record (R9) - it changes what
 * every other drive will show that student.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const DRIVE = {
  id: "d1",
  company_name: "Zoho Corporation",
  role_title: "Member Technical Staff",
  drive_type: "placement",
  offer_category: "dream",
  ctc_min_lpa: 6.5,
  ctc_max_lpa: 9,
};

const selected = (applicationId: string, studentId: string, name: string, roll: string) => ({
  application_id: applicationId,
  result: "selected",
  applications: { student_id: studentId, students: { full_name: name, roll_number: roll } },
});

function stub(
  opts: {
    drive?: Record<string, unknown>;
    rounds?: unknown[];
    results?: unknown[];
    offers?: unknown[];
  } = {},
) {
  const roundQueries: string[] = [];
  const roundLookups: string[] = [];

  server.use(
    http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json(opts.drive ?? DRIVE)),
    http.get(`${BASE}/rest/v1/drive_rounds`, ({ request }) => {
      roundLookups.push(new URL(request.url).search);
      return HttpResponse.json(opts.rounds ?? [{ id: "r3", sequence: 3 }]);
    }),
    http.get(`${BASE}/rest/v1/round_results`, ({ request }) => {
      roundQueries.push(new URL(request.url).search);
      return HttpResponse.json(opts.results ?? []);
    }),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
  );

  return { roundQueries, roundLookups };
}

const view = () =>
  createSupabaseOfferView(
    client(),
    async () => "cpc-1",
    async () => "central_placement_coordinator",
  );

describe("the drive being declared against", () => {
  it("suggests the top of the CTC range, since that is what most offers land at (A16)", async () => {
    stub();

    expect((await view().drive("d1")).suggestedCtcLpa).toBe(9);
  });

  it("falls back to the minimum when a drive quotes a single figure", async () => {
    stub({ drive: { ...DRIVE, ctc_max_lpa: null } });

    expect((await view().drive("d1")).suggestedCtcLpa).toBe(6.5);
  });

  it("suggests zero rather than NaN when a drive quotes no CTC at all", async () => {
    stub({ drive: { ...DRIVE, ctc_min_lpa: null, ctc_max_lpa: null } });

    expect((await view().drive("d1")).suggestedCtcLpa).toBe(0);
  });

  it("keeps the screen usable when the drive record is thin", async () => {
    stub({ drive: {} });
    const drive = await view().drive("d1");

    expect(drive.companyName).toBe("This drive");
    expect(drive.roleTitle).toBeNull();
    // Never guess a category - it is the Delivery Head's and it is final.
    expect(drive.offerCategory).toBeNull();
    expect(drive.driveType).toBe("placement");
  });
});

describe("who may be declared", () => {
  /**
   * "Last round" is expressed as descending sequence + limit 1, so the query
   * itself is the assertion. Ascending would hand the screen round ONE - every
   * student who cleared the first filter - and declare offers for all of them.
   */
  it("asks only about the last round of the drive", async () => {
    const { roundQueries, roundLookups } = stub({ rounds: [{ id: "r3", sequence: 3 }] });

    await view().candidates("d1");

    expect(roundLookups[0]).toMatch(/order=sequence\.desc/);
    expect(roundLookups[0]).toMatch(/limit=1/);
    expect(roundQueries[0]).toMatch(/round_id=eq\.r3/);
    expect(roundQueries[0]).toMatch(/result=eq\.selected/);
  });

  it("returns nobody when the drive has no rounds, rather than everyone", async () => {
    stub({ rounds: [] });

    expect(await view().candidates("d1")).toEqual([]);
  });

  it("lists the selected students alphabetically", async () => {
    stub({
      results: [
        selected("a2", "s2", "Rahul Nair", "21CSE1099"),
        selected("a1", "s1", "Anjali Subramanian", "21CSE1042"),
      ],
    });

    expect((await view().candidates("d1")).map((c) => c.studentName)).toEqual([
      "Anjali Subramanian",
      "Rahul Nair",
    ]);
  });

  it("marks the candidates who already hold an offer, so nobody is declared twice", async () => {
    stub({
      results: [
        selected("a1", "s1", "Anjali Subramanian", "21CSE1042"),
        selected("a2", "s2", "Rahul Nair", "21CSE1099"),
      ],
      offers: [{ student_id: "s1" }],
    });

    const candidates = await view().candidates("d1");

    expect(candidates[0]?.declared).toBe(true);
    expect(candidates[1]?.declared).toBe(false);
  });

  it("does not mark a candidate declared because someone else was", async () => {
    stub({
      results: [selected("a1", "s1", "Anjali Subramanian", "21CSE1042")],
      offers: [{ student_id: "someone-else" }],
    });

    expect((await view().candidates("d1"))[0]?.declared).toBe(false);
  });

  it("still shows a candidate whose student row did not come back", async () => {
    stub({ results: [{ application_id: "a1", result: "selected", applications: null }] });
    const [candidate] = await view().candidates("d1");

    expect(candidate?.studentName).toBe("Unknown student");
    expect(candidate?.rollNumber).toBe("—");
    expect(candidate?.studentId).toBe("");
  });
});
