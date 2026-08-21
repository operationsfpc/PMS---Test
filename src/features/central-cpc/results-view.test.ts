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
    // F4 (UAT 2026-08-19): each round now carries its own details, null until
    // set. G6b (2026-08-20) added the venue for physical rounds.
    const bare = { mode: null, scheduledAt: null, interviewLink: null, venue: null };
    expect(rounds).toEqual([
      { roundId: "r1", sequence: 1, name: "Aptitude", ...bare },
      { roundId: "r2", sequence: 2, name: "Technical", ...bare },
    ]);
  });

  /** G6b (UAT 2026-08-20): a physical round's venue is stored beside the link. */
  it("writes the venue — and clears the link — for a physical round", async () => {
    const writes: unknown[] = [];
    server.use(
      http.patch(`${BASE}/rest/v1/drive_rounds`, async ({ request }) => {
        writes.push(await request.clone().json());
        return HttpResponse.json({ id: "r1" });
      }),
    );

    await view().updateRound("r1", {
      mode: "physical_outside_campus",
      scheduledAt: "2026-09-01T10:30",
      interviewLink: null,
      venue: "Taj Coromandel, Chennai",
    });

    expect(writes[0]).toMatchObject({
      round_mode: "physical_outside_campus",
      round_interview_link: null,
      venue: "Taj Coromandel, Chennai",
    });
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

/**
 * Batch B2 + C3 (2026-08-21, M2 approved): managing rounds and completing
 * the drive, from the rounds screen.
 */
describe("managing rounds", () => {
  it("reports each round's recorded facts, so the dialog can freeze honestly", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drive_rounds`, () =>
        HttpResponse.json([
          {
            id: "r1",
            sequence: 1,
            name: "Aptitude",
            round_participants: [{ application_id: "a1" }],
            round_results: [{ application_id: "a1", result: "selected" }],
            attendance: [{ application_id: "a1", status: "present" }],
          },
          {
            id: "r2",
            sequence: 2,
            name: "HR",
            round_participants: [],
            round_results: [],
            attendance: [],
          },
        ]),
      ),
    );

    const facts = await view().roundFacts("d1");

    expect(facts.get("r1")).toEqual({
      hasParticipants: true,
      hasAttendance: true,
      hasResults: true,
    });
    expect(facts.get("r2")).toEqual({
      hasParticipants: false,
      hasAttendance: false,
      hasResults: false,
    });
  });

  it("renames a round with a PATCH on that round alone", async () => {
    let patched: { url: string; body: Record<string, unknown> } | null = null;
    server.use(
      http.patch(`${BASE}/rest/v1/drive_rounds`, async ({ request }) => {
        patched = { url: request.url, body: (await request.json()) as Record<string, unknown> };
        return HttpResponse.json(null);
      }),
    );

    await view().renameRound("r2", "HR discussion");

    const p = patched as unknown as { url: string; body: Record<string, unknown> };
    expect(p.url).toContain("id=eq.r2");
    expect(p.body).toEqual({ name: "HR discussion" });
  });

  it("removes a round and renumbers the survivors to close the gap", async () => {
    const deletes: string[] = [];
    const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
    server.use(
      http.get(`${BASE}/rest/v1/drive_rounds`, () =>
        HttpResponse.json([
          { id: "r1", sequence: 1, name: "Aptitude" },
          { id: "r2", sequence: 2, name: "HR" },
          { id: "r3", sequence: 3, name: "Offer release" },
        ]),
      ),
      http.delete(`${BASE}/rest/v1/drive_rounds`, ({ request }) => {
        deletes.push(request.url);
        return HttpResponse.json(null);
      }),
      http.patch(`${BASE}/rest/v1/drive_rounds`, async ({ request }) => {
        patches.push({
          url: request.url,
          body: (await request.json()) as Record<string, unknown>,
        });
        return HttpResponse.json(null);
      }),
    );

    await view().removeRound("d1", "r2");

    expect(deletes[0]).toContain("id=eq.r2");
    // Only r3 needs a new number; r1 is already right.
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toContain("id=eq.r3");
    expect(patches[0]?.body).toEqual({ sequence: 2 });
  });
});

describe("completing the drive (C3, answer 3b)", () => {
  it("counts the applicants still undecided", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/applications`, () =>
        HttpResponse.json([
          { id: "a1", student_id: "s1" },
          { id: "a2", student_id: "s2" },
        ]),
      ),
      http.get(`${BASE}/rest/v1/drive_rounds`, () =>
        HttpResponse.json([
          {
            id: "r1",
            sequence: 1,
            name: "R1",
            round_participants: [{ application_id: "a1" }, { application_id: "a2" }],
            round_results: [{ application_id: "a1", result: "rejected" }],
            attendance: [],
          },
        ]),
      ),
      http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json([])),
    );

    const readiness = await view().completionFacts("d1");

    // a1 is rejected (terminal); a2 sat the round with no result (pending).
    expect(readiness).toEqual({ ready: false, undecided: 1 });
  });

  it("completes the drive, storing the early reason only when one was needed", async () => {
    const patches: Array<Record<string, unknown>> = [];
    server.use(
      http.patch(`${BASE}/rest/v1/drives`, async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(null);
      }),
    );

    await view().completeDrive("d1", null);
    expect(patches[0]).toEqual({ status: "completed", completed_reason: null });

    await view().completeDrive("d1", "Company closed the process");
    expect(patches[1]).toEqual({
      status: "completed",
      completed_reason: "Company closed the process",
    });
  });
});
