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

function stub(
  opts: {
    attendance?: unknown[];
    results?: unknown[];
    slots?: unknown[];
    recordFails?: boolean;
  } = {},
) {
  const writes: unknown[] = [];

  server.use(
    http.get(`${BASE}/rest/v1/attendance`, () => HttpResponse.json(opts.attendance ?? [])),
    /**
     * 2026-08-26: `participants()` has read `round_participants` since F5 gave
     * each student their own slot, and this helper never answered it. With
     * `onUnhandledRequest: "error"` the call still went out to the network and
     * every test in this file paid ~7 SECONDS waiting for it — which is why
     * the suite looked like it was hanging on a loaded machine. A test must
     * not touch the network to pass.
     */
    http.get(`${BASE}/rest/v1/round_participants`, () => HttpResponse.json(opts.slots ?? [])),
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
      // Nobody is in the next round yet.
      http.get(`${BASE}/rest/v1/round_participants`, () => HttpResponse.json([])),
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

  /**
   * UAT 2026-08-21 (live, Deloitte drive): "Could not schedule the
   * participants." — forever. More students were marked selected AFTER an
   * earlier advance, so the re-advance batch contained a student already
   * sitting in Round 2. Her unique key refused the WHOLE insert, and every
   * retry rebuilt the same batch. An advance must only schedule the ones
   * not already there — and count only them.
   */
  it("skips students already in the next round — a re-advance after late selections", async () => {
    const scheduled: unknown[] = [];
    server.use(
      http.get(`${BASE}/rest/v1/round_results`, () =>
        HttpResponse.json([
          { application_id: "a1", result: "selected" },
          { application_id: "a2", result: "selected" },
        ]),
      ),
      // a1 already advanced last time.
      http.get(`${BASE}/rest/v1/round_participants`, () =>
        HttpResponse.json([{ application_id: "a1" }]),
      ),
      http.post(`${BASE}/rest/v1/round_participants`, async ({ request }) => {
        scheduled.push(await request.clone().json());
        return HttpResponse.json([{ id: "rp-2" }]);
      }),
      http.post(`${BASE}/rest/v1/attendance`, () => HttpResponse.json([{ id: "at-2" }])),
    );

    const moved = await view().advance("r1", "r2");

    expect(moved).toBe(1);
    const participants = scheduled[0] as Array<Record<string, unknown>>;
    expect(participants).toHaveLength(1);
    expect(participants[0]).toMatchObject({ round_id: "r2", application_id: "a2" });
  });

  it("advances nobody — and writes nothing — when everyone selected is already there", async () => {
    const scheduled: unknown[] = [];
    server.use(
      http.get(`${BASE}/rest/v1/round_results`, () =>
        HttpResponse.json([{ application_id: "a1", result: "selected" }]),
      ),
      http.get(`${BASE}/rest/v1/round_participants`, () =>
        HttpResponse.json([{ application_id: "a1" }]),
      ),
      http.post(`${BASE}/rest/v1/round_participants`, async ({ request }) => {
        scheduled.push(await request.clone().json());
        return HttpResponse.json([{ id: "rp-1" }]);
      }),
    );

    expect(await view().advance("r1", "r2")).toBe(0);
    expect(scheduled).toHaveLength(0);
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

/**
 * 2026-08-26: who on this drive already holds an offer.
 *
 * An offer belongs to a STUDENT and a DRIVE; the round screen speaks in
 * application ids. The mapping happens here, once, rather than in the
 * component that has to render it.
 */
describe("offerHolders", () => {
  it("maps the drive's offers back to their applications", async () => {
    const queries: string[] = [];
    server.use(
      http.get(`${BASE}/rest/v1/offers`, ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json([{ student_id: "s2" }]);
      }),
      http.get(`${BASE}/rest/v1/applications`, () =>
        HttpResponse.json([
          { id: "a1", student_id: "s1" },
          { id: "a2", student_id: "s2" },
        ]),
      ),
    );

    const held = await view().offerHolders("d1");

    expect([...held]).toEqual(["a2"]);
    // Scoped to this drive: a student placed elsewhere has not been offered
    // THIS job, and locking their row here would be a lie.
    expect(queries[0]).toContain("drive_id=eq.d1");
  });

  it("is empty when nobody has been offered anything", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json([])),
      http.get(`${BASE}/rest/v1/applications`, () =>
        HttpResponse.json([{ id: "a1", student_id: "s1" }]),
      ),
    );

    expect([...(await view().offerHolders("d1"))]).toEqual([]);
  });

  it("ignores an offer whose student never applied through this drive", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json([{ student_id: "ghost" }])),
      http.get(`${BASE}/rest/v1/applications`, () =>
        HttpResponse.json([{ id: "a1", student_id: "s1" }]),
      ),
    );

    expect([...(await view().offerHolders("d1"))]).toEqual([]);
  });
});

/**
 * UAT 2026-08-26 (live): the bulk upload reported "0 links assigned" for roll
 * numbers the screen was displaying. Matching has since moved into the domain
 * (`matchMeetingSlots`), so the view is handed APPLICATION IDs and has one
 * job: write the slot, and be honest about whether a row was actually
 * written.
 *
 * The silent failure that made the bug invisible: PostgREST's UPDATE against
 * a `round_participants` row that does not exist returns 200 with an empty
 * body — "success" that wrote nothing. The screen believed it.
 */
