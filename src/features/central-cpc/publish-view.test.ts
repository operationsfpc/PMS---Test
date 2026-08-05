import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabasePublishView } from "./publish-view";

/**
 * Feeds the publish screen, and takes the drive live.
 *
 * This is the most consequential write in the application: publishing is the
 * moment a drive becomes visible to students, and the targeting decides WHICH
 * students. Two orderings therefore matter and are asserted here — targeting
 * and rounds are persisted BEFORE the status flips, and the link tables are
 * replaced rather than merged, so what the coordinator sees on screen is
 * exactly what ends up stored.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const DRIVE = {
  id: "d1",
  company_name: "Zoho Corporation",
  role_title: "Member Technical Staff",
  role_category: "software_technical",
  job_description: "Build things",
  work_locations: "Chennai",
  status: "approved",
  drive_type: "placement",
  offer_category: "super_dream",
  ctc_min_lpa: 6.5,
  ctc_max_lpa: 9,
  application_start: "2026-09-01T04:30:00Z",
  application_end: "2026-09-10T04:30:00Z",
  on_hold: false,
  min_overall_cgpa: 7,
  arrears_policy: "flexible",
  drive_rounds: [
    { id: "r2", sequence: 2, name: "Technical interview" },
    { id: "r1", sequence: 1, name: "Online test" },
  ],
};

const STUDENT = {
  id: "s1",
  full_name: "Anjali Subramanian",
  srf_status: "srf_approved",
  participation_status: "active",
  passing_year: 2026,
  overall_cgpa: 8.4,
  tenth_percentage: 91,
  twelfth_percentage: 88,
  current_arrears: 0,
  history_of_arrears: 0,
  degrees: { name: "B.E" },
  branches: { name: "CSE" },
  campuses: { name: "Alliance University", cities: { name: "Chennai" } },
  offers: [],
};

interface Call {
  readonly table: string;
  readonly method: string;
  readonly body: unknown;
  readonly search: string;
}

function stub(
  opts: {
    drive?: Record<string, unknown> | null;
    driveFails?: boolean;
    students?: unknown[];
    updateFails?: { code?: string; message?: string };
    roundInsertFails?: boolean;
  } = {},
) {
  const calls: Call[] = [];

  const record = async (table: string, request: Request) => {
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    calls.push({ table, method: request.method, body, search: new URL(request.url).search });
  };

  const lookup = (rows: { id: string; name: string }[]) =>
    http.get(`${BASE}/rest/v1/${rows[0]?.name === "" ? "" : ""}`, () => HttpResponse.json(rows));
  void lookup;

  server.use(
    http.get(`${BASE}/rest/v1/drives`, () =>
      opts.driveFails === true
        ? new HttpResponse(null, { status: 406 })
        : HttpResponse.json(opts.drive === undefined ? DRIVE : opts.drive),
    ),
    http.get(`${BASE}/rest/v1/cities`, () =>
      HttpResponse.json([{ name: "Chennai" }, { name: "Chennai" }, { name: "Bengaluru" }]),
    ),
    http.get(`${BASE}/rest/v1/campuses`, ({ request }) => {
      const url = new URL(request.url);
      // The publish write looks campuses up by name to get their ids.
      if (url.searchParams.get("select") === "id,name") {
        return HttpResponse.json([{ id: "c1", name: "Alliance University" }]);
      }
      return HttpResponse.json([{ name: "Alliance University" }]);
    }),
    http.get(`${BASE}/rest/v1/degrees`, ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("select") === "id,name") {
        return HttpResponse.json([{ id: "dg1", name: "B.E" }]);
      }
      return HttpResponse.json([{ name: "B.E" }]);
    }),
    http.get(`${BASE}/rest/v1/branches`, ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("select") === "id,name") {
        return HttpResponse.json([{ id: "br1", name: "CSE" }]);
      }
      return HttpResponse.json([{ name: "CSE" }]);
    }),
    http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json(opts.students ?? [STUDENT])),

    http.patch(`${BASE}/rest/v1/drives`, async ({ request }) => {
      await record("drives", request);
      if (opts.updateFails !== undefined) {
        return HttpResponse.json(
          { code: opts.updateFails.code ?? "400", message: opts.updateFails.message ?? "nope" },
          { status: 400 },
        );
      }
      return HttpResponse.json({ id: "d1" });
    }),
    ...["drive_target_campuses", "drive_eligible_degrees", "drive_eligible_branches"].map((table) =>
      http.all(`${BASE}/rest/v1/${table}`, async ({ request }) => {
        await record(table, request);
        return HttpResponse.json([]);
      }),
    ),
    http.all(`${BASE}/rest/v1/drive_rounds`, async ({ request }) => {
      await record("drive_rounds", request);
      return opts.roundInsertFails === true && request.method === "POST"
        ? HttpResponse.json({ code: "23505", message: "duplicate sequence" }, { status: 400 })
        : HttpResponse.json([]);
    }),
  );

  return calls;
}

const view = () => createSupabasePublishView(client(), "d1", async () => "cpc-1");

const INPUT = {
  driveId: "d1",
  cities: [] as string[],
  campuses: ["Alliance University"],
  degrees: ["B.E"],
  branches: ["CSE"],
  minOverallCgpa: 7,
  arrearPolicy: "flexible" as const,
  openToAllOverride: false,
  overrideReason: null,
  applicationStart: "2026-09-01T10:00",
  applicationEnd: "2026-09-10T10:00",
  rounds: [
    { sequence: 1, name: "Online test" },
    { sequence: 2, name: "Technical interview" },
  ],
};

describe("loading the publish screen", () => {
  it("builds the subtitle from what is actually set, humanised", async () => {
    stub();

    expect((await view().load()).drive.subtitle).toBe(
      "Member Technical Staff · super dream · ₹6.5–9 LPA · placement",
    );
  });

  it("quotes a single CTC figure without a dash", async () => {
    stub({ drive: { ...DRIVE, ctc_max_lpa: null } });

    expect((await view().load()).drive.subtitle).toContain("₹6.5 LPA");
  });

  it("omits the CTC entirely when the drive quotes none", async () => {
    stub({ drive: { ...DRIVE, ctc_min_lpa: null, ctc_max_lpa: null } });

    expect((await view().load()).drive.subtitle).not.toContain("₹");
  });

  it("puts the rounds in sequence order", async () => {
    stub();

    expect((await view().load()).drive.rounds.map((r) => r.name)).toEqual([
      "Online test",
      "Technical interview",
    ]);
  });

  it("reads an unset application window as unset, not as the epoch", async () => {
    stub({ drive: { ...DRIVE, application_start: null, application_end: null } });
    const { drive } = await view().load();

    expect(drive.applicationStart).toBeNull();
    expect(drive.applicationEnd).toBeNull();
  });

  it("keeps the screen usable when the drive is barely filled in", async () => {
    stub({ drive: { id: "d1" } });
    const { drive } = await view().load();

    expect(drive.companyName).toBe("Unnamed drive");
    expect(drive.status).toBe("draft");
    expect(drive.locations).toEqual([]);
    expect(drive.jobDescription).toBe("");
    expect(drive.rounds).toEqual([]);
  });

  it("treats a blank work location as no location, not as one empty chip", async () => {
    stub({ drive: { ...DRIVE, work_locations: "" } });

    expect((await view().load()).drive.locations).toEqual([]);
  });

  it("offers each targeting option once, however many rows mention it", async () => {
    stub();

    expect((await view().load()).options.cities).toEqual(["Chennai", "Bengaluru"]);
  });

  it("reads the cohort from the roster, with campus and city for R2", async () => {
    stub();
    const [candidate] = (await view().load()).cohort;

    expect(candidate?.name).toBe("Anjali Subramanian");
    expect(candidate?.academics.campus).toBe("Alliance University");
    expect(candidate?.academics.city).toBe("Chennai");
    expect(candidate?.academics.degree).toBe("B.E");
  });

  it("reads a student's existing offers, which is what R3 and R4 need", async () => {
    stub({
      students: [
        {
          ...STUDENT,
          offers: [
            {
              id: "o1",
              drive_id: "d0",
              drive_type: "placement",
              offer_category: "dream",
              ctc_lpa: "7.50",
              declared_at: "2026-06-01T00:00:00Z",
              source: "on_campus",
            },
          ],
        },
      ],
    });

    const [candidate] = (await view().load()).cohort;

    expect(candidate?.offers[0]?.ctcLpa).toBe(7.5);
    expect(candidate?.offers[0]?.declaredAt).toBeInstanceOf(Date);
  });

  it("survives a student whose academics are blank rather than dropping them", async () => {
    stub({
      students: [
        { id: "s2", full_name: "Sparse", srf_status: "registered", participation_status: "active" },
      ],
    });

    const [candidate] = (await view().load()).cohort;

    expect(candidate?.academics.overallCgpa).toBe(0);
    expect(candidate?.academics.campus).toBe("");
    expect(candidate?.offers).toEqual([]);
  });

  it("says so plainly when the drive cannot be loaded at all", async () => {
    stub({ driveFails: true });

    await expect(view().load()).rejects.toThrow(/could not load this drive/i);
  });
});

describe("publishing", () => {
  it("saves the targeting before anything makes the drive visible", async () => {
    const calls = stub();

    await view().publish(INPUT);

    const tables = calls.map((c) => `${c.method} ${c.table}`);
    // The status flip is the repository's own PATCH, and it comes last.
    expect(tables.filter((t) => t.startsWith("PATCH drives"))).toHaveLength(2);
    expect(tables.indexOf("PATCH drives")).toBeLessThan(tables.lastIndexOf("PATCH drives"));
    expect(tables.lastIndexOf("PATCH drives")).toBe(tables.length - 1);
  });

  it("replaces the targeting rather than merging it", async () => {
    const calls = stub();

    await view().publish(INPUT);

    for (const table of [
      "drive_target_campuses",
      "drive_eligible_degrees",
      "drive_eligible_branches",
    ]) {
      const forTable = calls.filter((c) => c.table === table);
      expect(forTable[0]?.method).toBe("DELETE");
      expect(forTable[1]?.method).toBe("POST");
    }
  });

  it("resolves the names the coordinator picked to the ids the link tables want", async () => {
    const calls = stub();

    await view().publish(INPUT);

    expect(
      calls.find((c) => c.table === "drive_target_campuses" && c.method === "POST")?.body,
    ).toEqual([{ drive_id: "d1", campus_id: "c1" }]);
    expect(
      calls.find((c) => c.table === "drive_eligible_degrees" && c.method === "POST")?.body,
    ).toEqual([{ drive_id: "d1", degree_id: "dg1" }]);
  });

  it("writes no link rows at all when nothing was targeted", async () => {
    const calls = stub();

    await view().publish({ ...INPUT, campuses: [], degrees: [], branches: [] });

    expect(calls.filter((c) => c.table === "drive_target_campuses" && c.method === "POST")).toEqual(
      [],
    );
  });

  it("replaces the rounds wholesale, because they are positional", async () => {
    const calls = stub();

    await view().publish(INPUT);

    const rounds = calls.filter((c) => c.table === "drive_rounds");
    expect(rounds[0]?.method).toBe("DELETE");
    expect(rounds[1]?.body).toEqual([
      { drive_id: "d1", sequence: 1, name: "Online test" },
      { drive_id: "d1", sequence: 2, name: "Technical interview" },
    ]);
  });

  it("deletes the old rounds even when none are being set", async () => {
    const calls = stub();

    await view().publish({ ...INPUT, rounds: [] });

    const rounds = calls.filter((c) => c.table === "drive_rounds");
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.method).toBe("DELETE");
  });

  /**
   * `datetime-local` is wall-clock in the coordinator's browser (Asia/Kolkata),
   * so what must round-trip is the INSTANT, never a literal string.
   */
  it("stores the application window as the instant the coordinator meant", async () => {
    const calls = stub();

    await view().publish(INPUT);

    const body = calls[0]?.body as Record<string, string>;
    expect(new Date(body.application_start as string).getTime()).toBe(
      new Date("2026-09-01T10:00").getTime(),
    );
  });

  it("stores an omitted window as null rather than as an invalid date", async () => {
    const calls = stub();

    await view().publish({ ...INPUT, applicationStart: "", applicationEnd: null });

    expect(calls[0]?.body).toMatchObject({ application_start: null, application_end: null });
  });

  it("explains a permission failure in the words of the person who hit it", async () => {
    stub({ updateFails: { code: "42501" } });

    await expect(view().publish(INPUT)).rejects.toThrow(/do not have permission/i);
  });

  it("passes any other failure through with its reason", async () => {
    stub({ updateFails: { code: "23514", message: "window_ascends violated" } });

    await expect(view().publish(INPUT)).rejects.toThrow(/window_ascends/);
  });

  it("does not publish when the rounds could not be saved", async () => {
    const calls = stub({ roundInsertFails: true });

    await expect(view().publish(INPUT)).rejects.toThrow(/could not save the rounds/i);
    // Only the targeting PATCH ran; the drive never went live.
    expect(calls.filter((c) => c.method === "PATCH" && c.table === "drives")).toHaveLength(1);
  });
});

