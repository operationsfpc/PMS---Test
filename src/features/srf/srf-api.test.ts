import { setSupabaseClient } from "@lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
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
  setSupabaseClient(client);
  return client;
}

const values = {
  ...SRF_DEFAULTS,
  mobile: "9876543210",
  tenthPercentage: 91.4,
  twelfthPercentage: 88,
  passingYear: 2026,
  overallCgpa: 8.24,
  roleCategories: ["software_technical"],
  resumeCategories: ["software_technical"],
  consent: true,
} as SrfSubmission;

afterEach(() => setSupabaseClient(undefined));

describe("submitSrf", () => {
  it("writes the student's own row in Supabase, not to a mock endpoint", async () => {
    let seen: { method?: string; url?: string } = {};

    server.use(
      http.patch(`${BASE}/rest/v1/students`, ({ request }) => {
        seen = { method: request.method, url: request.url };
        // .single() asks PostgREST for an object, not an array.
        return HttpResponse.json({ id: "s1", srf_status: "srf_submitted" });
      }),
    );
    signedInClient();

    const result = await submitSrf(values);

    expect(seen.method).toBe("PATCH");
    expect(seen.url).toContain("auth_user_id=eq.");
    expect(result).toEqual({ id: "s1", status: "srf_submitted" });
  });

  it("turns a permission refusal into words a student can act on", async () => {
    server.use(
      http.patch(`${BASE}/rest/v1/students`, () =>
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
