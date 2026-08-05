import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseSrfRepository, type SrfSubmitError } from "./srf-repository";
import { SRF_DEFAULTS, type SrfSubmission } from "./srf-schema";

/**
 * Verifies the request the adapter actually sends to PostgREST, and how it
 * translates database errors into something a student can act on.
 */

const BASE = "https://project.supabase.co";
const USER = "40000000-0000-0000-0000-000000000001";

/**
 * Submitting writes the student row AND their semester lines. Tests that care
 * about the student row still have to let the semester writes through, or MSW
 * fails them for an unhandled request that has nothing to do with what they
 * are asserting.
 */
beforeEach(() => {
  server.use(
    // Submitting now resolves the student's own id BEFORE it writes anything,
    // so that evidence can be stored before the form enters the queue.
    http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json({ id: "student-1" })),
    http.patch(`${BASE}/rest/v1/students`, () =>
      HttpResponse.json({ id: "student-1", srf_status: "srf_submitted" }),
    ),
    http.delete(`${BASE}/rest/v1/student_semesters`, () => HttpResponse.json([])),
    http.post(`${BASE}/rest/v1/student_semesters`, () => HttpResponse.json([])),
    http.post(`${BASE}/rest/v1/student_documents`, async ({ request }) => {
      const rows = (await request.json()) as Array<Record<string, unknown>>;
      return HttpResponse.json(rows.map((row, i) => ({ ...row, id: `doc-${i + 1}` })));
    }),
  );
});

/**
 * Storage is stubbed at the client, not over HTTP: supabase-js signs and
 * chunks uploads, and none of that is what these tests are about.
 */
function storageStub(opts: { uploadFails?: boolean } = {}) {
  const client = createClient(BASE, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const uploads: { bucket: string; path: string; size: number }[] = [];

  client.storage.from = ((bucket: string) => ({
    upload: async (path: string, file: File) => {
      uploads.push({ bucket, path, size: file.size });
      return opts.uploadFails === true
        ? { data: null, error: new Error("network") }
        : { data: { path }, error: null };
    },
  })) as unknown as typeof client.storage.from;

  return { client, uploads };
}

const repo = (userId: string | null = USER, opts: { uploadFails?: boolean } = {}) =>
  createSupabaseSrfRepository(storageStub(opts).client, async () => userId);

/** A picked file, as the browser hands it to us. */
const sheet = (name: string) => new File(["scan-bytes"], name, { type: "application/pdf" });

/** Records what a draft save actually sends. */
function captureDraftWrites() {
  const writes: { body: unknown; search: string }[] = [];
  server.use(
    http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
      writes.push({ body: await request.clone().json(), search: new URL(request.url).search });
      return HttpResponse.json({ id: "s1" });
    }),
  );
  return writes;
}

const values: SrfSubmission = {
  ...SRF_DEFAULTS,
  mobile: "9876543210",
  whatsapp: "",
  tenthInstitution: "St Xavier's, Chennai",
  tenthPercentage: 91.4,
  twelfthInstitution: "St Xavier's, Chennai",
  twelfthPercentage: 88,
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  programmeLevel: "ug",
  ugAggregate: null,
  semesters: [
    {
      semesterNumber: 1,
      marks: 8.1,
      currentArrears: 0,
      historyOfArrears: 0,
    },
    {
      semesterNumber: 2,
      marks: 8.24,
      currentArrears: 1,
      historyOfArrears: 2,
    },
  ],
  marksheets: {
    tenth: sheet("10th.pdf"),
    twelfth: sheet("12th.pdf"),
    "semester-1": sheet("sem1.pdf"),
    "semester-2": sheet("sem2.pdf"),
  },
  roleCategories: ["software_technical"],
  resumeCategories: ["software_technical"],
  consent: true,
} as SrfSubmission;

/**
 * Marksheet evidence — the reason verification exists.
 *
 * The SRF marked these uploads required, let the student pick their files, and
 * discarded every one. Nothing reached storage, nothing was recorded, and
 * `student_semesters.marksheet_id` — the column built for exactly this — was
 * never written. A coordinator opening the queue saw a declared CGPA and no
 * document, which makes "verified" a signature on the student's own typing.
 */
