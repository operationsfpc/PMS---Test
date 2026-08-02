import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseProgrammesRepository, ProgrammesError } from "./programmes-repository";

/**
 * Degrees and branches.
 *
 * Roster import matches these BY NAME and refuses anything unknown (A11), so
 * what is stored here decides which students can be imported at all.
 */
const BASE = "https://project.supabase.co";

const repo = () =>
  createSupabaseProgrammesRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
  );

describe("createSupabaseProgrammesRepository", () => {
  it("nests each branch under the degree it belongs to", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/degrees`, () =>
        HttpResponse.json([
          { id: "d1", name: "B.E" },
          { id: "d2", name: "MCA" },
        ]),
      ),
      http.get(`${BASE}/rest/v1/branches`, () =>
        HttpResponse.json([
          { id: "b1", degree_id: "d1", name: "CSE", is_active: true },
          { id: "b2", degree_id: "d1", name: "ECE", is_active: false },
        ]),
      ),
    );

    const degrees = await repo().list();

    expect(degrees[0]?.branches.map((b) => b.name)).toEqual(["CSE", "ECE"]);
    expect(degrees[0]?.branches[1]?.isActive).toBe(false);
    expect(degrees[1]?.branches).toEqual([]);
  });

  it("explains a duplicate degree", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/degrees`, () =>
        HttpResponse.json({ code: "23505", message: "duplicate" }, { status: 409 }),
      ),
    );

    await expect(repo().addDegree("MCA")).rejects.toThrow(/already exists/i);
  });

  it("trims a degree name, so 'MCA ' cannot shadow 'MCA'", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/degrees`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "d9" });
      }),
    );

    await repo().addDegree("  B.Sc IT  ");

    expect(body.name).toBe("B.Sc IT");
  });

  it("attaches a branch to its degree", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/branches`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "b9" });
      }),
    );

    await repo().addBranch("d2", "Data Science");

    expect(body.degree_id).toBe("d2");
    expect(body.name).toBe("Data Science");
  });

  it("explains a duplicate branch within a degree", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/branches`, () =>
        HttpResponse.json({ code: "23505", message: "duplicate" }, { status: 409 }),
      ),
    );

    await expect(repo().addBranch("d1", "CSE")).rejects.toThrow(/already exists for this degree/i);
  });

  it("reports a generic failure without leaking the database message", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/degrees`, () =>
        HttpResponse.json(
          { code: "42501", message: "permission denied for table degrees" },
          { status: 403 },
        ),
      ),
    );

    await expect(repo().addDegree("X")).rejects.toThrow(/could not add the degree/i);
  });

  it("deactivates a branch rather than deleting it", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE}/rest/v1/branches`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "b1" });
      }),
    );

    await repo().setBranchActive("b1", false);

    expect(body.is_active).toBe(false);
  });

  it("surfaces a failure to load", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/degrees`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
      http.get(`${BASE}/rest/v1/branches`, () => HttpResponse.json([])),
    );

    await expect(repo().list()).rejects.toBeInstanceOf(ProgrammesError);
  });
});
