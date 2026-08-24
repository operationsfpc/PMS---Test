import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabasePublishRepository, PublishError } from "./publish-repository";

/**
 * The Central CPC takes an approved drive live.
 *
 * Publishing is the moment a drive becomes visible to students, so every §3.5
 * requirement and the on-hold invariant are checked by `canGoLive` before
 * anything is written.
 */
const BASE = "https://project.supabase.co";
const CPC = "80000000-0000-0000-0000-000000000004";

const repo = () =>
  createSupabasePublishRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => CPC,
  );

const complete = {
  companyName: "Zoho",
  roleTitle: "MTS",
  roleCategory: "software_technical" as const,
  jobDescription: "Backend.",
  hasJobDescriptionFile: false,
  locations: ["Chennai"],
  ctcMinLpa: 6.5,
  driveType: "placement" as const,
  offerCategory: "dream" as const,
  hasEligibilityCriteria: true,
  roundCount: 2,
  applicationStart: "2026-09-01T00:00:00Z",
  applicationEnd: "2026-09-10T00:00:00Z",
  onHold: false,
};

describe("createSupabasePublishRepository", () => {
  it("takes a complete, approved drive live", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE}/rest/v1/drives`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "d1", status: "live" });
      }),
    );

    await repo().publish("d1", "approved", complete);

    expect(body.status).toBe("live");
    expect(body.published_by).toBe(CPC);
  });

  it("refuses to publish a held drive, and never touches the database", async () => {
    let called = false;
    server.use(
      http.patch(`${BASE}/rest/v1/drives`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    await expect(
      repo().publish("d1", "approved", { ...complete, onHold: true }),
    ).rejects.toBeInstanceOf(PublishError);
    expect(called).toBe(false);
  });

  it("refuses an unapproved drive", async () => {
    await expect(repo().publish("d1", "submitted", complete)).rejects.toBeInstanceOf(PublishError);
  });

  it("names every missing field, not just the first", async () => {
    await expect(
      repo().publish("d1", "approved", {
        ...complete,
        roundCount: 0,
        applicationEnd: null,
      }),
    ).rejects.toThrow(/round[\s\S]*application|application[\s\S]*round/i);
  });
});
