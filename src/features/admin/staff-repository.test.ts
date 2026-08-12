import type { AppRole } from "@domain/types";
import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseStaffRepository, StaffError } from "./staff-repository";

/**
 * Staff invitations.
 *
 * An invitation row IS the login allowlist entry: on first Google sign-in a
 * trigger materialises the profile with the invited role. So this repository
 * creates accounts, and the domain decides who may use it.
 */
const BASE = "https://project.supabase.co";

const repo = (role: AppRole = "admin", email = "admin@faceprep.in") =>
  createSupabaseStaffRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
    async () => ({ role, email }),
  );

/**
 * The reads `list()` makes that no single test is about.
 *
 * It resolves the campus mapping as well as the invitation now, so every test
 * that reaches `list()` - which includes every guarded mutation, because they
 * all look the target up first - has to let those through or MSW fails them
 * for a request unrelated to what they assert.
 */
function campusReads(
  assignments: readonly { profile_id: string; campus_id: string }[] = [],
  staged: readonly { email: string; campus_id: string }[] = [],
) {
  server.use(
    http.get(`${BASE}/rest/v1/campuses`, () =>
      HttpResponse.json([
        { id: "campus-1", name: "SDNB Vaishnav College for Women" },
        { id: "campus-2", name: "Alliance University" },
      ]),
    ),
    http.get(`${BASE}/rest/v1/staff_campus_assignments`, () => HttpResponse.json(assignments)),
    http.get(`${BASE}/rest/v1/staff_campus_invitations`, () => HttpResponse.json(staged)),
  );
}

/** Whatever the staff list holds for these tests. */
function staffList(
  rows: readonly { email: string; role: string; accepted_at?: string | null }[],
  profiles: readonly { email: string; is_active: boolean }[] = [],
) {
  campusReads();
  server.use(
    http.get(`${BASE}/rest/v1/staff_invitations`, () =>
      HttpResponse.json(
        rows.map((r) => ({
          email: r.email,
          full_name: r.email,
          role: r.role,
          accepted_at: r.accepted_at ?? "2026-01-01",
        })),
      ),
    ),
    http.get(`${BASE}/rest/v1/profiles`, () => HttpResponse.json(profiles)),
  );
}

const INVITATION = {
  fullName: "Meera Iyer",
  email: "  Meera@FacePrep.in  ",
  role: "delivery_head" as const,
  campusIds: [],
};