describe("marksheet evidence", () => {
  it("uploads every marksheet into the student's own folder", async () => {
    const { client, uploads } = storageStub();

    await createSupabaseSrfRepository(client, async () => USER).submit(values);

    expect(uploads).toHaveLength(4);
    expect(uploads.every((u) => u.bucket === "marksheets")).toBe(true);
    // The storage policy checks the first path segment is the student's id.
    expect(uploads.every((u) => u.path.startsWith("student-1/"))).toBe(true);
  });

  it("names each object uniquely, so re-uploading never collides", async () => {
    const { client, uploads } = storageStub();

    await createSupabaseSrfRepository(client, async () => USER).submit(values);

    expect(new Set(uploads.map((u) => u.path)).size).toBe(4);
  });

  it("records each upload against the student with its kind", async () => {
    let rows: Array<Record<string, unknown>> = [];
    server.use(
      http.post(`${BASE}/rest/v1/student_documents`, async ({ request }) => {
        rows = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(rows.map((row, i) => ({ ...row, id: `doc-${i + 1}` })));
      }),
    );

    await repo().submit(values);

    expect(rows.map((r) => r.kind)).toEqual([
      "tenth_marksheet",
      "twelfth_marksheet",
      "semester_marksheet",
      "semester_marksheet",
    ]);
    expect(rows.every((r) => r.student_id === "student-1")).toBe(true);
    expect(rows.every((r) => (r.size_bytes as number) > 0)).toBe(true);
  });

  /** The whole point: each declared line points at the document proving it. */
  it("links each semester row to the marksheet that evidences it", async () => {
    let inserted: Array<Record<string, unknown>> = [];
    server.use(
      http.post(`${BASE}/rest/v1/student_documents`, async ({ request }) => {
        const rows = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(
          rows.map((row) => ({
            ...row,
            id: `doc-for-${String(row.storage_path).split("-").pop()}`,
          })),
        );
      }),
      http.post(`${BASE}/rest/v1/student_semesters`, async ({ request }) => {
        inserted = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(inserted);
      }),
    );

    await repo().submit(values);

    expect(inserted[0]?.marksheet_id).toBe("doc-for-sem1.pdf");
    expect(inserted[1]?.marksheet_id).toBe("doc-for-sem2.pdf");
  });

  it("records a postgraduate's consolidated UG marksheet on the student", async () => {
    let kinds: unknown[] = [];
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/student_documents`, async ({ request }) => {
        const rows = (await request.json()) as Array<Record<string, unknown>>;
        kinds = rows.map((r) => r.kind);
        return HttpResponse.json(rows.map((row, i) => ({ ...row, id: `doc-${i + 1}` })));
      }),
      http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "student-1", srf_status: "srf_submitted" });
      }),
    );

    await repo().submit({
      ...values,
      programmeLevel: "pg",
      ugAggregate: 7.85,
      semesters: [values.semesters[0] as (typeof values.semesters)[number]],
      marksheets: {
        tenth: sheet("10th.pdf"),
        twelfth: sheet("12th.pdf"),
        ug_consolidated: sheet("ug.pdf"),
        "semester-1": sheet("sem1.pdf"),
      },
    });

    expect(kinds).toContain("ug_consolidated_marksheet");
    expect(body.ug_marksheet_id).toEqual(expect.any(String));
  });

  /**
   * Ordering is a correctness rule, not a preference. If the form reached the
   * queue first and the upload then failed, a coordinator would be asked to
   * verify figures against documents that do not exist.
   */
  it("stores the evidence before the form enters the verification queue", async () => {
    const order: string[] = [];
    server.use(
      http.post(`${BASE}/rest/v1/student_documents`, async ({ request }) => {
        order.push("documents");
        const rows = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(rows.map((row, i) => ({ ...row, id: `doc-${i + 1}` })));
      }),
      http.patch(`${BASE}/rest/v1/students`, () => {
        order.push("submit");
        return HttpResponse.json({ id: "student-1", srf_status: "srf_submitted" });
      }),
    );

    await repo().submit(values);

    expect(order).toEqual(["documents", "submit"]);
  });

  it("leaves the form unsubmitted when an upload fails", async () => {
    let submitted = false;
    server.use(
      http.patch(`${BASE}/rest/v1/students`, () => {
        submitted = true;
        return HttpResponse.json({ id: "student-1", srf_status: "srf_submitted" });
      }),
    );

    await expect(repo(USER, { uploadFails: true }).submit(values)).rejects.toThrow(
      /could not upload/i,
    );
    expect(submitted).toBe(false);
  });

  it("refuses to submit a form that is missing evidence for a declared figure", async () => {
    // Belt and braces with the schema: a repository that trusted its caller
    // would let any other code path put an unverifiable form in the queue.
    await expect(repo().submit({ ...values, marksheets: {} })).rejects.toThrow(/marksheet/i);
  });
});

/**
 * Semester lines are their own table, so submitting the SRF writes twice.
 * They are replaced wholesale rather than merged: the form shows the student's
 * whole record, so what is on screen must be what ends up stored.
 */
describe("semester-wise academics", () => {
  it("replaces the student's semester rows with what was submitted", async () => {
    let deleted = false;
    let inserted: Array<Record<string, unknown>> = [];
    server.use(
      http.patch(`${BASE}/rest/v1/students`, () =>
        HttpResponse.json({ id: "s1", srf_status: "srf_submitted" }),
      ),
      http.delete(`${BASE}/rest/v1/student_semesters`, () => {
        deleted = true;
        return HttpResponse.json([]);
      }),
      http.post(`${BASE}/rest/v1/student_semesters`, async ({ request }) => {
        inserted = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(inserted);
      }),
    );

    await repo().submit(values);

    expect(deleted).toBe(true);
    expect(inserted).toHaveLength(2);
    expect(inserted[1]).toMatchObject({
      semester_number: 2,
      cgpa: 8.24,
      current_arrears: 1,
      history_of_arrears: 2,
    });
  });

  /**
   * The live failure, UAT 2026-08-05. Eight submissions in a row died on a
   * 409 from `POST /rest/v1/student_semesters` and the student was told
   * "Could not submit your form. Please try again." eight times. Trying again
   * was the one thing that could never work.
   *
   * 0027 gives the delete a policy, so the ordinary re-submit now clears the
   * old lines first. What can still collide is a line a COORDINATOR has
   * verified, which the student is deliberately not allowed to remove - and
   * that has an answer the student can act on, so say it.
   */
  it("explains a semester line the student is no longer allowed to replace", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/student_semesters`, () =>
        HttpResponse.json(
          {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "student_semesters_student_id_semester_number_key"',
          },
          { status: 409 },
        ),
      ),
    );

    await expect(repo().submit(values)).rejects.toThrow(/placement coordinator/i);
  });

  /**
   * The delete's result was thrown away entirely. That is precisely how this
   * shipped: RLS filtered it to nothing, PostgREST answered 204, and the code
   * walked into an insert that could not succeed. A clear-out that did not
   * clear anything must stop the submission, not feed it.
   */
  it("stops when the old lines could not be cleared, rather than colliding with them", async () => {
    let inserted = false;
    server.use(
      http.delete(`${BASE}/rest/v1/student_semesters`, () =>
        HttpResponse.json({ code: "42501", message: "permission denied" }, { status: 403 }),
      ),
      http.post(`${BASE}/rest/v1/student_semesters`, () => {
        inserted = true;
        return HttpResponse.json([]);
      }),
    );

    await expect(repo().submit(values)).rejects.toThrow(/placement coordinator/i);
    expect(inserted).toBe(false);
  });

  it("records a postgraduate's completed UG aggregate on the student", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "s1", srf_status: "srf_submitted" });
      }),
      http.delete(`${BASE}/rest/v1/student_semesters`, () => HttpResponse.json([])),
      http.post(`${BASE}/rest/v1/student_semesters`, () => HttpResponse.json([])),
    );

    await repo().submit({
      ...values,
      programmeLevel: "pg",
      ugAggregate: 7.85,
      semesters: [values.semesters[0] as (typeof values.semesters)[number]],
      // A postgraduate must evidence the degree behind them too (A31).
      marksheets: {
        tenth: sheet("10th.pdf"),
        twelfth: sheet("12th.pdf"),
        ug_consolidated: sheet("ug.pdf"),
        "semester-1": sheet("sem1.pdf"),
      },
    });

    expect(body.programme_level).toBe("pg");
    expect(body.ug_aggregate_cgpa).toBe(7.85);
  });
});

