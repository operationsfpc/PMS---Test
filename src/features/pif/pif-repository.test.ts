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
  contacts: [{ name: "R Karthik", designation: "TA Lead", email: "karthik@zoho.com", phone: "" }],
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

/**
 * Storage is stubbed at the client, not over HTTP: supabase-js signs and
 * chunks uploads, and none of that is what these tests are about.
 */
function storageStub(opts: { uploadFails?: boolean } = {}) {
  const client = createClient(BASE, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const uploads: { bucket: string; path: string; size: number; contentType?: string }[] = [];

  client.storage.from = ((bucket: string) => ({
    upload: async (path: string, file: File, options?: { contentType?: string }) => {
      uploads.push({ bucket, path, size: file.size, ...options });
      return opts.uploadFails === true
        ? { data: null, error: new Error("network") }
        : { data: { path }, error: null };
    },
  })) as unknown as typeof client.storage.from;

  return { client, uploads };
}

/** The recruiter's JD, as the browser hands it over. */
const jdFile = (name = "Zoho-GET-JD.pdf") =>
  new File([new Uint8Array(2048)], name, { type: "application/pdf" });

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

  /** A4 (UAT 2026-08-19): the contacts land in their own table, in order. */
  it("writes the contacts to drive_contacts, numbered in order", async () => {
    const contactRows: Array<Record<string, unknown>> = [];
    server.use(
      http.post(`${BASE}/rest/v1/drives`, () => HttpResponse.json({ id: "d1", status: "draft" })),
      http.post(`${BASE}/rest/v1/drive_contacts`, async ({ request }) => {
        const rows = (await request.json()) as Array<Record<string, unknown>>;
        contactRows.push(...rows);
        return HttpResponse.json(rows);
      }),
    );

    await repo().saveDraft({
      ...values,
      contacts: [
        { name: "R Karthik", designation: "TA Lead", email: "karthik@zoho.com", phone: "" },
        { name: "Meena S", designation: "", email: "", phone: "9840012345" },
      ],
    });

    expect(contactRows).toEqual([
      {
        drive_id: "d1",
        sequence: 1,
        name: "R Karthik",
        designation: "TA Lead",
        email: "karthik@zoho.com",
        phone: null,
      },
      {
        drive_id: "d1",
        sequence: 2,
        name: "Meena S",
        designation: null,
        email: null,
        phone: "9840012345",
      },
    ]);
  });

  /**
   * B1 (UAT 2026-08-19): "Once a drive is submitted/published, it should
   * disappear from the drafts list. Currently the draft remains visible even
   * after going live."
   *
   * Root cause: every save INSERTED a fresh row. Save-draft-then-submit left
   * TWO drives behind — the submission travelled the pipeline and the
   * abandoned draft sat in "Yet to publish" forever, on the AE's list, the
   * Delivery Head's and the Central CPC's alike.
   */
  describe("a draft is ONE row for its whole life (B1)", () => {
    it("re-saving a draft updates the same row instead of inserting a second drive", async () => {
      let inserts = 0;
      let patchedId: string | null = null;
      let patchBody: Record<string, unknown> = {};

      server.use(
        http.post(`${BASE}/rest/v1/drives`, () => {
          inserts += 1;
          return HttpResponse.json({ id: "d1", status: "draft" });
        }),
        http.patch(`${BASE}/rest/v1/drives`, async ({ request }) => {
          patchedId = new URL(request.url).searchParams.get("id") ?? null;
          patchBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "d1", status: "draft" });
        }),
      );

      const r = repo();
      const first = await r.saveDraft(values);
      await r.saveDraft({ ...values, roleTitle: "Revised title" }, first.id);

      expect(inserts).toBe(1);
      expect(patchedId).toBe("eq.d1");
      expect(patchBody.role_title).toBe("Revised title");
    });

    it("submitting a saved draft promotes THAT row to submitted — no orphan draft", async () => {
      let inserts = 0;
      let patchBody: Record<string, unknown> = {};

      server.use(
        http.post(`${BASE}/rest/v1/drives`, () => {
          inserts += 1;
          return HttpResponse.json({ id: "d1", status: "draft" });
        }),
        http.patch(`${BASE}/rest/v1/drives`, async ({ request }) => {
          patchBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "d1", status: "submitted" });
        }),
      );

      const r = repo();
      const draft = await r.saveDraft(values);
      const submitted = await r.submit(values, draft.id);

      expect(inserts).toBe(1);
      expect(patchBody.status).toBe("submitted");
      expect(submitted).toEqual({ id: "d1", status: "submitted" });
    });

    it("an update replaces the draft's rounds rather than doubling them", async () => {
      let roundsDeleted = false;
      const roundInserts: Array<Record<string, unknown>> = [];

      server.use(
        http.patch(`${BASE}/rest/v1/drives`, () =>
          HttpResponse.json({ id: "d1", status: "draft" }),
        ),
        http.delete(`${BASE}/rest/v1/drive_rounds`, ({ request }) => {
          roundsDeleted = new URL(request.url).searchParams.get("drive_id") === "eq.d1";
          return HttpResponse.json([]);
        }),
        http.post(`${BASE}/rest/v1/drive_rounds`, async ({ request }) => {
          const rows = (await request.json()) as Array<Record<string, unknown>>;
          roundInserts.push(...rows);
          return HttpResponse.json(rows);
        }),
      );

      await repo().saveDraft({ ...values, rounds: [{ sequence: 1, name: "Aptitude test" }] }, "d1");

      expect(roundsDeleted).toBe(true);
      expect(roundInserts).toEqual([{ drive_id: "d1", sequence: 1, name: "Aptitude test" }]);
    });
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
 * J1/J2/J3 (2026-08-18): the attached JD, the shift and the joining timeline.
 */
