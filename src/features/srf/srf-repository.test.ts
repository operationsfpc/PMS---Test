import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseSrfRepository, type SrfSubmitError } from "./srf-repository";
import { SRF_DEFAULTS, type SrfSubmission } from "./srf-schema";

/**
 * Verifies the request the adapter actually sends to PostgREST, and how it
 * translates database errors into something a student can act on.
 *
 * Submitting is now ONE call to `submit_srf` (0028), not four writes. It used
 * to insert the marksheet rows, update the student, delete the semester lines
 * and insert the new ones as four separate requests - and PostgREST gives each
 * its own transaction, so a failure part-way through committed the earlier
 * ones. The live database was found holding a student row that said
 * `srf_submitted` while the student was being told submission had failed.
 *
 * So the assertions here changed shape: what used to be checked as "the body
 * of the PATCH" is now checked as "the payload of the call", and the writes
 * that used to be ordered by this code are ordered inside the function. The
 * transaction itself is tested where it lives, in
 * `src/db/srf-atomic-submission.test.ts`.
 */

const BASE = "https://project.supabase.co";
const USER = "40000000-0000-0000-0000-000000000001";
const RPC = `${BASE}/rest/v1/rpc/submit_srf`;

interface SubmitPayload {
  p_student: Record<string, unknown>;
  p_semesters: Array<Record<string, unknown>>;
  p_documents: Array<Record<string, unknown>>;
  p_certificates: Array<Record<string, unknown>>;
}

beforeEach(() => {
  server.use(
    // Submitting resolves the student's own id BEFORE it writes anything: the
    // storage policy checks that the first path segment is that id.
    http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json({ id: "student-1" })),
    http.patch(`${BASE}/rest/v1/students`, () => HttpResponse.json({ id: "student-1" })),
    http.post(RPC, () =>
      HttpResponse.json({ student_id: "student-1", srf_status: "srf_submitted" }),
    ),
  );
});

/** Records the single payload the submission sends. */
function captureSubmit(
  respond: () => Response = () =>
    HttpResponse.json({ student_id: "student-1", srf_status: "srf_submitted" }),
) {
  const calls: SubmitPayload[] = [];
  server.use(
    http.post(RPC, async ({ request }) => {
      calls.push((await request.json()) as SubmitPayload);
      return respond();
    }),
  );
  return calls;
}

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

  it("declares each upload with its kind and its size", async () => {
    const calls = captureSubmit();

    await repo().submit(values);

    expect(calls[0]?.p_documents.map((d) => d.kind)).toEqual([
      "tenth_marksheet",
      "twelfth_marksheet",
      "semester_marksheet",
      "semester_marksheet",
    ]);
    expect(calls[0]?.p_documents.every((d) => (d.size_bytes as number) > 0)).toBe(true);
  });

  /**
   * The document rows do not exist yet when this payload is built - they are
   * inserted inside the transaction - so the semester lines point at their
   * SLOT, and the function resolves it. Previously the client inserted the
   * documents itself just to learn their ids, which is precisely why a failed
   * submission left orphaned rows behind: 34 of them for one student.
   */
  it("links each semester line to the marksheet that evidences it", async () => {
    const calls = captureSubmit();

    await repo().submit(values);

    expect(calls[0]?.p_documents.map((d) => d.slot)).toEqual([
      "tenth",
      "twelfth",
      "semester-1",
      "semester-2",
    ]);
    expect(calls[0]?.p_semesters[0]?.marksheet_slot).toBe("semester-1");
    expect(calls[0]?.p_semesters[1]?.marksheet_slot).toBe("semester-2");
  });

  it("records a postgraduate's consolidated UG marksheet on the student", async () => {
    const calls = captureSubmit();

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

    expect(calls[0]?.p_documents.map((d) => d.kind)).toContain("ug_consolidated_marksheet");
    expect(calls[0]?.p_student.ug_marksheet_slot).toBe("ug_consolidated");
  });

  /**
   * Ordering is a correctness rule, not a preference. If the form reached the
   * queue first and the upload then failed, a coordinator would be asked to
   * verify figures against documents that do not exist.
   */
  it("stores the evidence before the form enters the verification queue", async () => {
    const order: string[] = [];
    const { client } = storageStub();
    const upload = client.storage.from;
    client.storage.from = ((bucket: string) => {
      order.push("upload");
      return upload(bucket);
    }) as unknown as typeof client.storage.from;
    server.use(
      http.post(RPC, () => {
        order.push("submit");
        return HttpResponse.json({ student_id: "student-1", srf_status: "srf_submitted" });
      }),
    );

    await createSupabaseSrfRepository(client, async () => USER).submit(values);

    expect(order.at(-1)).toBe("submit");
    expect(order.filter((o) => o === "upload")).toHaveLength(4);
  });

  it("leaves the form unsubmitted when an upload fails", async () => {
    const calls = captureSubmit();

    await expect(repo(USER, { uploadFails: true }).submit(values)).rejects.toThrow(
      /could not upload/i,
    );

    expect(calls).toHaveLength(0);
  });

  it("refuses to submit a form that is missing evidence for a declared figure", async () => {
    // Belt and braces with the schema: a repository that trusted its caller
    // would let any other code path put an unverifiable form in the queue.
    await expect(repo().submit({ ...values, marksheets: {} })).rejects.toThrow(/marksheet/i);
  });
});

