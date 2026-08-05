import { setSupabaseClient } from "@lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { SrfSubmitError, submitSrf } from "./srf-api";
import { SRF_DEFAULTS, type SrfSubmission } from "./srf-schema";

/**
 * The SRF now writes to the real database instead of the MSW stand-in.
 *
 * This pins that the form talks to Supabase - a regression here would look
 * like a working form that silently saves nothing.
 */

const BASE = "https://project.supabase.co";
const USER = "40000000-0000-0000-0000-000000000001";

function signedInClient() {
  const client = createClient(BASE, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  client.auth.getSession = (async () => ({
    data: { session: { user: { id: USER } } },
    error: null,
  })) as unknown as typeof client.auth.getSession;
  // Marksheets now reach storage before the form reaches the queue; the
  // upload itself is supabase-js's business, not this test's.
  client.storage.from = (() => ({
    upload: async (path: string) => ({ data: { path }, error: null }),
  })) as unknown as typeof client.storage.from;
  setSupabaseClient(client);
  return client;
}

const scan = (name: string) => new File(["scan"], name, { type: "application/pdf" });

const values = {
  ...SRF_DEFAULTS,
  mobile: "9876543210",
  tenthInstitution: "St Xavier's, Chennai",
  tenthPercentage: 91.4,
  twelfthInstitution: "St Xavier's, Chennai",
  twelfthPercentage: 88,
  passingYear: 2026,
  programmeLevel: "ug",
  ugAggregate: null,
  semesters: [
    {
      semesterNumber: 1,
      marks: 8.24,
      currentArrears: 0,
      historyOfArrears: 0,
    },
  ],
  // Every declared figure needs the document that proves it.
  marksheets: {
    tenth: scan("10th.pdf"),
    twelfth: scan("12th.pdf"),
    "semester-1": scan("sem1.pdf"),
  },
  overallCgpa: 8.24,
  roleCategories: ["software_technical"],
  resumeCategories: ["software_technical"],
  consent: true,
} as SrfSubmission;

/**
 * Submitting is ONE call to `submit_srf` (0028): the student row, the semester
 * lines and the marksheet rows in a single transaction. Resolving the
 * student's own id first still happens, because the storage policy requires
 * every uploaded object to sit under it.
 */
beforeEach(() => {
  server.use(http.get(`${BASE}/rest/v1/students`, () => HttpResponse.json({ id: "s1" })));
});

afterEach(() => setSupabaseClient(undefined));

describe("submitSrf", () => {
  it("submits through the real database function, not a mock endpoint", async () => {
    let seen: { method?: string; url?: string } = {};

    server.use(
      http.post(`${BASE}/rest/v1/rpc/submit_srf`, ({ request }) => {
        seen = { method: request.method, url: request.url };
        return HttpResponse.json({ student_id: "s1", srf_status: "srf_submitted" });
      }),
    );
    signedInClient();

    const result = await submitSrf(values);

    expect(seen.method).toBe("POST");
    expect(seen.url).toContain("/rest/v1/rpc/submit_srf");
    expect(result).toEqual({ id: "s1", status: "srf_submitted" });
  });

  it("turns a permission refusal into words a student can act on", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/rpc/submit_srf`, () =>
        HttpResponse.json(
          { code: "42501", message: "permission denied", details: null, hint: null },
          { status: 403 },
        ),
      ),
    );
    signedInClient();

    await expect(submitSrf(values)).rejects.toBeInstanceOf(SrfSubmitError);
  });
});
