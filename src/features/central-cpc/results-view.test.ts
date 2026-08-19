import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseResultsView } from "./results-view";

/**
 * Feeds the round-results screen.
 *
 * Participants come from `attendance`, not `applications`: those rows exist
 * only for the students the recruiter actually called (Q9). Listing applicants
 * instead would let a coordinator record a result for someone who was never
 * invited, silently enrolling them in a round they never sat.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const attendee = (applicationId: string, name: string, roll: string, status = "present") => ({
  application_id: applicationId,
  status,
  applications: { students: { full_name: name, roll_number: roll } },
});

function stub(opts: { attendance?: unknown[]; results?: unknown[]; recordFails?: boolean } = {}) {
  const writes: unknown[] = [];

  server.use(
    http.get(`${BASE}/rest/v1/attendance`, () => HttpResponse.json(opts.attendance ?? [])),
    http.get(`${BASE}/rest/v1/round_results`, () => HttpResponse.json(opts.results ?? [])),
    http.post(`${BASE}/rest/v1/round_results`, async ({ request }) => {
      writes.push(await request.clone().json());
      return opts.recordFails === true
        ? new HttpResponse(null, { status: 400 })
        : HttpResponse.json({ id: "rr-1" });
    }),
  );

  return writes;
}

const view = (role = "central_placement_coordinator", actorId: string | null = "cpc-1") =>
  createSupabaseResultsView(
    client(),
    async () => actorId,
    async () => role as "central_placement_coordinator",
  );

describe("who is on the results screen", () => {
  it("lists the students who were scheduled, alphabetically", async () => {
    stub({
      attendance: [
        attendee("a2", "Rahul Nair", "21CSE1099"),
        attendee("a1", "Anjali Subramanian", "21CSE1042"),
      ],
    });

    expect((await view().participants("r1")).map((p) => p.studentName)).toEqual([
      "Anjali Subramanian",
      "Rahul Nair",
    ]);
  });

  it("carries each student's attendance through, since an absentee still needs a result", async () => {
    stub({ attendance: [attendee("a1", "Anjali", "21CSE1042", "absent")] });

    expect((await view().participants("r1"))[0]?.attendance).toBe("absent");
  });

  it("shows the result already recorded against a participant", async () => {
    stub({
      attendance: [attendee("a1", "Anjali", "21CSE1042")],
      results: [{ application_id: "a1", result: "selected" }],
    });

    expect((await view().participants("r1"))[0]?.result).toBe("selected");
  });

  it("shows no result for someone who has not been decided yet", async () => {
    stub({ attendance: [attendee("a1", "Anjali", "21CSE1042")] });

    expect((await view().participants("r1"))[0]?.result).toBeNull();
  });

  it("never attributes one participant's result to another", async () => {
    stub({
      attendance: [attendee("a1", "Anjali", "21CSE1042")],
      results: [{ application_id: "someone-else", result: "rejected" }],
    });

    expect((await view().participants("r1"))[0]?.result).toBeNull();
  });

  it("still lists a participant whose student row did not come back", async () => {
    stub({ attendance: [{ application_id: "a1", status: "present", applications: null }] });
    const [participant] = await view().participants("r1");

    expect(participant?.studentName).toBe("Unknown student");
    expect(participant?.rollNumber).toBe("—");
  });

  it("shows an empty round as empty", async () => {
    stub();

    expect(await view().participants("r1")).toEqual([]);
  });
});

describe("recording a result", () => {
  it("writes the result against the round, the application and the coordinator", async () => {
    const writes = stub();

    await view().record("r1", "a1", "selected");

    expect(writes[0]).toMatchObject({
      round_id: "r1",
      application_id: "a1",
      result: "selected",
      declared_by: "cpc-1",
    });
  });

  /** Q10 and PRD §14: results are the Central CPC's alone. */
  it("refuses a campus coordinator", async () => {
    const writes = stub();

    await expect(
      view("campus_placement_coordinator").record("r1", "a1", "selected"),
    ).rejects.toThrow(/Central Placement Coordinator/i);
    expect(writes).toHaveLength(0);
  });

  it("refuses when the session has gone, rather than writing an unattributed result", async () => {
    stub();

    await expect(
      view("central_placement_coordinator", null).record("r1", "a1", "selected"),
    ).rejects.toThrow(/session/i);
  });
});