/**
 * Semester lines live in their own table, and are replaced wholesale rather
 * than merged: the form shows the student's whole record, so what is on screen
 * must be what ends up stored. Merging would silently keep a line the student
 * deleted.
 */
describe("semester-wise academics", () => {
  it("sends the whole record, so what is stored is what is on screen", async () => {
    const calls = captureSubmit();

    await repo().submit(values);

    expect(calls[0]?.p_semesters).toHaveLength(2);
    expect(calls[0]?.p_semesters[1]).toMatchObject({
      semester_number: 2,
      cgpa: 8.24,
      current_arrears: 1,
      history_of_arrears: 2,
    });
  });

  /**
   * The heart of 0028. Four requests meant four transactions, and the third
   * one failing left the first two committed - a student row saying
   * `srf_submitted` with no semester lines under it, which a coordinator
   * cannot tell apart from a complete form.
   */
  it("submits in a single call, so a failure can leave nothing behind", async () => {
    const calls = captureSubmit();
    const writes: string[] = [];
    server.use(
      http.patch(`${BASE}/rest/v1/students`, () => {
        writes.push("patch students");
        return HttpResponse.json({ id: "student-1" });
      }),
      http.delete(`${BASE}/rest/v1/student_semesters`, () => {
        writes.push("delete semesters");
        return HttpResponse.json([]);
      }),
      http.post(`${BASE}/rest/v1/student_semesters`, () => {
        writes.push("insert semesters");
        return HttpResponse.json([]);
      }),
      http.post(`${BASE}/rest/v1/student_documents`, () => {
        writes.push("insert documents");
        return HttpResponse.json([]);
      }),
    );

    await repo().submit(values);

    expect(calls).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  it("records a postgraduate's completed UG aggregate on the student", async () => {
    const calls = captureSubmit();

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

    expect(calls[0]?.p_student.programme_level).toBe("pg");
    expect(calls[0]?.p_student.ug_aggregate_cgpa).toBe(7.85);
  });

  /**
   * The live failure, UAT 2026-08-05. Eight submissions in a row died on a 409
   * from the semester insert and the student was told "Could not submit your
   * form. Please try again." eight times. Trying again was the one thing that
   * could never work.
   *
   * 0027 gives the delete a policy, so the ordinary re-submit now clears the
   * old lines first. What can still collide is a line a COORDINATOR has
   * verified, which the student is deliberately not allowed to remove - and
   * that has an answer the student can act on, so say it.
   */
  it("explains a semester line the student is no longer allowed to replace", async () => {
    captureSubmit(() =>
      HttpResponse.json(
        {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "student_semesters_student_id_semester_number_key"',
        },
        { status: 409 },
      ),
    );

    await expect(repo().submit(values)).rejects.toThrow(/placement coordinator/i);
  });
});

describe("createSupabaseSrfRepository", () => {
  it("returns the id and status the database settled on", async () => {
    const result = await repo().submit(values);

    expect(result).toEqual({ id: "student-1", status: "srf_submitted" });
  });

  /**
   * Stronger than the scoping it replaces. The call used to carry
   * `auth_user_id=eq.<uuid>` and trust PostgREST to filter; now it carries no
   * identity at all and the function reads it from the session, so a tampered
   * payload has nothing to tamper with.
   */
  it("names no student in the payload - the session decides whose form this is", async () => {
    const calls = captureSubmit();

    await repo().submit(values);

    for (const forbidden of ["id", "student_id", "auth_user_id"]) {
      expect(calls[0]?.p_student[forbidden]).toBeUndefined();
    }
    expect(calls[0]?.p_documents.every((d) => d.student_id === undefined)).toBe(true);
  });

  it("stores blank optional fields as null, not empty strings", async () => {
    const calls = captureSubmit();

    await repo().submit(values);

    expect(calls[0]?.p_student.whatsapp).toBeNull();
  });

  it("never sends a field the student does not own", async () => {
    const calls = captureSubmit();

    await repo().submit(values);

    // The function names the columns it writes and the DB guard backs it up;
    // not sending these means the student never sees a confusing permission
    // error either.
    for (const forbidden of ["roll_number", "campus_id", "participation_status", "overall_cgpa"]) {
      expect(calls[0]?.p_student[forbidden]).toBeUndefined();
    }
  });

  it("refuses to submit without a session", async () => {
    await expect(repo(null).submit(values)).rejects.toThrow(/session has expired/i);
  });

  describe("translates database errors into student-readable prose", () => {
    const failWith = (status: number, payload: Record<string, string>) =>
      server.use(http.post(RPC, () => HttpResponse.json(payload, { status })));

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

    /** The function raises this itself when the session has no student row. */
    it("explains the same when the function refuses for want of a student", async () => {
      failWith(400, { code: "P0002", message: "We could not find your student record." });
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
 *
 * Clearing the draft on submission is now the function's job, inside the same
 * transaction - see `src/db/srf-atomic-submission.test.ts`. Doing it from here
 * was a fifth write that could succeed while the submission failed.
 */
describe("saving a draft", () => {
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

/**
 * F17 (UAT 2026-08-06): "Name of certificate + upload certificate."
 *
 * The document goes to storage; the certificate travels in the SAME rpc call
 * as everything else the form declares. A form claiming a certificate it has
 * no document for is exactly the half-submission `submit_srf` exists to
 * prevent.
 */
describe("createSupabaseSrfRepository \u2014 certificates", () => {
  const withCertificates = (): SrfSubmission => ({
    ...values,
    certificates: [{ name: "AWS Cloud Practitioner", file: sheet("aws.pdf") }],
  });

  it("uploads the certificate and names it in the submission", async () => {
    const calls = captureSubmit();
    const { client, uploads } = storageStub();

    await createSupabaseSrfRepository(client, async () => USER).submit(withCertificates());

    expect(uploads.some((u) => u.path.includes("aws.pdf"))).toBe(true);

    const payload = calls[0] as SubmitPayload;
    expect(payload.p_certificates).toEqual([
      { name: "AWS Cloud Practitioner", document_slot: "certificate-0" },
    ]);
    expect(
      payload.p_documents.some((d) => d.slot === "certificate-0" && d.kind === "certificate"),
    ).toBe(true);
  });

  it("sends an empty list when the student has none", async () => {
    const calls = captureSubmit();

    await repo().submit({ ...values, certificates: [] });

    expect((calls[0] as SubmitPayload).p_certificates).toEqual([]);
  });

  /** A certificate row pointing at a document that is not there helps nobody. */
  it("submits nothing when a certificate cannot be uploaded", async () => {
    const calls = captureSubmit();

    await expect(repo(USER, { uploadFails: true }).submit(withCertificates())).rejects.toThrow();

    expect(calls).toHaveLength(0);
  });
});