describe("createSupabasePifRepository — the JD, the shift and the joining timeline", () => {
  const captureWith = async (
    client: Parameters<typeof createSupabasePifRepository>[0],
    input: PifFormValues,
    mode: "draft" | "submit" = "submit",
  ) => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/drives`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: body.id ?? "d1", status: mode });
      }),
    );
    const repository = createSupabasePifRepository(client, async () => AE);
    await (mode === "draft" ? repository.saveDraft(input) : repository.submit(input));
    return body;
  };

  it("puts the JD in the job-descriptions bucket, under the drive it belongs to", async () => {
    const { client, uploads } = storageStub();

    const body = await captureWith(client, { ...values, jobDescriptionFile: jdFile() });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.bucket).toBe("job-descriptions");
    // The read policy in 0051 asks whether the FIRST path segment is a drive
    // the reader may see, so the folder has to be the drive's own id — which
    // is why the id is generated here rather than by the database.
    expect(uploads[0]?.path.startsWith(`${body.id as string}/`)).toBe(true);
    expect(uploads[0]?.contentType).toBe("application/pdf");
  });

  it("records where the file went, what it is called and how big it is", async () => {
    const { client } = storageStub();

    const body = await captureWith(client, { ...values, jobDescriptionFile: jdFile() });

    expect(body.jd_storage_path).toMatch(new RegExp(`^${body.id as string}/.+\\.pdf$`));
    // The name the recruiter gave it, kept separately: the stored path carries
    // a timestamp so a replacement cannot collide, and "jd-1755500000-…" is
    // not what anyone should be shown.
    expect(body.jd_file_name).toBe("Zoho-GET-JD.pdf");
    expect(body.jd_size_bytes).toBe(2048);
  });

  it("uploads nothing, and stores nothing, when no JD was attached", async () => {
    const { client, uploads } = storageStub();

    const body = await captureWith(client, { ...values, jobDescriptionFile: null });

    expect(uploads).toEqual([]);
    expect(body.jd_storage_path).toBeNull();
    expect(body.jd_file_name).toBeNull();
    expect(body.jd_size_bytes).toBeNull();
  });

  /**
   * The upload runs BEFORE the row, exactly as the SRF's marksheets do. An
   * object with no row costs a few kilobytes; a row with no object hands the
   * Delivery Head and the student a link that opens nothing.
   */
  it("writes no drive at all when the upload fails, and says which part failed", async () => {
    const { client } = storageStub({ uploadFails: true });
    let inserted = false;
    server.use(
      http.post(`${BASE}/rest/v1/drives`, () => {
        inserted = true;
        return HttpResponse.json({ id: "d1", status: "submitted" });
      }),
    );

    await expect(
      createSupabasePifRepository(client, async () => AE).submit({
        ...values,
        jobDescriptionFile: jdFile(),
      }),
    ).rejects.toThrow(/job description/i);
    expect(inserted).toBe(false);
  });

  it("attaches the JD to a draft too — an AE gathers the file before the detail", async () => {
    const { client, uploads } = storageStub();

    await captureWith(client, { ...values, jobDescriptionFile: jdFile() }, "draft");

    expect(uploads).toHaveLength(1);
  });

  it("stores the shift as a value, with the hours only on a night shift", async () => {
    const { client } = storageStub();

    const night = await captureWith(client, {
      ...values,
      shiftType: "night",
      shiftNightTiming: "9.00 pm – 6.00 am",
    });
    expect(night.shift_type).toBe("night");
    expect(night.shift_night_timing).toBe("9.00 pm – 6.00 am");

    // A timing left behind by a switch back to Day is dropped here as well as
    // in the schema: 0051 refuses the pair outright, and the AE would lose the
    // whole PIF to a check constraint.
    const day = await captureWith(client, {
      ...values,
      shiftType: "day",
      shiftNightTiming: "9.00 pm – 6.00 am",
    });
    expect(day.shift_type).toBe("day");
    expect(day.shift_night_timing).toBeNull();
  });

  it("stores the joining choice with only its own comment", async () => {
    const { client } = storageStub();

    const later = await captureWith(client, {
      ...values,
      joiningTimeline: "later",
      joiningImmediateNotes: "Within 30 days",
      joiningLaterNotes: "Offers Nov 2026, joining July 2027",
    });

    expect(later.joining_timeline).toBe("later");
    expect(later.joining_later_notes).toBe("Offers Nov 2026, joining July 2027");
    expect(later.joining_immediate_notes).toBeNull();
  });

  it("leaves the joining columns empty on a draft that has not chosen yet", async () => {
    const { client } = storageStub();

    const body = await captureWith(client, { ...values, joiningTimeline: "" }, "draft");

    expect(body.joining_timeline).toBeNull();
    expect(body.joining_immediate_notes).toBeNull();
    expect(body.joining_later_notes).toBeNull();
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