describe("createSupabaseStaffRepository", () => {
  it("marks someone who has never signed in as still invited", async () => {
    campusReads();
    server.use(
      http.get(`${BASE}/rest/v1/staff_invitations`, () =>
        HttpResponse.json([
          {
            email: "cpc@faceprep.in",
            full_name: "CPC One",
            role: "campus_placement_coordinator",
            accepted_at: null,
          },
        ]),
      ),
      http.get(`${BASE}/rest/v1/profiles`, () => HttpResponse.json([])),
    );

    const [member] = await repo().list();

    expect(member?.acceptedAt).toBeNull();
    expect(member?.isActive).toBe(true);
  });

  it("reflects a deactivated profile", async () => {
    campusReads();
    server.use(
      http.get(`${BASE}/rest/v1/staff_invitations`, () =>
        HttpResponse.json([
          {
            email: "gone@faceprep.in",
            full_name: "Gone",
            role: "account_executive",
            accepted_at: "2026-01-01",
          },
        ]),
      ),
      http.get(`${BASE}/rest/v1/profiles`, () =>
        HttpResponse.json([{ email: "gone@faceprep.in", is_active: false }]),
      ),
    );

    const [member] = await repo().list();

    expect(member?.isActive).toBe(false);
  });

  it("normalises the email, because login matches on it exactly", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/staff_invitations`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ email: "meera@faceprep.in" });
      }),
    );

    await repo().invite(INVITATION);

    expect(body.email).toBe("meera@faceprep.in");
    expect(body.full_name).toBe("Meera Iyer");
  });

  it("stages the campus assignments alongside the invitation", async () => {
    let staged: Array<Record<string, unknown>> = [];
    server.use(
      http.post(`${BASE}/rest/v1/staff_invitations`, () => HttpResponse.json({ email: "x" })),
      http.post(`${BASE}/rest/v1/staff_campus_invitations`, async ({ request }) => {
        staged = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(staged);
      }),
    );

    await repo().invite({
      ...INVITATION,
      role: "campus_placement_coordinator",
      campusIds: ["c1", "c2"],
    });

    expect(staged.map((s) => s.campus_id)).toEqual(["c1", "c2"]);
  });

  it("explains a duplicate invitation", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/staff_invitations`, () =>
        HttpResponse.json({ code: "23505", message: "duplicate" }, { status: 409 }),
      ),
    );

    await expect(repo().invite(INVITATION)).rejects.toThrow(/already been invited/i);
  });

  /**
   * 0040: one email identifies one person. Inviting somebody on an address
   * already on the student roster is refused by the database, which names it.
   * "Already invited" would be a lie - nobody invited them - and would send an
   * administrator hunting through the staff list for a row that is not there.
   */
  it("distinguishes an address held by a STUDENT from a duplicate invitation", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/staff_invitations`, () =>
        HttpResponse.json(
          {
            code: "23505",
            message:
              "sainaveen@faceprep.in is already on the student roster. One person is either a student or staff, never both.",
          },
          { status: 409 },
        ),
      ),
    );

    await expect(repo().invite(INVITATION)).rejects.toThrow(
      /sainaveen@faceprep\.in.*student roster.*student or staff/is,
    );
  });

  it("says so when the invitation lands but the campus assignment does not", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/staff_invitations`, () => HttpResponse.json({ email: "x" })),
      http.post(`${BASE}/rest/v1/staff_campus_invitations`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

    await expect(
      repo().invite({ ...INVITATION, role: "campus_manager", campusIds: ["c1"] }),
    ).rejects.toThrow(/campus assignment failed/i);
  });

  it("loads only active campuses to assign", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/campuses`, () =>
        HttpResponse.json([{ id: "c1", name: "Alliance University" }]),
      ),
    );

    expect(await repo().campuses()).toEqual([{ id: "c1", name: "Alliance University" }]);
  });

  it("deactivates a staff member rather than deleting them", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE}/rest/v1/profiles`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json([{ email: "x" }]);
      }),
    );

    await repo().setActive("cpc@faceprep.in", false);

    expect(body.is_active).toBe(false);
  });

  it("surfaces a failure to load the staff list", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/staff_invitations`, () =>
        HttpResponse.json({ message: "denied" }, { status: 403 }),
      ),
      http.get(`${BASE}/rest/v1/profiles`, () => HttpResponse.json([])),
    );

    await expect(repo().list()).rejects.toBeInstanceOf(StaffError);
  });
});

/** The domain rule is enforced here too, not only in the screen. */
describe("who may invite", () => {
  it("refuses a non-admin actor", async () => {
    await expect(repo("central_placement_coordinator").invite(INVITATION)).rejects.toThrow(
      /only an admin/i,
    );
  });

  it("refuses to invite a student, whatever the caller", async () => {
    await expect(repo().invite({ ...INVITATION, role: "student" })).rejects.toThrow(/roster/i);
  });
});

/**
 * Changing a role and removing an account. The domain owns both decisions; the
 * repository's job is to ask, and then to leave the invitation and the profile
 * agreeing with each other.
 */
describe("changeRole", () => {
  it("updates the invitation and the profile together", async () => {
    staffList([
      { email: "admin@faceprep.in", role: "admin" },
      { email: "ae@faceprep.in", role: "account_executive" },
    ]);
    const patched: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE}/rest/v1/staff_invitations`, async ({ request }) => {
        patched.invitation = await request.json();
        return HttpResponse.json([{ email: "ae@faceprep.in" }]);
      }),
      http.patch(`${BASE}/rest/v1/profiles`, async ({ request }) => {
        patched.profile = await request.json();
        return HttpResponse.json([{ email: "ae@faceprep.in" }]);
      }),
    );

    await repo().changeRole("ae@faceprep.in", "delivery_head");

    expect(patched.invitation).toEqual({ role: "delivery_head" });
    expect(patched.profile).toEqual({ role: "delivery_head" });
  });

  it("refuses a non-Admin", async () => {
    staffList([{ email: "ae@faceprep.in", role: "account_executive" }]);

    await expect(
      repo("central_placement_coordinator", "cpc@faceprep.in").changeRole(
        "ae@faceprep.in",
        "admin",
      ),
    ).rejects.toThrow(/only an admin/i);
  });

  it("refuses to demote the last remaining Admin", async () => {
    staffList([
      { email: "admin@faceprep.in", role: "admin" },
      { email: "ae@faceprep.in", role: "account_executive" },
    ]);

    await expect(
      repo("admin", "ae@faceprep.in").changeRole("admin@faceprep.in", "ceo"),
    ).rejects.toThrow(/last admin/i);
  });

  it("does not count a deactivated Admin as cover for demoting the other one", async () => {
    staffList(
      [
        { email: "admin@faceprep.in", role: "admin" },
        { email: "old-admin@faceprep.in", role: "admin" },
      ],
      [{ email: "old-admin@faceprep.in", is_active: false }],
    );

    await expect(
      repo("admin", "old-admin@faceprep.in").changeRole("admin@faceprep.in", "ceo"),
    ).rejects.toThrow(/last admin/i);
  });
});