describe("createSupabaseSrfRepository", () => {
  it("updates the student's own pre-loaded row rather than inserting one", async () => {
    let method: string | undefined;
    let query: string | undefined;
    let body: Record<string, unknown> | undefined;

    server.use(
      http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
        method = request.method;
        query = new URL(request.url).search;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "student-1", srf_status: "srf_submitted" });
      }),
    );

    const result = await repo().submit(values);

    expect(method).toBe("PATCH");
    // Scoped to the signed-in user, so it can never touch another student.
    expect(query).toContain(`auth_user_id=eq.${USER}`);
    expect(result).toEqual({ id: "student-1", status: "srf_submitted" });
    expect(body?.srf_status).toBe("srf_submitted");
  });

  it("records consent at submission (PRD §4.1)", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "s", srf_status: "srf_submitted" });
      }),
    );

    await repo().submit(values);

    expect(body?.consent_given_at).toEqual(expect.any(String));
  });

  it("stores blank optional fields as null, not empty strings", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "s", srf_status: "srf_submitted" });
      }),
    );

    await repo().submit(values);

    expect(body?.whatsapp).toBeNull();
    expect(body?.github).toBeUndefined();
    expect(body?.github_url).toBeNull();
  });

  it("never sends fields the student is forbidden to change", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "s", srf_status: "srf_submitted" });
      }),
    );

    await repo().submit(values);

    // The DB guard would reject these anyway; not sending them means the
    // student never sees a confusing permission error.
    for (const forbidden of ["roll_number", "campus_id", "participation_status", "auth_user_id"]) {
      expect(body[forbidden]).toBeUndefined();
    }
  });

  it("refuses to submit without a session", async () => {
    await expect(repo(null).submit(values)).rejects.toThrow(/session has expired/i);
  });

  describe("translates database errors into student-readable prose", () => {
    const failWith = (status: number, payload: Record<string, string>) =>
      server.use(
        http.patch(`${BASE}/rest/v1/students`, () => HttpResponse.json(payload, { status })),
      );

    it("explains an arrear-consistency violation", async () => {
      failWith(400, {
        code: "23514",
        message: 'new row violates check constraint "arrears_consistent"',
      });
      await expect(repo().submit(values)).rejects.toThrow(/arrear history cannot be lower/i);
    });

    it("explains a CGPA scale violation", async () => {
      failWith(400, {
        code: "23514",
        message: 'violates check constraint "students_overall_cgpa_check"',
      });
      await expect(repo().submit(values)).rejects.toThrow(/10-point scale/i);
    });

    it("explains a missing student record", async () => {
      failWith(406, { code: "PGRST116", message: "0 rows" });
      await expect(repo().submit(values)).rejects.toThrow(/could not find your student record/i);
    });

    it("stays generic for anything else, leaking no internals", async () => {
      failWith(500, { code: "XX000", message: "relation pg_catalog.secret does not exist" });

      let error: SrfSubmitError | undefined;
      try {
        await repo().submit(values);
      } catch (e) {
        error = e as SrfSubmitError;
      }

      expect(error?.message).toBe("Could not submit your form. Please try again.");
      expect(error?.message).not.toContain("pg_catalog");
    });
  });
});

