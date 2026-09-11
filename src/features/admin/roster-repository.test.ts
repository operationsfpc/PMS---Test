import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it, beforeEach } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseRosterRepository, RosterError } from "./roster-repository";

/**
 * Importing a college roster.
 *
 * Every imported student becomes a login: 0009 refuses any address not on the
 * roster. Import is therefore additive and idempotent - re-uploading a
 * corrected file must not wipe students who have already claimed their account
 * and filled in their SRF.
 */
const BASE = "https://project.supabase.co";
const CAMPUS = "c0000000-0000-0000-0000-000000000007";

const repo = () =>
  createSupabaseRosterRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
  );

const students = [
  {
    rollNumber: "TEC001",
    fullName: "Asha",
    email: "asha@example.com",
    degree: "B.E",
    branch: "CSE",
    passingYear: 2027,
  },
];

beforeEach(() => {
  server.use(
    http.post(`${BASE}/rest/v1/rpc/backfill_campus_programmes`, () => HttpResponse.json(0)),
  );
});

describe("createSupabaseRosterRepository", () => {
  it("inserts students as invited, against the chosen campus", async () => {
    let body: Array<Record<string, unknown>> = [];
    server.use(
      http.get(`${BASE}/rest/v1/degrees`, () => HttpResponse.json([{ id: "deg1", name: "B.E" }])),
      http.get(`${BASE}/rest/v1/branches`, () => HttpResponse.json([{ id: "br1", name: "CSE" }])),
      http.post(`${BASE}/rest/v1/students`, async ({ request }) => {
        body = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(body.map((_, i) => ({ id: `s${i}` })));
      }),
    );

    const result = await repo().importStudents(CAMPUS, students);

    expect(body[0]?.campus_id).toBe(CAMPUS);
    expect(body[0]?.srf_status).toBe("invited");
    expect(body[0]?.email).toBe("asha@example.com");
    expect(result.imported).toBe(1);
  });

  it("refuses a degree the system does not know, naming it", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/degrees`, () => HttpResponse.json([])),
      http.get(`${BASE}/rest/v1/branches`, () => HttpResponse.json([])),
    );

    await expect(repo().importStudents(CAMPUS, students)).rejects.toThrow(/B\.E/);
  });

  it("does not overwrite a student who has already claimed their account", async () => {
    let prefer = "";
    server.use(
      http.get(`${BASE}/rest/v1/degrees`, () => HttpResponse.json([{ id: "deg1", name: "B.E" }])),
      http.get(`${BASE}/rest/v1/branches`, () => HttpResponse.json([{ id: "br1", name: "CSE" }])),
      http.post(`${BASE}/rest/v1/students`, ({ request }) => {
        prefer = request.headers.get("Prefer") ?? "";
        return HttpResponse.json([{ id: "s0" }]);
      }),
    );

    await repo().importStudents(CAMPUS, students);

    // PostgREST spells this `resolution=ignore-duplicates`: an existing row is
    // left exactly as it is rather than being overwritten.
    expect(prefer).toContain("resolution=ignore-duplicates");
  });

  it("reports a refusal in words an administrator can act on", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/degrees`, () => HttpResponse.json([{ id: "deg1", name: "B.E" }])),
      http.get(`${BASE}/rest/v1/branches`, () => HttpResponse.json([{ id: "br1", name: "CSE" }])),
      http.post(`${BASE}/rest/v1/students`, () =>
        HttpResponse.json(
          { code: "42501", message: "permission denied", details: null, hint: null },
          { status: 403 },
        ),
      ),
    );

    await expect(repo().importStudents(CAMPUS, students)).rejects.toBeInstanceOf(RosterError);
  });

  it("imports nothing when the parsed roster is empty", async () => {
    const result = await repo().importStudents(CAMPUS, []);
    expect(result.imported).toBe(0);
  });
});

/**
 * A11. An unknown DEGREE was refused by name, but an unknown BRANCH was
 * silently imported as null. That student then quietly fails every
 * branch-restricted drive's eligibility (R2) and nobody can see why. A blank
 * branch is still legitimate - some degrees have none.
 */
describe("unknown branches", () => {
  it("refuses a branch the system does not know, naming it", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/degrees`, () => HttpResponse.json([{ id: "deg1", name: "B.E" }])),
      http.get(`${BASE}/rest/v1/branches`, () => HttpResponse.json([])),
    );

    await expect(repo().importStudents(CAMPUS, students)).rejects.toThrow(/CSE/);
  });

  it("still accepts a blank branch, because some degrees have none", async () => {
    let body: Array<Record<string, unknown>> = [];
    server.use(
      http.get(`${BASE}/rest/v1/degrees`, () => HttpResponse.json([{ id: "deg1", name: "B.E" }])),
      http.get(`${BASE}/rest/v1/branches`, () => HttpResponse.json([])),
      http.post(`${BASE}/rest/v1/students`, async ({ request }) => {
        body = (await request.json()) as Array<Record<string, unknown>>;
        return HttpResponse.json(body.map((_, i) => ({ id: `s${i}` })));
      }),
    );

    const result = await repo().importStudents(
      CAMPUS,
      students.map((s) => ({ ...s, branch: "" })),
    );

    expect(body[0]?.branch_id).toBeNull();
    expect(result.imported).toBe(1);
  });
});

/**
 * 0040: one email identifies one person.
 *
 * A roster row whose address already belongs to a staff account is refused by
 * the database. The whole batch fails, so the administrator must be told
 * WHICH address - "could not import the roster" would leave them re-uploading
 * the same file and getting the same silence.
 */
describe("an address that already belongs to staff", () => {
  it("reports the address and why, not a generic failure", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/degrees`, () => HttpResponse.json([{ id: "d1", name: "B.E" }])),
      http.get(`${BASE}/rest/v1/branches`, () => HttpResponse.json([{ id: "b1", name: "CSE" }])),
      http.post(`${BASE}/rest/v1/students`, () =>
        HttpResponse.json(
          {
            code: "23505",
            message:
              "sainaveen@faceprep.in is already a staff account. One person is either a student or staff, never both.",
          },
          { status: 409 },
        ),
      ),
    );

    await expect(
      repo().importStudents(CAMPUS, [
        {
          rollNumber: "R1",
          fullName: "Sai Naveen",
          email: "sainaveen@faceprep.in",
          degree: "B.E",
          branch: "CSE",
          passingYear: 2027,
        },
      ]),
    ).rejects.toThrow(/sainaveen@faceprep\.in.*student or staff/is);
  });
});