describe("remove", () => {
  it("deletes the invitation, the staged campuses and the profile", async () => {
    staffList([
      { email: "admin@faceprep.in", role: "admin" },
      { email: "ae@faceprep.in", role: "account_executive" },
    ]);
    const deleted: string[] = [];
    for (const table of ["staff_invitations", "staff_campus_invitations", "profiles"]) {
      server.use(
        http.delete(`${BASE}/rest/v1/${table}`, () => {
          deleted.push(table);
          return HttpResponse.json([]);
        }),
      );
    }

    await repo().remove("ae@faceprep.in");

    expect(deleted).toContain("staff_invitations");
    expect(deleted).toContain("staff_campus_invitations");
    expect(deleted).toContain("profiles");
  });

  it("refuses to remove the account the Admin is signed in as", async () => {
    staffList([
      { email: "admin@faceprep.in", role: "admin" },
      { email: "other@faceprep.in", role: "admin" },
    ]);

    await expect(repo("admin", "admin@faceprep.in").remove("ADMIN@faceprep.in")).rejects.toThrow(
      /your own account/i,
    );
  });

  /**
   * PRD 19: attribution has to survive. Postgres refuses the delete when the
   * person's work is still referenced, and "try again" is the wrong advice -
   * deactivation is the remedy, so the message has to say so.
   */
  it("tells the Admin to deactivate when the person's work is still on record", async () => {
    staffList([
      { email: "admin@faceprep.in", role: "admin" },
      { email: "ae@faceprep.in", role: "account_executive" },
    ]);
    server.use(
      http.delete(`${BASE}/rest/v1/staff_invitations`, () => HttpResponse.json([])),
      http.delete(`${BASE}/rest/v1/staff_campus_invitations`, () => HttpResponse.json([])),
      http.delete(`${BASE}/rest/v1/profiles`, () =>
        HttpResponse.json(
          {
            code: "23503",
            message: 'update or delete on table "profiles" violates foreign key constraint',
          },
          { status: 409 },
        ),
      ),
    );

    await expect(repo().remove("ae@faceprep.in")).rejects.toThrow(/deactivate/i);
  });
});

/**
 * Mapping a campus to someone who already exists.
 *
 * Found in production 2026-08-05: the only Campus Placement Coordinator had
 * no campus at all, so `my_student_ids()` returned nothing and their
 * verification queue was empty however many students had submitted. There was
 * no way to fix it from the application - campuses could only ever be chosen
 * at INVITE time, and this coordinator had been invited before that existed.
 *
 * So the mapping has to be readable and changeable for staff already on the
 * list, not just for the next person invited.
 */
