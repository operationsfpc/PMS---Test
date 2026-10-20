import type { AppRole } from "@domain/types";
import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseRoundsRepository, RoundsError } from "./rounds-repository";

/**
 * Rounds, attendance and results against the database.
 *
 * The domain rules in `rounds.ts` decide who may do what; nothing is
 * re-implemented here. An unscheduled student must never reach the attendance
 * or results tables - that is what stops an absence being recorded against
 * someone the recruiter never called (Q9, R8).
 */
const BASE = "https://project.supabase.co";
const CPC = "90000000-0000-0000-0000-000000000005";

const repo = (role: AppRole = "central_placement_coordinator") =>
  createSupabaseRoundsRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => CPC,
    async () => role,
  );

describe("createSupabaseRoundsRepository", () => {
  describe("scheduleParticipants", () => {
    /**
     * 0101: participants and their `scheduled` attendance rows are inserted by
     * ONE function, because half of it is worse than none — a participant with
     * no attendance row cannot be marked, and an attendance row with no
     * participant is orphaned. So the browser-side contract is the function's
     * arguments: which round, which students, and the actor the row is
     * attributed to.
     */
    it("schedules exactly the chosen students, attributed to the actor", async () => {
      let body: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE}/rest/v1/rpc/schedule_round_participants`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(null);
        }),
      );

      await repo().scheduleParticipants("r1", ["app1", "app2"]);

      expect(body).toEqual({
        p_round_id: "r1",
        p_application_ids: ["app1", "app2"],
        p_added_by: CPC,
      });
    });

    it("asks for nothing when nobody was chosen", async () => {
      let called = 0;
      server.use(
        http.post(`${BASE}/rest/v1/rpc/schedule_round_participants`, () => {
          called += 1;
          return HttpResponse.json(null);
        }),
      );

      await repo().scheduleParticipants("r1", []);

      expect(called).toBe(0);
    });

    /**
     * UAT 2026-08-21 (screenshot): "Could not schedule the participants." —
     * and nothing else. The database said exactly what was wrong (a unique
     * key refused a duplicate) and the screen threw that detail away, so the
     * coordinator could neither fix it nor report it. The refusal must carry
     * the database's own words — including when it is a function that refuses.
     */
    it("carries the database's explanation when the insert is refused", async () => {
      server.use(
        http.post(`${BASE}/rest/v1/rpc/schedule_round_participants`, () =>
          HttpResponse.json(
            {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "one_participation_per_round"',
            },
            { status: 409 },
          ),
        ),
      );

      await expect(repo().scheduleParticipants("r1", ["app1"])).rejects.toThrow(
        /duplicate key value/i,
      );
    });
  });

  describe("markAttendance", () => {
    it("marks a scheduled student present", async () => {
      let body: Record<string, unknown> = {};
      server.use(
        http.patch(`${BASE}/rest/v1/attendance`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "at1" });
        }),
      );

      await repo().markAttendance("r1", "app1", "present", true);

      expect(body.status).toBe("present");
      expect(body.marked_by).toBe(CPC);
      expect(body.marked_at).toBeTruthy();
    });

    it("refuses to mark a student who was never scheduled", async () => {
      let called = false;
      server.use(
        http.patch(`${BASE}/rest/v1/attendance`, () => {
          called = true;
          return HttpResponse.json({});
        }),
      );

      await expect(repo().markAttendance("r1", "app1", "absent", false)).rejects.toBeInstanceOf(
        RoundsError,
      );
      expect(called).toBe(false);
    });

    it("refuses an Account Executive outright", async () => {
      await expect(
        repo("account_executive").markAttendance("r1", "app1", "present", true),
      ).rejects.toBeInstanceOf(RoundsError);
    });
  });

  describe("recordResult", () => {
    it("records a result for a participant", async () => {
      let body: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE}/rest/v1/round_results`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "rr1" });
        }),
      );

      await repo().recordResult("r1", "app1", "selected", true);

      expect(body.result).toBe("selected");
      expect(body.declared_by).toBe(CPC);
    });

    it("refuses a CPC - results are the Central CPC's", async () => {
      await expect(
        repo("campus_placement_coordinator").recordResult("r1", "app1", "selected", true),
      ).rejects.toBeInstanceOf(RoundsError);
    });

    /**
     * A15. round_results is unique on (round_id, application_id), so a plain
     * insert makes a correction impossible - promoting a waitlisted student
     * to selected, which Q10 requires before they can be scheduled, would die
     * on a duplicate key. A correction replaces the row; the audit trigger
     * keeps the previous value.
     */
    it("replaces an existing result rather than failing on the unique key", async () => {
      let prefer = "";
      let body: Record<string, unknown> = {};
      server.use(
        http.post(`${BASE}/rest/v1/round_results`, async ({ request }) => {
          prefer = request.headers.get("prefer") ?? "";
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "rr1" });
        }),
      );

      await repo().recordResult("r1", "app1", "selected", true);

      expect(prefer).toMatch(/resolution=merge-duplicates/);
      expect(body.result).toBe("selected");
    });
  });

  describe("nextRoundParticipants", () => {
    it("carries forward only the selected", async () => {
      server.use(
        http.get(`${BASE}/rest/v1/round_results`, () =>
          HttpResponse.json([
            { application_id: "app1", result: "selected" },
            { application_id: "app2", result: "waitlisted" },
            { application_id: "app3", result: "rejected" },
          ]),
        ),
      );

      expect(await repo().nextRoundParticipants("r1")).toEqual(["app1"]);
    });

    /**
     * 2026-10-19: one select answers a thousand rows. A campus-wide first
     * round records more than that, and the student on row 1001 was never
     * scheduled for round two — no error, just a name nobody called.
     */
    it("carries forward the selected on every page, not just the first thousand", async () => {
      const results = [
        ...Array.from({ length: 1000 }, (_, i) => ({
          application_id: `filler-${i}`,
          result: "rejected",
        })),
        { application_id: "app-late", result: "selected" },
      ];

      server.use(
        http.get(`${BASE}/rest/v1/round_results`, ({ request }) => {
          const url = new URL(request.url);
          const offset = Number(url.searchParams.get("offset") ?? "0");
          return HttpResponse.json(results.slice(offset, offset + 1000));
        }),
      );

      expect(await repo().nextRoundParticipants("r1")).toEqual(["app-late"]);
    });

    it("refuses to name a next round it could not read", async () => {
      server.use(
        http.get(`${BASE}/rest/v1/round_results`, () =>
          HttpResponse.json(
            { message: 'invalid input syntax for type uuid: "r1"' },
            { status: 400 },
          ),
        ),
      );

      await expect(repo().nextRoundParticipants("r1")).rejects.toThrow(RoundsError);
    });
  });
});
