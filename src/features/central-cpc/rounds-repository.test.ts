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
    it("records who the recruiter chose, and marks them scheduled", async () => {
      const bodies: Array<Record<string, unknown>> = [];
      server.use(
        http.post(`${BASE}/rest/v1/round_participants`, async ({ request }) => {
          bodies.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json([{ id: "rp1" }]);
        }),
        http.post(`${BASE}/rest/v1/attendance`, async ({ request }) => {
          bodies.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json([{ id: "at1" }]);
        }),
      );

      await repo().scheduleParticipants("r1", ["app1", "app2"]);

      const participants = bodies[0] as unknown as Array<Record<string, unknown>>;
      expect(participants).toHaveLength(2);
      expect(participants[0]?.round_id).toBe("r1");
      expect(participants[0]?.added_by).toBe(CPC);

      const attendance = bodies[1] as unknown as Array<Record<string, unknown>>;
      expect(attendance[0]?.status).toBe("scheduled");
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
  });
});