describe("campus mapping for existing staff", () => {
  const withAssignments = (
    assignments: readonly { profile_id: string; campus_id: string }[],
    profiles: readonly { id: string; email: string }[],
  ) => {
    server.use(
      http.get(`${BASE}/rest/v1/staff_invitations`, () =>
        HttpResponse.json([
          {
            email: "cpc@faceprep.in",
            full_name: "CPC One",
            role: "campus_placement_coordinator",
            accepted_at: "2026-01-01",
          },
        ]),
      ),
      http.get(`${BASE}/rest/v1/profiles`, () =>
        HttpResponse.json(profiles.map((p) => ({ ...p, is_active: true }))),
      ),
      http.get(`${BASE}/rest/v1/staff_campus_assignments`, () => HttpResponse.json(assignments)),
      http.get(`${BASE}/rest/v1/staff_campus_invitations`, () => HttpResponse.json([])),
      http.get(`${BASE}/rest/v1/campuses`, () =>
        HttpResponse.json([
          { id: "campus-1", name: "SDNB Vaishnav College for Women" },
          { id: "campus-2", name: "Alliance University" },
        ]),
      ),
    );
  };

  it("shows which campus a coordinator is mapped to", async () => {
    withAssignments(
      [{ profile_id: "p1", campus_id: "campus-1" }],
      [{ id: "p1", email: "cpc@faceprep.in" }],
    );

    const [member] = await repo().list();

    expect(member?.campuses).toEqual([{ id: "campus-1", name: "SDNB Vaishnav College for Women" }]);
  });

  /** The production state, and the one a coordinator cannot diagnose alone. */
  it("shows plainly when a coordinator is mapped to no campus", async () => {
    withAssignments([], [{ id: "p1", email: "cpc@faceprep.in" }]);

    const [member] = await repo().list();

    expect(member?.campuses).toEqual([]);
  });

  it("maps a coordinator to a campus, replacing whatever was there", async () => {
    const deleted: string[] = [];
    let inserted: Array<Record<string, unknown>> = [];
    withAssignments(
      [{ profile_id: "p1", campus_id: "campus-2" }],
      [{ id: "p1", email: "cpc@faceprep.in" }],
    );
    server.use(
      http.delete(`${BASE}/rest/v1/staff_campus_assignments`, ({ request }) => {
        deleted.push(new URL(request.url).search);
        return HttpResponse.json([]);
      }),
      http.post(`${BASE}/rest/v1/staff_campus_assignments`, async ({ request }) => {
        inserted = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(inserted);
      }),
    );

    await repo().setCampuses("cpc@faceprep.in", ["campus-1"]);

    expect(deleted[0]).toContain("profile_id=eq.p1");
    expect(inserted).toEqual([{ profile_id: "p1", campus_id: "campus-1" }]);
  });

  /** The domain owns this rule; the repository must not be a way around it. */
  it("refuses to map a coordinator to two campuses", async () => {
    withAssignments([], [{ id: "p1", email: "cpc@faceprep.in" }]);

    await expect(repo().setCampuses("cpc@faceprep.in", ["campus-1", "campus-2"])).rejects.toThrow(
      /one campus/i,
    );
  });

  it("refuses to leave a coordinator with no campus at all", async () => {
    withAssignments([], [{ id: "p1", email: "cpc@faceprep.in" }]);

    await expect(repo().setCampuses("cpc@faceprep.in", [])).rejects.toThrow(/one campus/i);
  });

  /**
   * They have no profile row until first sign-in, so the mapping has to be
   * staged against the invited email exactly as `invite` stages it.
   */
  it("stages the mapping when they have not signed in yet", async () => {
    let staged: Array<Record<string, unknown>> = [];
    withAssignments([], []);
    server.use(
      http.delete(`${BASE}/rest/v1/staff_campus_invitations`, () => HttpResponse.json([])),
      http.post(`${BASE}/rest/v1/staff_campus_invitations`, async ({ request }) => {
        staged = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(staged);
      }),
    );

    await repo().setCampuses("cpc@faceprep.in", ["campus-1"]);

    expect(staged).toEqual([{ email: "cpc@faceprep.in", campus_id: "campus-1" }]);
  });

  it("lets only an Admin change a mapping", async () => {
    withAssignments([], [{ id: "p1", email: "cpc@faceprep.in" }]);

    await expect(
      repo("campus_manager", "cm@faceprep.in").setCampuses("cpc@faceprep.in", ["campus-1"]),
    ).rejects.toThrow(/admin/i);
  });
});
