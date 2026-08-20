import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../mocks/node";
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

/**
 * J1/J2/J3 (2026-08-18) — what the Delivery Head is actually approving.
 *
 * Answer 10: the JD link belongs on this screen. They approve the commercials
 * of a role, and the JD *is* the role; approving one from a company name and a
 * CTC is approving a title.
 */
describe("createSupabaseApprovalRepository — the JD, the shift and the joining timeline", () => {
  /** Storage is stubbed at the client: supabase-js signs URLs, not this code. */
  const withStorage = (signed: Record<string, string>) => {
    const client = createClient(BASE, "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let asked: string[] = [];

    client.storage.from = ((bucket: string) => ({
      createSignedUrls: async (paths: string[]) => {
        asked = paths;
        return {
          data: paths.map((path) => ({ path, signedUrl: signed[path] ?? null, error: null })),
          error: null,
          bucket,
        };
      },
    })) as unknown as typeof client.storage.from;

    return { client, bucketPaths: () => asked };
  };

  const queueOf = (rows: Record<string, unknown>[]) => {
    server.use(http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json(rows)));
  };

  it("hands back a signed link to the attached JD, and the name it arrived with", async () => {
    queueOf([
      {
        id: "d1",
        company_name: "Zoho",
        jd_storage_path: "d1/jd-1.pdf",
        jd_file_name: "Zoho-GET-JD.pdf",
        jd_size_bytes: 412_000,
      },
    ]);
    const { client, bucketPaths } = withStorage({ "d1/jd-1.pdf": "https://signed/jd" });

    const rows = await createSupabaseApprovalRepository(client, async () => HEAD).pending();

    expect(bucketPaths()).toEqual(["d1/jd-1.pdf"]);
    expect(rows[0]?.jobDescriptionUrl).toBe("https://signed/jd");
    expect(rows[0]?.jobDescriptionName).toBe("Zoho-GET-JD.pdf");
  });

  it("asks storage for nothing when no PIF in the queue has one", async () => {
    queueOf([{ id: "d1", company_name: "Zoho", jd_storage_path: null }]);
    const { client, bucketPaths } = withStorage({});

    const rows = await createSupabaseApprovalRepository(client, async () => HEAD).pending();

    expect(bucketPaths()).toEqual([]);
    expect(rows[0]?.jobDescriptionUrl).toBeNull();
  });

  it("still shows the PIF when its link cannot be signed", async () => {
    // A queue that refuses to load because one attachment is unreachable would
    // stop every approval in the organisation.
    queueOf([{ id: "d1", company_name: "Zoho", jd_storage_path: "d1/jd-1.pdf" }]);
    const { client } = withStorage({});

    const rows = await createSupabaseApprovalRepository(client, async () => HEAD).pending();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.jobDescriptionUrl).toBeNull();
  });

  it("reads the shift and the joining timeline the way the domain words them", async () => {
    queueOf([
      {
        id: "d1",
        company_name: "Zoho",
        shift_type: "night",
        shift_night_timing: "9pm – 6am",
        joining_timeline: "later",
        joining_later_notes: "Joining July 2027",
      },
    ]);
    const { client } = withStorage({});

    const rows = await createSupabaseApprovalRepository(client, async () => HEAD).pending();

    expect(rows[0]?.shift).toBe("Night shift (9pm – 6am)");
    expect(rows[0]?.joining).toBe("Joining later — Joining July 2027");
  });

  it("falls back to the legacy prose for a drive raised before the radio existed", async () => {
    queueOf([
      {
        id: "d1",
        company_name: "Zoho",
        shift_type: "General",
        timeline_notes: "Offers in Nov, joining in batches",
      },
    ]);
    const { client } = withStorage({});

    const rows = await createSupabaseApprovalRepository(client, async () => HEAD).pending();

    expect(rows[0]?.shift).toBe("General");
    expect(rows[0]?.joining).toBe("Offers in Nov, joining in batches");
  });
});
