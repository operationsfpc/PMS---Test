import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseVerificationRepository, VerificationError } from "./verification-repository";

/**
 * The CPC verification queue against real data.
 *
 * RLS already scopes a coordinator to their own campuses, so the query does
 * not filter by campus - doing so in the client would be a second, weaker copy
 * of a rule the database already enforces.
 */
const BASE = "https://project.supabase.co";
const CPC = "50000000-0000-0000-0000-000000000009";

const repo = () =>
  createSupabaseVerificationRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => CPC,
  );

describe("createSupabaseVerificationRepository", () => {
  describe("pending()", () => {
    it("asks only for forms awaiting verification", async () => {
      let url = "";
      server.use(
        http.get(`${BASE}/rest/v1/students`, ({ request }) => {
          url = request.url;
          return HttpResponse.json([
            { id: "s1", full_name: "Asha R", roll_number: "TEC001", overall_cgpa: 8.2 },
          ]);
        }),
      );

      const rows = await repo().pending();

      expect(url).toContain("srf_status=eq.srf_submitted");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.fullName).toBe("Asha R");
    });
  });

  describe("decide()", () => {
    it("approves by moving the student to srf_approved and stamping the decider", async () => {
      let body: Record<string, unknown> = {};
      server.use(
        http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "s1", srf_status: "srf_approved" });
        }),
      );

      await repo().decide("s1", "srf_submitted", { decision: "approve" });

      expect(body.srf_status).toBe("srf_approved");
      expect(body.srf_decided_by).toBe(CPC);
      expect(body.srf_decided_at).toBeTruthy();
      expect(body.srf_rejection_reason).toBeNull();
    });

    it("records the reason when rejecting", async () => {
      let body: Record<string, unknown> = {};
      server.use(
        http.patch(`${BASE}/rest/v1/students`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "s1", srf_status: "srf_rejected" });
        }),
      );

      await repo().decide("s1", "srf_submitted", {
        decision: "reject",
        reason: "12th marksheet is unreadable",
      });

      expect(body.srf_status).toBe("srf_rejected");
      expect(body.srf_rejection_reason).toBe("12th marksheet is unreadable");
    });

    it("refuses an invalid transition without touching the database", async () => {
      let called = false;
      server.use(
        http.patch(`${BASE}/rest/v1/students`, () => {
          called = true;
          return HttpResponse.json({});
        }),
      );

      await expect(
        repo().decide("s1", "srf_approved", { decision: "approve" }),
      ).rejects.toBeInstanceOf(VerificationError);
      expect(called).toBe(false);
    });

    it("refuses a rejection with no reason without touching the database", async () => {
      let called = false;
      server.use(
        http.patch(`${BASE}/rest/v1/students`, () => {
          called = true;
          return HttpResponse.json({});
        }),
      );

      await expect(
        repo().decide("s1", "srf_submitted", { decision: "reject", reason: "" }),
      ).rejects.toBeInstanceOf(VerificationError);
      expect(called).toBe(false);
    });
  });
});

/**
 * The queue's whole purpose: a declared figure beside the document that proves
 * it. The SRF discarded the uploads, so this screen showed a CGPA and nothing
 * to check it against — verification meant clicking Approve on the student's
 * own typing. Semester lines are now linked to their marksheet (0023).
 */