/**
 * Draft saving, requested from UAT 2026-08-05.
 *
 * A draft is a convenience: it must never move the form forward, never touch
 * a verified column, and never fail loudly enough to interrupt someone who is
 * mid-sentence. All three are asserted here.
 */
describe("saving a draft", () => {
  /**
   * Otherwise the next visit restores a draft of a form already submitted,
   * and the student edits a copy that no longer means anything.
   */
  it("is cleared when the form is finally submitted", async () => {
    const writes = captureDraftWrites();

    await repo().submit(values);

    expect(writes[0]?.body).toMatchObject({ srf_draft: null, srf_draft_saved_at: null });
  });

  it("writes the values against the signed-in student, with the time", async () => {
    const writes = captureDraftWrites();

    await repo().saveDraft({ mobile: "9876543210" });

    expect(writes[0]?.body).toMatchObject({ srf_draft: { mobile: "9876543210" } });
    expect(writes[0]?.body).toMatchObject({ srf_draft_saved_at: expect.any(String) });
    expect(writes[0]?.search).toContain(`auth_user_id=eq.${USER}`);
  });

  it("never moves the form forward - that is what submitting is for", async () => {
    const writes = captureDraftWrites();

    await repo().saveDraft({ mobile: "9876543210" });

    expect(writes[0]?.body).not.toHaveProperty("srf_status");
    expect(writes[0]?.body).not.toHaveProperty("tenth_percentage");
  });

  /**
   * Auto-save runs while the student is typing. A failed save must never throw
   * into their session: the worst honest outcome is that this attempt is lost
   * and the next one succeeds.
   */
  it("swallows a failure rather than interrupting the student", async () => {
    server.use(
      http.patch(`${BASE}/rest/v1/students`, () => new HttpResponse(null, { status: 500 })),
    );

    await expect(repo().saveDraft({ mobile: "9876543210" })).resolves.toBe(false);
  });

  it("says it saved when it did", async () => {
    captureDraftWrites();

    await expect(repo().saveDraft({ mobile: "9876543210" })).resolves.toBe(true);
  });

  it("does not try to save for a student with no session", async () => {
    const writes = captureDraftWrites();
    const anonymous = repo(null);

    await expect(anonymous.saveDraft({ mobile: "9876543210" })).resolves.toBe(false);
    expect(writes).toHaveLength(0);
  });
});