/** 2026-08-12 (WS6): the tabbed rounds screen and explicit advancement. */
describe("the drive's rounds", () => {
  it("lists them in sequence order", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drive_rounds`, () =>
        HttpResponse.json([
          { id: "r1", sequence: 1, name: "Aptitude" },
          { id: "r2", sequence: 2, name: "Technical" },
        ]),
      ),
    );

    const rounds = await view().rounds("d1");
    // F4 (UAT 2026-08-19): each round now carries its own details, null until set.
    const bare = { mode: null, scheduledAt: null, interviewLink: null };
    expect(rounds).toEqual([
      { roundId: "r1", sequence: 1, name: "Aptitude", ...bare },
      { roundId: "r2", sequence: 2, name: "Technical", ...bare },
    ]);
  });

  it("adds the next round with the next sequence number", async () => {
    const writes: unknown[] = [];
    server.use(
      http.get(`${BASE}/rest/v1/drive_rounds`, () =>
        HttpResponse.json([{ id: "r1", sequence: 1, name: "Aptitude" }]),
      ),
      http.post(`${BASE}/rest/v1/drive_rounds`, async ({ request }) => {
        writes.push(await request.clone().json());
        return HttpResponse.json({ id: "r2" });
      }),
    );

    await view().addRound("d1", "HR");

    expect(writes[0]).toMatchObject({ drive_id: "d1", sequence: 2, name: "HR" });
  });

  it("advances exactly the selected, and says how many", async () => {
    const scheduled: unknown[] = [];
    server.use(
      http.get(`${BASE}/rest/v1/round_results`, () =>
        HttpResponse.json([
          { application_id: "a1", result: "selected" },
          { application_id: "a2", result: "rejected" },
          { application_id: "a3", result: "waitlisted" },
        ]),
      ),
      http.post(`${BASE}/rest/v1/round_participants`, async ({ request }) => {
        scheduled.push(await request.clone().json());
        return HttpResponse.json([{ id: "rp-1" }]);
      }),
      http.post(`${BASE}/rest/v1/attendance`, async ({ request }) => {
        scheduled.push(await request.clone().json());
        return HttpResponse.json([{ id: "at-1" }]);
      }),
    );

    const moved = await view().advance("r1", "r2");

    expect(moved).toBe(1);
    const participants = scheduled[0] as Array<Record<string, unknown>>;
    expect(participants).toHaveLength(1);
    expect(participants[0]).toMatchObject({ round_id: "r2", application_id: "a1" });
  });

  it("advances nobody when nobody was selected, without writing", async () => {
    const scheduled: unknown[] = [];
    server.use(
      http.get(`${BASE}/rest/v1/round_results`, () =>
        HttpResponse.json([{ application_id: "a2", result: "rejected" }]),
      ),
      http.post(`${BASE}/rest/v1/round_participants`, async ({ request }) => {
        scheduled.push(await request.clone().json());
        return HttpResponse.json([{ id: "rp-1" }]);
      }),
    );

    expect(await view().advance("r1", "r2")).toBe(0);
    expect(scheduled).toHaveLength(0);
  });
});

describe("the drives a round can belong to", () => {
  it("lists drives that are past publishing, for the picker", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drives`, () =>
        HttpResponse.json([
          { id: "d1", company_name: "Zoho", status: "in_rounds" },
          { id: "d2", company_name: "TCS", status: "live" },
        ]),
      ),
    );

    const drives = await view().drivesInProgress();
    expect(drives.map((d) => d.companyName)).toEqual(["Zoho", "TCS"]);
  });
});