/**
 * F11 (UAT 2026-08-06): "Account Executive we should collect the number of
 * rounds for the drive and should reflect in the Central placement coordinator
 * login where they are trying to publish the drive, it should be automatically
 * fetched."
 *
 * The Central CPC was typing the round list from an email. The AE already knew
 * the number.
 */
describe("createSupabasePublishView — the rounds the AE declared", () => {
  it("reports the number of rounds the AE said the recruiter runs", async () => {
    stub({ drive: { id: "d1", company_name: "Zoho", round_count: 4, drive_rounds: [] } });

    expect((await view().load()).drive.declaredRoundCount).toBe(4);
  });

  it("says nothing when the AE never said, rather than guessing at one", async () => {
    stub({ drive: { id: "d1", company_name: "Zoho", drive_rounds: [] } });

    expect((await view().load()).drive.declaredRoundCount).toBeNull();
  });

  /**
   * Named rounds already configured are the coordinator's own work. Fetching
   * the count must never overwrite them.
   */
  it("keeps rounds that already exist, whatever the declared count says", async () => {
    stub({
      drive: {
        id: "d1",
        company_name: "Zoho",
        round_count: 4,
        drive_rounds: [{ id: "r1", sequence: 1, name: "Aptitude" }],
      },
    });

    const { drive } = await view().load();

    expect(drive.rounds).toEqual([{ sequence: 1, name: "Aptitude" }]);
    expect(drive.declaredRoundCount).toBe(4);
  });
});
