import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseAttendanceView } from "./attendance-view";

/**
 * Feeds the attendance screen.
 *
 * The number that matters on it is `priorAbsences`. R8 counts absences across
 * a student's ENTIRE tenure with no per-drive reset, and three of them raise a
 * disbarment review — so the count must span every other round they were ever
 * scheduled for, and must exclude the round being marked right now, or the
 * coordinator sees today's absence counted twice.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const scheduled = (applicationId: string, name: string, roll: string, status = "scheduled") => ({
  application_id: applicationId,
  status,
  applications: {
    student_id: `stu-${applicationId}`,
    profile_snapshot: {},
    students: { full_name: name, roll_number: roll },
  },
});

function stub(opts: { scheduled?: unknown[]; history?: unknown[]; markFails?: boolean } = {}) {
  const writes: { body: unknown; search: string }[] = [];
  const historyQueries: string[] = [];

  server.use(
    http.get(`${BASE}/rest/v1/attendance`, ({ request }) => {
      const url = new URL(request.url);
      // The history lookup is the one that excludes the current round.
      if (url.searchParams.has("round_id") && url.search.includes("neq")) {
        historyQueries.push(url.search);
        return HttpResponse.json(opts.history ?? []);
      }
      return HttpResponse.json(opts.scheduled ?? []);
    }),
    http.patch(`${BASE}/rest/v1/attendance`, async ({ request }) => {
      writes.push({ body: await request.clone().json(), search: new URL(request.url).search });
      return opts.markFails === true
        ? new HttpResponse(null, { status: 400 })
        : HttpResponse.json({ id: "att-1" });
    }),
  );

  return { writes, historyQueries };
}

const view = (role = "campus_placement_coordinator", actorId: string | null = "cpc-1") =>
  createSupabaseAttendanceView(
    client(),
    async () => actorId,
    async () => role as "campus_placement_coordinator",
  );

describe("who is scheduled", () => {
  it("lists the students the recruiter actually called", async () => {
    stub({ scheduled: [scheduled("a1", "Anjali Subramanian", "21CSE1042")] });
    const [student] = await view().scheduled("r1");

    expect(student?.studentName).toBe("Anjali Subramanian");
    expect(student?.rollNumber).toBe("21CSE1042");
    expect(student?.status).toBe("scheduled");
  });

  it("still lists someone whose student row did not come back", async () => {
    stub({
      scheduled: [{ application_id: "a1", status: "scheduled", applications: null }],
    });
    const [student] = await view().scheduled("r1");

    expect(student?.studentName).toBe("Unknown student");
    expect(student?.rollNumber).toBe("—");
  });

  it("shows an empty round as empty", async () => {
    stub();

    expect(await view().scheduled("r1")).toEqual([]);
  });
});

describe("prior absences (R8 — whole tenure, no reset)", () => {
  it("counts absences from other drives, not just this one", async () => {
    stub({
      scheduled: [scheduled("a1", "Anjali", "21CSE1042")],
      history: [
        { status: "absent", round_id: "r9", applications: { drive_id: "other-drive" } },
        { status: "absent", round_id: "r8", applications: { drive_id: "another-drive" } },
      ],
    });

    expect((await view().scheduled("r1"))[0]?.priorAbsences).toBe(2);
  });

  it("excludes the round being marked, so today is never counted twice", async () => {
    const { historyQueries } = stub({ scheduled: [scheduled("a1", "Anjali", "21CSE1042")] });

    await view().scheduled("r1");

    expect(historyQueries[0]).toMatch(/round_id=neq\.r1/);
  });

  it("does not count a present or scheduled round against the student", async () => {
    stub({
      scheduled: [scheduled("a1", "Anjali", "21CSE1042")],
      history: [
        { status: "present", round_id: "r9", applications: { drive_id: "d2" } },
        { status: "scheduled", round_id: "r8", applications: { drive_id: "d3" } },
      ],
    });

    expect((await view().scheduled("r1"))[0]?.priorAbsences).toBe(0);
  });

  /** A provisional QR check-in is unconfirmed, so it never counts either. */
  it("does not count an unconfirmed QR check-in", async () => {
    stub({
      scheduled: [scheduled("a1", "Anjali", "21CSE1042")],
      history: [{ status: "provisional", round_id: "r9", applications: { drive_id: "d2" } }],
    });

    expect((await view().scheduled("r1"))[0]?.priorAbsences).toBe(0);
  });

  it("counts an absence whose drive could not be resolved rather than dropping it", async () => {
    stub({
      scheduled: [scheduled("a1", "Anjali", "21CSE1042")],
      history: [{ status: "absent", round_id: "r9", applications: null }],
    });

    expect((await view().scheduled("r1"))[0]?.priorAbsences).toBe(1);
  });
});

describe("marking attendance", () => {
  it("records the mark against the round, the application and the coordinator", async () => {
    const { writes } = stub();

    await view().mark("r1", "a1", "present");

    // The identifiers are eq filters on the row being updated, not columns in
    // the body: attendance rows are created when the round is scheduled.
    expect(writes[0]?.search).toMatch(/round_id=eq\.r1/);
    expect(writes[0]?.search).toMatch(/application_id=eq\.a1/);
    expect(writes[0]?.body).toMatchObject({ status: "present", marked_by: "cpc-1" });
  });

  it("refuses a role that may not mark attendance at all", async () => {
    const { writes } = stub();

    await expect(view("student").mark("r1", "a1", "present")).rejects.toThrow(/coordinator/i);
    expect(writes).toHaveLength(0);
  });

  it("refuses when the session has gone, rather than writing an unattributed mark", async () => {
    stub();

    await expect(
      view("campus_placement_coordinator", null).mark("r1", "a1", "present"),
    ).rejects.toThrow(/session/i);
  });
});
