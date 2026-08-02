import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseVerificationRepository, VerificationError } from "./verification-repository";

/**
 * The CPC verification queue against real data.
 *
 * RLS already scopes a coordinator to their own campuses, so the query does
 * not filter by campus - doing so in the client would be a second, weaker copy
 * of a rule the database already enforces.
 */
const BASE = "https://project.supabase.co";
const CPC = "50000000-0000-0000-0000-000000000009";

const repo = () =>
  createSupabaseVerificationRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => CPC,
  );

describe("createSupabaseVerificationRepository", () => {
  describe("pending()", () => {
    it("asks only for forms awaiting verification", async () => {
      let url = "";
      server.use(
        http.get(`${BASE}/rest/v1/students`, ({ request }) => {
          url = request.url;
          return HttpResponse.json([
            { id: "s1", full_name: "Asha R", roll_number: "TEC001", overall_cgpa: 8.2 },
          ]);
        }),
      );

      const rows = await repo().pending();

      expect(url).toContain("srf_status=eq.srf_submitted");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.fullName).toBe("Asha R");
    });
  });

  describe("decide()", () => {
    it("approves by moving the student to srf_approved and stamping the decider", async () => {
      let body: Record<string, unknown> = {};
      server.use(
        http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "s1", srf_status: "srf_approved" });
        }),
      );

      await repo().decide("s1", "srf_submitted", { decision: "approve" });

      expect(body.srf_status).toBe("srf_approved");
      expect(body.srf_decided_by).toBe(CPC);
      expect(body.srf_decided_at).toBeTruthy();
      expect(body.srf_rejection_reason).toBeNull();
    });

    it("records the reason when rejecting", async () => {
      let body: Record<string, unknown> = {};
      server.use(
        http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "s1", srf_status: "srf_rejected" });
        }),
      );

      await repo().decide("s1", "srf_submitted", {
        decision: "reject",
        reason: "12th marksheet is unreadable",
      });

      expect(body.srf_status).toBe("srf_rejected");
      expect(body.srf_rejection_reason).toBe("12th marksheet is unreadable");
    });

    it("refuses an invalid transition without touching the database", async () => {
      let called = false;
      server.use(
        http.patch(`${BASE}/rest/v1/students`, () => {
          called = true;
          return HttpResponse.json({});
        }),
      );

      await expect(
        repo().decide("s1", "srf_approved", { decision: "approve" }),
      ).rejects.toBeInstanceOf(VerificationError);
      expect(called).toBe(false);
    });

    it("refuses a rejection with no reason without touching the database", async () => {
      let called = false;
      server.use(
        http.patch(`${BASE}/rest/v1/students`, () => {
          called = true;
          return HttpResponse.json({});
        }),
      );

      await expect(
        repo().decide("s1", "srf_submitted", { decision: "reject", reason: "" }),
      ).rejects.toBeInstanceOf(VerificationError);
      expect(called).toBe(false);
    });
  });
});
