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
    http.delete(`${BASE}/rest/v1/student_semesters`, () => HttpResponse.json([])),
    http.post(`${BASE}/rest/v1/student_semesters`, () => HttpResponse.json([])),
  );
});

const repo = (userId: string | null = USER) =>
  createSupabaseSrfRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => userId,
  );

const values: SrfSubmission = {
  ...SRF_DEFAULTS,
  mobile: "9876543210",
  whatsapp: "",
  tenthPercentage: 91.4,
  twelfthPercentage: 88,
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  programmeLevel: "ug",
  ugAggregateCgpa: null,
  semesters: [
    { semesterNumber: 1, cgpa: 8.1, currentArrears: 0, historyOfArrears: 0 },
    { semesterNumber: 2, cgpa: 8.24, currentArrears: 1, historyOfArrears: 2 },
  ],
  roleCategories: ["software_technical"],
  resumeCategories: ["software_technical"],
  consent: true,
} as SrfSubmission;

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

    await repo().submit({ ...values, programmeLevel: "pg", ugAggregateCgpa: 7.85 });

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