describe("assignSlots", () => {
  function slotStub(opts: { existing?: string[]; updateFails?: boolean } = {}) {
    const inserted: unknown[] = [];
    const updated: { url: string; body: unknown }[] = [];
    const existing = opts.existing ?? [];

    server.use(
      http.post(`${BASE}/rest/v1/round_participants`, async ({ request }) => {
        inserted.push(await request.clone().json());
        return HttpResponse.json([]);
      }),
      http.patch(`${BASE}/rest/v1/round_participants`, async ({ request }) => {
        const url = new URL(request.url);
        updated.push({ url: request.url, body: await request.clone().json() });
        if (opts.updateFails === true) return new HttpResponse(null, { status: 400 });
        const application = (url.searchParams.get("application_id") ?? "").replace("eq.", "");
        // Only a row that exists comes back — PostgREST's honest answer.
        return HttpResponse.json(existing.includes(application) ? [{ id: "rp-1" }] : []);
      }),
    );

    return { inserted, updated };
  }

  const assignment = (applicationId: string, rollNumber: string) => ({
    applicationId,
    rollNumber,
    meetingLink: "https://meet.google.com/abc",
    scheduledAt: "2026-09-01T10:30",
  });

  it("writes each student's link and counts only the rows it really wrote", async () => {
    const { updated } = slotStub({ existing: ["a1"] });

    const result = await view().assignSlots("r1", [assignment("a1", "BCA2023156")]);

    expect(result).toEqual({ matched: 1, unmatched: [] });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.body).toEqual({
      meeting_link: "https://meet.google.com/abc",
      // IST, as `fromDatetimeLocal` writes it — 10:30 for the student.
      participant_scheduled_at: "2026-09-01T10:30:00+05:30",
    });
    expect(updated[0]?.url).toContain("round_id=eq.r1");
  });

  /**
   * The repair. A student can be scheduled for a round (attendance says so,
   * and the screen lists them) while the `round_participants` row is missing.
   * Creating the row and then UPDATING it also makes the student's
   * notification fire — 0054's trigger is an AFTER UPDATE trigger, so an
   * insert carrying the link would have told them nothing.
   */
  it("creates the missing participant row rather than silently writing nothing", async () => {
    const { inserted, updated } = slotStub({ existing: [] });

    const result = await view().assignSlots("r1", [assignment("a-missing", "124")]);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual([
      { round_id: "r1", application_id: "a-missing", added_by: "cpc-1" },
    ]);
    // Written after the row was created — twice in all, and the last one wins.
    expect(updated.length).toBeGreaterThanOrEqual(1);
    expect(result).toEqual({ matched: 1, unmatched: [] });
  });

  it("reports the roll number whose write the database refused", async () => {
    slotStub({ updateFails: true });

    expect(await view().assignSlots("r1", [assignment("a1", "BCA2023156")])).toEqual({
      matched: 0,
      unmatched: ["BCA2023156"],
    });
  });

  it("does nothing at all when there is nothing to assign", async () => {
    const { inserted, updated } = slotStub();

    expect(await view().assignSlots("r1", [])).toEqual({ matched: 0, unmatched: [] });
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
  });

  /**
   * UAT 2026-08-27 (live): `1pm` in the file was stamped as `1pm:00+05:30`,
   * Postgres refused every row, and the screen — whose only wording for a
   * refused write is a roll-number mismatch — accused two students of not
   * being in their own round. The domain now parses that column, so a time
   * arriving here unparsed is a programming error: say so, and write nothing.
   */
  it("refuses to send a time it cannot stamp, instead of blaming the student", async () => {
    const { inserted, updated } = slotStub({ existing: ["a1"] });

    await expect(
      view().assignSlots("r1", [{ ...assignment("a1", "BCA2023156"), scheduledAt: "1pm" }]),
    ).rejects.toThrow(/time/i);
    expect(updated).toEqual([]);
    expect(inserted).toEqual([]);
  });
});

/**
 * The single-student "Save link" beside a row had the same silent failure as
 * the bulk upload: an UPDATE matching no row is a 200, and the screen said
 * "Meeting link saved" for a link nowhere in the database.
 */
describe("setParticipantSlot", () => {
  function stubSlot(opts: { existing?: string[] } = {}) {
    const inserted: unknown[] = [];
    const existing = opts.existing ?? [];
    server.use(
      http.post(`${BASE}/rest/v1/round_participants`, async ({ request }) => {
        inserted.push(await request.clone().json());
        return HttpResponse.json([]);
      }),
      http.patch(`${BASE}/rest/v1/round_participants`, ({ request }) => {
        const application = (new URL(request.url).searchParams.get("application_id") ?? "").replace(
          "eq.",
          "",
        );
        return HttpResponse.json(existing.includes(application) ? [{ id: "rp-1" }] : []);
      }),
    );
    return inserted;
  }

  it("saves the link against an existing participant row", async () => {
    const inserted = stubSlot({ existing: ["a1"] });

    await view().setParticipantSlot("r1", "a1", "https://meet.google.com/abc", null);

    expect(inserted).toEqual([]);
  });

  it("creates the missing row instead of pretending the link was saved", async () => {
    const inserted = stubSlot({ existing: [] });

    await view().setParticipantSlot("r1", "a-missing", "https://meet.google.com/abc", null);

    expect(inserted).toHaveLength(1);
  });

  it("refuses a time it cannot stamp, rather than sending Postgres nonsense", async () => {
    stubSlot({ existing: ["a1"] });

    await expect(
      view().setParticipantSlot("r1", "a1", "https://meet.google.com/abc", "1pm"),
    ).rejects.toThrow(/time/i);
  });
});
