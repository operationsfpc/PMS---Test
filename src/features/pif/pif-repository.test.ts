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

/**
 * F11 and F12 (UAT 2026-08-06).
 *
 * The AE declares the cutoff on the recruiter's own scale and says how many
 * rounds there are. Both have to survive the trip to the database, and the
 * cutoff has to arrive on the ONE scale every eligibility rule compares
 * against.
 */
describe("createSupabasePifRepository — eligibility scale and rounds", () => {
  const capture = async (input: PifFormValues) => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/drives`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "d1", status: "submitted" });
      }),
    );
    await repo().submit(input);
    return body;
  };

  it("stores a CGPA cutoff untouched", async () => {
    const body = await capture({ ...values, minOverallCgpa: 7.5, minOverallCgpaScale: "cgpa" });

    expect(body.min_overall_cgpa).toBe(7.5);
    expect(body.min_overall_cgpa_scale).toBe("cgpa");
    expect(body.min_overall_marks).toBe(7.5);
  });

  /**
   * `min_overall_cgpa` is what R5 filters on, and it is a 10-point column with
   * a check constraint. Sending 65 into it would either be refused or, worse,
   * silently exclude the whole cohort.
   */
  it("normalises a percentage cutoff to the scale every drive is filtered on", async () => {
    const body = await capture({
      ...values,
      minOverallCgpa: 65,
      minOverallCgpaScale: "percentage",
    });

    expect(body.min_overall_cgpa).toBe(6.84);
  });

  /** The AE typed 65%. A coordinator checking the PIF must see 65%, not 6.84. */
  it("keeps what the AE actually typed, beside the converted figure", async () => {
    const body = await capture({
      ...values,
      minOverallCgpa: 65,
      minOverallCgpaScale: "percentage",
    });

    expect(body.min_overall_marks).toBe(65);
    expect(body.min_overall_cgpa_scale).toBe("percentage");
  });

  it("sends no cutoff at all when the recruiter set none", async () => {
    const body = await capture({ ...values, minOverallCgpa: null });

    expect(body.min_overall_cgpa).toBeNull();
    expect(body.min_overall_marks).toBeNull();
  });

  /** The list IS the count now, so the two cannot disagree. */
  it("derives the round count from the rounds the AE named", async () => {
    const body = await capture({
      ...values,
      rounds: [
        { sequence: 1, name: "Aptitude test" },
        { sequence: 2, name: "Technical interview" },
        { sequence: 3, name: "HR" },
        { sequence: 4, name: "Offer discussion" },
      ],
    });

    expect(body.round_count).toBe(4);
  });

  it("carries the other designations this one interview process covers", async () => {
    const body = await capture({
      ...values,
      additionalDesignations: ["Associate Engineer", "Trainee Engineer"],
    });

    expect(body.additional_designations).toEqual(["Associate Engineer", "Trainee Engineer"]);
  });
});

/**
 * The AE's named rounds become the drive's rounds (2026-08-18).
 *
 * "the drive round shown in PIF should get auto populated in drives shown in
 * live/published drives with an ability to be edited. these are logical rounds
 * to which students can progress."
 *
 * Before this, the AE stated a count and the Central CPC created the rounds by
 * hand on a different screen - so a drive declared as three rounds could go
 * live with none, and nobody could be advanced past round one.
 */
describe("createSupabasePifRepository — the rounds reach the drive", () => {
  const ACTOR = AE;

  /** MSW standing in for both writes: the drive, then its rounds. */
  const clientCapturing = ({
    rounds,
    failRounds = false,
  }: {
    rounds: Array<Record<string, unknown>>;
    failRounds?: boolean;
  }) => {
    server.use(
      http.post(`${BASE}/rest/v1/drives`, () =>
        HttpResponse.json({ id: "drive-1", status: "submitted" }),
      ),
      http.post(`${BASE}/rest/v1/drive_rounds`, async ({ request }) => {
        if (failRounds) {
          return HttpResponse.json({ message: "nope", code: "42501" }, { status: 403 });
        }
        const body = (await request.json()) as
          | Record<string, unknown>
          | Array<Record<string, unknown>>;
        rounds.push(...(Array.isArray(body) ? body : [body]));
        return HttpResponse.json([]);
      }),
    );

    return createClient(BASE, "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  };

  it("writes one drive_round per round the AE named, in order", async () => {
    const rounds: Array<Record<string, unknown>> = [];
    const client = clientCapturing({ rounds });

    await createSupabasePifRepository(client, async () => ACTOR).submit({
      ...values,
      rounds: [
        { sequence: 1, name: "Aptitude test" },
        { sequence: 2, name: "Technical interview" },
      ],
    });

    expect(rounds).toEqual([
      { drive_id: "drive-1", sequence: 1, name: "Aptitude test" },
      { drive_id: "drive-1", sequence: 2, name: "Technical interview" },
    ]);
  });

  it("writes none when a draft has none yet", async () => {
    const rounds: Array<Record<string, unknown>> = [];
    const client = clientCapturing({ rounds });

    await createSupabasePifRepository(client, async () => ACTOR).saveDraft({
      ...values,
      rounds: [],
    });

    expect(rounds).toEqual([]);
  });

  /**
   * The drive is the thing that matters. A rounds insert that fails leaves a
   * PIF the AE can see and the Central CPC can complete - losing the whole
   * submission over it would be worse, and the publish screen shows what is
   * there.
   */
  it("does not lose the PIF when the rounds cannot be written", async () => {
    const client = clientCapturing({ rounds: [], failRounds: true });

    await expect(
      createSupabasePifRepository(client, async () => ACTOR).submit({
        ...values,
        rounds: [{ sequence: 1, name: "Aptitude test" }],
      }),
    ).resolves.toMatchObject({ id: "drive-1" });
  });
});
