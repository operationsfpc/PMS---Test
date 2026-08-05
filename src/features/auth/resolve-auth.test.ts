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
  /** Campus rows as PostgREST returns them, with the name embedded. */
  campuses?: Array<{ campuses: { name: string } }>;
}): SupabaseClient {
  return {
    auth: { getSession: async () => ({ data: { session: opts.session }, error: null }) },
    from: (table: string) => ({
      select: () => ({
        // The campus lookup returns a set and is awaited directly; the
        // identity lookups return one row and end in `.maybeSingle()`.
        eq: () =>
          table === "staff_campus_assignments"
            ? Promise.resolve({ data: opts.campuses ?? [], error: null })
            : {
                maybeSingle: async () => ({
                  data: table === "profiles" ? (opts.profile ?? null) : (opts.student ?? null),
                  error: null,
                }),
              },
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
      // An organisation-wide role is mapped to no campus, and says so.
      campuses: [],
    });
  });

  it("identifies a student by their roster record", async () => {
    const state = await resolveAuthState(
      fakeClient({ session: SESSION, profile: null, student: { id: "s1" } }),
    );
    expect(state).toEqual({
      status: "signed-in",
      role: "student",
      email: "someone@example.com",
      campuses: [],
    });
  });

  /**
   * Signed in to Google, recognised by nobody here.
   *
   * This was reported as "cannot log in" and looked like nothing at all: the
   * user authenticated, resolved to signed-out, and was sent back to /login,
   * where Google immediately signed them in again. An invisible loop with no
   * message. It is a distinct state and has to be named as one, or it cannot
   * be explained to the person stuck in it.
   */
  it("reports an authenticated account that belongs to nobody, and says who", async () => {
    const state = await resolveAuthState(
      fakeClient({ session: SESSION, profile: null, student: null }),
    );
    expect(state).toEqual({ status: "unrecognised", email: "someone@example.com" });
  });
});

/**
 * The campus a staff member is mapped to.
 *
 * Asked for 2026-08-05: "below role campus placement coordinator, also display
 * the campus name." It is not decoration. A coordinator's whole authority -
 * whose marksheets they may verify, whose registration they may approve -
 * comes from this mapping, and in production one was mapped to no campus at
 * all and simply saw an empty queue with nothing to explain it.
 */
describe("the campus a staff member works with", () => {
  it("reports the campus a coordinator is mapped to", async () => {
    const state = await resolveAuthState(
      fakeClient({
        session: SESSION,
        profile: { role: "campus_placement_coordinator" },
        campuses: [{ campuses: { name: "SDNB Vaishnav College for Women" } }],
      }),
    );

    expect(state).toMatchObject({
      status: "signed-in",
      campuses: ["SDNB Vaishnav College for Women"],
    });
  });

  it("reports an empty list when they are mapped to none, rather than guessing", async () => {
    const state = await resolveAuthState(
      fakeClient({ session: SESSION, profile: { role: "campus_placement_coordinator" } }),
    );

    expect(state).toMatchObject({ status: "signed-in", campuses: [] });
  });

  it("carries every campus for a role that spans several", async () => {
    const state = await resolveAuthState(
      fakeClient({
        session: SESSION,
        profile: { role: "campus_manager" },
        campuses: [{ campuses: { name: "Alliance" } }, { campuses: { name: "VIT" } }],
      }),
    );

    expect(state).toMatchObject({ campuses: ["Alliance", "VIT"] });
  });

  /** A student is not staff: they have no assignment rows to read. */
  it("does not go looking for a student's staff assignments", async () => {
    const state = await resolveAuthState(
      fakeClient({ session: SESSION, profile: null, student: { id: "s1" } }),
    );

    expect(state).toMatchObject({ status: "signed-in", role: "student", campuses: [] });
  });
});
