import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { resolveAuthState } from "./resolve-auth";

/**
 * Turning a Supabase session into "who is this, and what may they do".
 *
 * CONFIRMED: everyone who signs in is either staff or a student. The allowlist
 * in 0009_guards.sql enforces it - an address must be on the roster or on
 * staff_invitations to get an auth.users row at all.
 *
 * The "neither" case is therefore unreachable. It is still handled as
 * signed-out rather than defaulting to a role: guessing 'student' for an
 * unidentifiable account would hand out a student's view of the system, and a
 * data-exposure bug is a worse failure than a refused login.
 */
function fakeClient(opts: {
  session: unknown;
  profile?: { role: string } | null;
  student?: { id: string } | null;
}): SupabaseClient {
  return {
    auth: { getSession: async () => ({ data: { session: opts.session }, error: null }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "profiles" ? (opts.profile ?? null) : (opts.student ?? null),
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const SESSION = { user: { id: "u1", email: "someone@example.com" } };

describe("resolveAuthState", () => {
  it("reports signed-out when there is no session", async () => {
    const state = await resolveAuthState(fakeClient({ session: null }));
    expect(state).toEqual({ status: "signed-out" });
  });

  it("reads a staff member's role from their profile", async () => {
    const state = await resolveAuthState(
      fakeClient({ session: SESSION, profile: { role: "delivery_head" } }),
    );
    expect(state).toEqual({
      status: "signed-in",
      role: "delivery_head",
      email: "someone@example.com",
    });
  });

  it("identifies a student by their roster record", async () => {
    const state = await resolveAuthState(
      fakeClient({ session: SESSION, profile: null, student: { id: "s1" } }),
    );
    expect(state).toEqual({ status: "signed-in", role: "student", email: "someone@example.com" });
  });

  it("refuses to guess a role for an account that is neither", async () => {
    const state = await resolveAuthState(
      fakeClient({ session: SESSION, profile: null, student: null }),
    );
    expect(state).toEqual({ status: "signed-out" });
  });
});
