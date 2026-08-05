import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseCampusProgrammesView } from "./campus-programmes-repository";

/**
 * What a college runs, against live rows. F6 (UAT 2026-08-06).
 *
 * The screen speaks in NAMES ("B.E", "CSE") because that is what an Admin
 * reads; the table stores ids. Resolving one to the other is this layer's only
 * real job, and getting it wrong pairs a degree with another degree's branch.
 */
const BASE = "https://project.supabase.co";

function stub(
  opts: {
    programmes?: unknown[];
    degrees?: unknown[];
    branches?: unknown[];
    insertFails?: { code?: string; message?: string };
  } = {},
) {
  const writes: Array<{ table: string; method: string; body: unknown; search: string }> = [];

  server.use(
    http.get(`${BASE}/rest/v1/campus_programmes`, () => HttpResponse.json(opts.programmes ?? [])),
    http.get(`${BASE}/rest/v1/degrees`, () =>
      HttpResponse.json(opts.degrees ?? [{ id: "d1", name: "B.E" }]),
    ),
    http.get(`${BASE}/rest/v1/branches`, () =>
      HttpResponse.json(opts.branches ?? [{ id: "b1", degree_id: "d1", name: "CSE" }]),
    ),
    http.post(`${BASE}/rest/v1/campus_programmes`, async ({ request }) => {
      writes.push({
        table: "campus_programmes",
        method: "POST",
        body: await request.json(),
        search: new URL(request.url).search,
      });
      return opts.insertFails === undefined
        ? HttpResponse.json({ id: "p1" })
        : HttpResponse.json(opts.insertFails, { status: 409 });
    }),
    http.delete(`${BASE}/rest/v1/campus_programmes`, ({ request }) => {
      writes.push({
        table: "campus_programmes",
        method: "DELETE",
        body: null,
        search: new URL(request.url).search,
      });
      return HttpResponse.json([]);
    }),
  );

  return { writes };
}

const view = () =>
  createSupabaseCampusProgrammesView(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
  );

describe("createSupabaseCampusProgrammesView", () => {
  it("reads what a college runs, as names", async () => {
    stub({
      programmes: [
        {
          id: "p1",
          passing_year: 2027,
          degrees: { name: "B.E" },
          branches: { name: "CSE" },
        },
      ],
    });

    expect(await view().programmes("c1")).toEqual([
      { id: "p1", degree: "B.E", branch: "CSE", passingYear: 2027 },
    ]);
  });

  it("reads a degree with no branch without inventing one", async () => {
    stub({
      programmes: [{ id: "p1", passing_year: 2026, degrees: { name: "MBA" }, branches: null }],
    });

    expect((await view().programmes("c1"))[0]?.branch).toBe("");
  });

  it("offers each degree with only its own branches", async () => {
    stub({
      degrees: [
        { id: "d1", name: "B.E" },
        { id: "d2", name: "MBA" },
      ],
      branches: [
        { id: "b1", degree_id: "d1", name: "CSE" },
        { id: "b2", degree_id: "d1", name: "ECE" },
      ],
    });

    expect(await view().options()).toEqual([
      { degree: "B.E", branches: ["CSE", "ECE"] },
      { degree: "MBA", branches: [] },
    ]);
  });

  it("writes the ids behind the names the Admin chose", async () => {
    const { writes } = stub();

    await view().add({ campusId: "c1", degree: "B.E", branch: "CSE", passingYear: 2028 });

    expect(writes[0]?.body).toMatchObject({
      campus_id: "c1",
      degree_id: "d1",
      branch_id: "b1",
      passing_year: 2028,
    });
  });

  it("writes no branch when the degree has none", async () => {
    const { writes } = stub({ degrees: [{ id: "d2", name: "MBA" }], branches: [] });

    await view().add({ campusId: "c1", degree: "MBA", branch: "", passingYear: 2028 });

    expect(writes[0]?.body).toMatchObject({ degree_id: "d2", branch_id: null });
  });

  /** A name that is not in the catalogue is a mistake, not something to create. */
  it("refuses a degree the catalogue does not have", async () => {
    stub();

    await expect(
      view().add({ campusId: "c1", degree: "B.Arch", branch: "", passingYear: 2028 }),
    ).rejects.toThrow(/B\.Arch/);
  });

  it("says plainly when the college already runs that programme", async () => {
    stub({ insertFails: { code: "23505", message: "duplicate key" } });

    await expect(
      view().add({ campusId: "c1", degree: "B.E", branch: "CSE", passingYear: 2028 }),
    ).rejects.toThrow(/already/i);
  });

  it("removes the programme it was asked to", async () => {
    const { writes } = stub();

    await view().remove("p1");

    expect(writes[0]?.method).toBe("DELETE");
    expect(writes[0]?.search).toContain("p1");
  });
});
