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

/** Whatever the staff list holds for these tests. */
function staffList(
  rows: readonly { email: string; role: string; accepted_at?: string | null }[],
  profiles: readonly { email: string; is_active: boolean }[] = [],
) {
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
