import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabasePifRepository, PifError } from "./pif-repository";
import { PIF_DEFAULTS, type PifFormValues } from "./pif-schema";

const BASE = "https://project.supabase.co";
const AE = "60000000-0000-0000-0000-000000000002";

const repo = (actor: string | null = AE) =>
  createSupabasePifRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => actor,
  );

const values: PifFormValues = {
  ...PIF_DEFAULTS,
  companyName: "Zoho Corporation",
  spocEmail: "karthik@zoho.com",
  roleTitle: "Member Technical Staff",
  roleCategory: "software_technical",
  jobDescription: "Backend services.",
  openings: 25,
  workLocations: "Chennai",
  ctcMinLpa: 6.5,
  eligiblePassingYears: [2027],
  driveMode: "on_campus",
  driveType: "placement",
};

describe("createSupabasePifRepository", () => {
  it("saves a draft as status draft, owned by the AE who raised it", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/drives`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "d1", status: "draft" });
      }),
    );

    await repo().saveDraft(values);

    expect(body.status).toBe("draft");
    expect(body.created_by).toBe(AE);
    expect(body.company_name).toBe("Zoho Corporation");
  });

  it("submits as status submitted, so it reaches the Delivery Head", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/drives`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "d1", status: "submitted" });
      }),
    );

    const result = await repo().submit(values);

    expect(body.status).toBe("submitted");
    expect(result).toEqual({ id: "d1", status: "submitted" });
  });

  it("never sends an offer category - it is not the AE's to set", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/drives`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "d1", status: "submitted" });
      }),
    );

    await repo().submit({ ...values, offerCategory: "super_dream" } as typeof values);

    expect("offer_category" in body).toBe(false);
  });

  it("stores empty optional text as null rather than an empty string", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/drives`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "d1", status: "draft" });
      }),
    );

    await repo().saveDraft({ ...values, industry: "", companyWebsite: "" });

    expect(body.industry).toBeNull();
    expect(body.company_website).toBeNull();
  });

  it("refuses to write anything when the session has gone", async () => {
    await expect(repo(null).saveDraft(values)).rejects.toBeInstanceOf(PifError);
  });

  it("translates a refusal into something the AE can act on", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/drives`, () =>
        HttpResponse.json(
          { code: "42501", message: "permission denied", details: null, hint: null },
          { status: 403 },
        ),
      ),
    );

    await expect(repo().submit(values)).rejects.toBeInstanceOf(PifError);
  });
});
