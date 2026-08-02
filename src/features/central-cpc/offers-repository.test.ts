import type { AppRole } from "@domain/types";
import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseOffersRepository, OffersError } from "./offers-repository";

/**
 * Final selection — the explicit upload that makes a student placed.
 *
 * PRD §6: final selection is NOT inferred from the last round. It is declared,
 * because a recruiter's last round is not always their last word.
 *
 * The offer row is what R3, R4 and R9 read: the category ladder, the
 * internship cap, and the placement record all derive from it.
 */
const BASE = "https://project.supabase.co";
const CPC = "a0000000-0000-0000-0000-000000000006";

const repo = (role: AppRole = "central_placement_coordinator") =>
  createSupabaseOffersRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => CPC,
    async () => role,
  );

const offer = {
  studentId: "s1",
  driveId: "d1",
  companyName: "Zoho",
  roleTitle: "MTS",
  driveType: "placement" as const,
  offerCategory: "dream" as const,
  ctcLpa: 7.5,
};

describe("createSupabaseOffersRepository", () => {
  it("declares an on-campus offer against the drive that produced it", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/offers`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "o1" });
      }),
    );

    await repo().declareOffer(offer);

    expect(body.source).toBe("on_campus");
    expect(body.drive_id).toBe("d1");
    expect(body.ctc_lpa).toBe(7.5);
    expect(body.declared_by).toBe(CPC);
  });

  it("refuses anyone but the Central CPC", async () => {
    await expect(repo("campus_placement_coordinator").declareOffer(offer)).rejects.toBeInstanceOf(
      OffersError,
    );
    await expect(repo("account_executive").declareOffer(offer)).rejects.toBeInstanceOf(OffersError);
  });

  it("refuses a plain internship carrying an offer category", async () => {
    // The database forbids it too; catching it here keeps the message useful.
    await expect(
      repo().declareOffer({ ...offer, driveType: "internship", offerCategory: "dream" }),
    ).rejects.toThrow(/internship/i);
  });

  it("requires a category for a ladder offer", async () => {
    await expect(
      repo().declareOffer({ ...offer, driveType: "placement", offerCategory: null }),
    ).rejects.toThrow(/category/i);
  });

  it("refuses a negative CTC", async () => {
    await expect(repo().declareOffer({ ...offer, ctcLpa: -1 })).rejects.toBeInstanceOf(OffersError);
  });

  it("explains a duplicate declaration rather than leaking a constraint name", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/offers`, () =>
        HttpResponse.json(
          { code: "23505", message: "duplicate key", details: null, hint: null },
          { status: 409 },
        ),
      ),
    );

    await expect(repo().declareOffer(offer)).rejects.toThrow(/already/i);
  });
});