describe("the evidence behind each declared figure", () => {
  const withSemesters = (rows: unknown) =>
    server.use(
      http.get(`${BASE}/rest/v1/students`, () =>
        HttpResponse.json([
          {
            id: "s1",
            full_name: "Asha R",
            roll_number: "TEC001",
            overall_cgpa: 8.2,
            student_semesters: rows,
            student_documents: [
              { kind: "tenth_marksheet", storage_path: "s1/tenth.pdf" },
              { kind: "twelfth_marksheet", storage_path: "s1/twelfth.pdf" },
            ],
          },
        ]),
      ),
    );

  const signing = () => {
    const client = createClient(BASE, "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    client.storage.from = ((bucket: string) => ({
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((path) => ({ signedUrl: `https://signed/${bucket}/${path}` })),
        error: null,
      }),
    })) as unknown as typeof client.storage.from;
    return createSupabaseVerificationRepository(client, async () => CPC);
  };

  it("returns each declared semester with the marksheet that evidences it", async () => {
    withSemesters([
      {
        semester_number: 2,
        cgpa: 8.4,
        current_arrears: 0,
        history_of_arrears: 1,
        status: "pending",
        student_documents: { storage_path: "s1/sem2.pdf" },
      },
      {
        semester_number: 1,
        cgpa: 8.1,
        current_arrears: 0,
        history_of_arrears: 0,
        status: "pending",
        student_documents: { storage_path: "s1/sem1.pdf" },
      },
    ]);

    const [student] = await signing().pending();

    // Ordered by semester, however PostgREST returned them: a coordinator
    // reads a degree forwards.
    expect(student?.semesters.map((s) => s.semesterNumber)).toEqual([1, 2]);
    expect(student?.semesters[0]).toMatchObject({
      semesterNumber: 1,
      cgpa: 8.1,
      marksheetUrl: "https://signed/marksheets/s1/sem1.pdf",
    });
  });

  it("carries the arrears declared for each semester, which drives filter on", async () => {
    withSemesters([
      {
        semester_number: 1,
        cgpa: 8.1,
        current_arrears: 2,
        history_of_arrears: 3,
        status: "pending",
        student_documents: { storage_path: "s1/sem1.pdf" },
      },
    ]);

    const [student] = await signing().pending();

    expect(student?.semesters[0]).toMatchObject({ currentArrears: 2, historyOfArrears: 3 });
  });

  /**
   * A dead link is worse than a missing one: a coordinator who clicks through
   * to nothing may still believe they checked it. Say so instead.
   */
  it("says plainly when a semester has no marksheet to check against", async () => {
    withSemesters([
      {
        semester_number: 1,
        cgpa: 8.1,
        current_arrears: 0,
        history_of_arrears: 0,
        status: "pending",
        student_documents: null,
      },
    ]);

    const [student] = await signing().pending();

    expect(student?.semesters[0]?.marksheetUrl).toBeNull();
  });

  it("still lists the school marksheets, which belong to no semester", async () => {
    withSemesters([]);

    const [student] = await signing().pending();

    expect(student?.documents.map((d) => d.label)).toEqual(["10th marksheet", "12th marksheet"]);
  });

  it("excludes certificates from the school marksheets column even when present in student_documents", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/students`, () =>
        HttpResponse.json([
          {
            id: "s1",
            full_name: "Subbulakshmi S",
            roll_number: "21CSE045",
            overall_cgpa: 8.9,
            student_semesters: [],
            student_certificates: [
              {
                id: "cert-1",
                name: "Coursera",
                status: "pending",
                student_documents: { storage_path: "s1/cert-1.pdf" },
              },
            ],
            student_documents: [
              { kind: "tenth_marksheet", storage_path: "s1/tenth.pdf" },
              { kind: "twelfth_marksheet", storage_path: "s1/twelfth.pdf" },
              { kind: "certificate", storage_path: "s1/cert-1.pdf" },
              { kind: "certificate", storage_path: "s1/cert-2.pdf" },
            ],
          },
        ]),
      ),
    );

    const [student] = await signing().pending();

    expect(student?.documents.map((d) => d.label)).toEqual(["10th marksheet", "12th marksheet"]);
    expect(student?.certificates).toHaveLength(1);
    expect(student?.certificates[0]?.name).toBe("Coursera");
  });

  it("deduplicates school marksheets when a student resubmitted with new scans", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/students`, () =>
        HttpResponse.json([
          {
            id: "s1",
            full_name: "Subbulakshmi S",
            roll_number: "21CSE045",
            overall_cgpa: 8.9,
            student_semesters: [],
            student_certificates: [],
            student_documents: [
              {
                kind: "tenth_marksheet",
                storage_path: "s1/tenth-old.pdf",
                uploaded_at: "2026-08-01T10:00:00Z",
              },
              {
                kind: "twelfth_marksheet",
                storage_path: "s1/twelfth-old.pdf",
                uploaded_at: "2026-08-01T10:00:00Z",
              },
              {
                kind: "tenth_marksheet",
                storage_path: "s1/tenth-new.pdf",
                uploaded_at: "2026-08-05T10:00:00Z",
              },
              {
                kind: "twelfth_marksheet",
                storage_path: "s1/twelfth-new.pdf",
                uploaded_at: "2026-08-05T10:00:00Z",
              },
            ],
          },
        ]),
      ),
    );

    const [student] = await signing().pending();

    expect(student?.documents).toHaveLength(2);
    expect(student?.documents.map((d) => d.label)).toEqual(["10th marksheet", "12th marksheet"]);
    expect(student?.documents[0]?.url).toContain("tenth-new.pdf");
    expect(student?.documents[1]?.url).toContain("twelfth-new.pdf");
  });

  it("asks the database for the semester lines and their marksheets in one query", async () => {
    let url = "";
    server.use(
      http.get(`${BASE}/rest/v1/students`, ({ request }) => {
        url = request.url;
        return HttpResponse.json([]);
      }),
    );

    await repo().pending();

    // A second round trip per student would be N+1 against a queue that can
    // hold a whole cohort.
    expect(decodeURIComponent(url)).toContain("student_semesters(");
  });
});
