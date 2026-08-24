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

/**
 * Spec B (approved 2026-08-24): the recruiter's offer letter, filed with the
 * declaration. Upload BEFORE insert (the 0051 order): an orphan object costs
 * kilobytes; a row pointing at nothing hands someone a dead link.
 */
describe("the offer letter", () => {
  const letter = new File([new Uint8Array(2048)], "Zoho-offer.pdf", { type: "application/pdf" });

  function stubStorage(client: { storage: { from: unknown } }) {
    const uploads: string[] = [];
    client.storage.from = ((bucket: string) => ({
      upload: async (path: string) => {
        uploads.push(`${bucket}/${path}`);
        return { data: { path }, error: null };
      },
    })) as unknown as typeof client.storage.from;
    return uploads;
  }

  const client = () =>
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

  it("uploads under student/drive, then declares with both attachment halves", async () => {
    const c = client();
    const uploads = stubStorage(c);
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/offers`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "o1" });
      }),
    );

    const r = createSupabaseOffersRepository(
      c,
      async () => CPC,
      async () => "central_placement_coordinator",
    );
    await r.declareOffer({ ...offer, letter });

    expect(uploads[0]).toMatch(/^offer-letters\/s1\/d1\//);
    expect(String(body.attachment_path)).toMatch(/^s1\/d1\//);
    expect(body.attachment_name).toBe("Zoho-offer.pdf");
  });

  it("declares with neither half when no letter is given", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/offers`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "o1" });
      }),
    );

    await repo().declareOffer(offer);

    expect(body.attachment_path).toBeUndefined();
  });

  it("attaches a letter to an already-declared offer (answer 1d), touching nothing else", async () => {
    const c = client();
    const uploads = stubStorage(c);
    let patch: Record<string, unknown> = {};
    let search = "";
    server.use(
      http.patch(`${BASE}/rest/v1/offers`, async ({ request }) => {
        patch = (await request.json()) as Record<string, unknown>;
        search = new URL(request.url).search;
        return HttpResponse.json([{ id: "o1" }]);
      }),
    );

    const r = createSupabaseOffersRepository(
      c,
      async () => CPC,
      async () => "central_placement_coordinator",
    );
    await r.attachLetter("s1", "d1", letter);

    expect(uploads[0]).toMatch(/^offer-letters\/s1\/d1\//);
    expect(Object.keys(patch).sort()).toEqual(["attachment_name", "attachment_path"]);
    expect(search).toContain("student_id=eq.s1");
    expect(search).toContain("drive_id=eq.d1");
  });

  it("refuses a wrong format before anything is uploaded", async () => {
    const c = client();
    const uploads = stubStorage(c);
    const r = createSupabaseOffersRepository(
      c,
      async () => CPC,
      async () => "central_placement_coordinator",
    );

    await expect(
      r.declareOffer({
        ...offer,
        letter: new File(["x"], "letter.docx", { type: "application/msword" }),
      }),
    ).rejects.toBeInstanceOf(OffersError);
    expect(uploads).toHaveLength(0);
  });
});
