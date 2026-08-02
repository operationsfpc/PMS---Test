import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { ApprovalError, createSupabaseApprovalRepository } from "./approval-repository";

const BASE = "https://project.supabase.co";
const HEAD = "70000000-0000-0000-0000-000000000003";

const repo = (actor: string | null = HEAD) =>
  createSupabaseApprovalRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => actor,
  );

describe("createSupabaseApprovalRepository", () => {
  it("asks only for PIFs awaiting approval", async () => {
    let url = "";
    server.use(
      http.get(`${BASE}/rest/v1/drives`, ({ request }) => {
        url = request.url;
        return HttpResponse.json([
          { id: "d1", company_name: "Zoho", ctc_min_lpa: 6.5, ctc_max_lpa: 9, on_hold: false },
        ]);
      }),
    );

    const rows = await repo().pending();

    expect(url).toContain("status=eq.submitted");
    expect(rows[0]?.companyName).toBe("Zoho");
  });

  it("approves with the Delivery Head's category and stamps who approved it", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE}/rest/v1/drives`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "d1", status: "approved" });
      }),
    );

    await repo().decide("d1", "submitted", { decision: "approve", offerCategory: "super_dream" });

    expect(body.status).toBe("approved");
    expect(body.offer_category).toBe("super_dream");
    expect(body.approved_by).toBe(HEAD);
    expect(body.approved_at).toBeTruthy();
  });

  it("records the reason on rejection", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE}/rest/v1/drives`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "d1", status: "rejected" });
      }),
    );

    await repo().decide("d1", "submitted", {
      decision: "reject",
      reason: "Duplicate of PIF-204",
    });

    expect(body.status).toBe("rejected");
    expect(body.rejection_reason).toBe("Duplicate of PIF-204");
    // Never classify something that was refused.
    expect(body.offer_category ?? null).toBeNull();
  });

  it("refuses an approval with no offer category, before reaching the database", async () => {
    let called = false;
    server.use(
      http.patch(`${BASE}/rest/v1/drives`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    await expect(
      repo().decide("d1", "submitted", { decision: "approve", offerCategory: null }),
    ).rejects.toBeInstanceOf(ApprovalError);
    expect(called).toBe(false);
  });

  it("never reopens a rejected PIF", async () => {
    let called = false;
    server.use(
      http.patch(`${BASE}/rest/v1/drives`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    await expect(
      repo().decide("d1", "rejected", { decision: "approve", offerCategory: "dream" }),
    ).rejects.toBeInstanceOf(ApprovalError);
    expect(called).toBe(false);
  });
});
