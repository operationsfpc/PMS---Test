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

  /**
   * A PIF failed in production and the only thing anyone could see was "please
   * try again". Every one of these has a different remedy, and none of them is
   * "try again", so each has to say what it actually is.
   */
  describe("says what actually went wrong", () => {
    const failsWith = (body: Record<string, unknown>, status: number) => {
      server.use(http.post(`${BASE}/rest/v1/drives`, () => HttpResponse.json(body, { status })));
    };

    it("names a missing column, which means the schema is behind the app", async () => {
      failsWith(
        { code: "PGRST204", message: "Could not find the 'spoc_name' column", details: null },
        400,
      );

      await expect(repo().saveDraft(values)).rejects.toThrow(/database is out of date/i);
    });

    it("names a required field the database rejected as empty", async () => {
      failsWith(
        {
          code: "23502",
          message: 'null value in column "company_name" violates not-null constraint',
          details: null,
        },
        400,
      );

      await expect(repo().saveDraft(values)).rejects.toThrow(/company_name/);
    });

    it("names the rule a value broke", async () => {
      failsWith(
        {
          code: "23514",
          message: 'new row violates check constraint "ctc_range_ascends"',
          details: null,
        },
        400,
      );

      await expect(repo().saveDraft(values)).rejects.toThrow(/ctc_range_ascends/);
    });

    it("keeps the underlying failure attached, so support can see it", async () => {
      failsWith({ code: "XX000", message: "deadlock detected", details: null }, 500);

      await expect(repo().saveDraft(values)).rejects.toThrow(/deadlock detected/);
    });
  });
});
