import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { CampusError, createSupabaseCampusRepository } from "./campus-repository";

/**
 * Campuses.
 *
 * The city is typed on the form, not picked, so it may not exist yet. It is
 * resolved-or-created here - which is what stops the campus screen inheriting
 * the bootstrap deadlock it exists to break.
 */
const BASE = "https://project.supabase.co";

const repo = () =>
  createSupabaseCampusRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
  );

const NEW_CAMPUS = {
  name: "VIT Bangalore",
  cityName: "Bengaluru",
  state: "Karnataka",
  code: "VITB",
  address: "Whitefield",
  primaryContactName: "Rahul Nair",
  primaryContactEmail: "rahul@vit.edu",
  primaryContactPhone: "9840000002",
};

describe("createSupabaseCampusRepository", () => {
  it("reads the city name through the embedded relation", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/campuses`, () =>
        HttpResponse.json([
          {
            id: "c1",
            name: "Alliance University",
            code: "ALU",
            is_active: true,
            cities: { name: "Chennai", state: "Tamil Nadu" },
          },
        ]),
      ),
    );

    const [campus] = await repo().list();

    expect(campus?.cityName).toBe("Chennai");
    expect(campus?.state).toBe("Tamil Nadu");
    expect(campus?.isActive).toBe(true);
  });

  /** PostgREST returns a to-one relation as an object; the types say array. */
  it("reads the city even when it arrives as an array", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/campuses`, () =>
        HttpResponse.json([
          {
            id: "c1",
            name: "Alliance University",
            code: "ALU",
            is_active: true,
            cities: [{ name: "Chennai", state: "Tamil Nadu" }],
          },
        ]),
      ),
    );

    const [campus] = await repo().list();

    expect(campus?.cityName).toBe("Chennai");
  });

  it("reuses an existing city rather than duplicating it", async () => {
    let cityInserts = 0;
    let campusBody: Record<string, unknown> = {};
    server.use(
      http.get(`${BASE}/rest/v1/cities`, () => HttpResponse.json({ id: "city1" })),
      http.post(`${BASE}/rest/v1/cities`, () => {
        cityInserts += 1;
        return HttpResponse.json({ id: "city-new" });
      }),
      http.post(`${BASE}/rest/v1/campuses`, async ({ request }) => {
        campusBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "c9" });
      }),
    );

    await repo().create(NEW_CAMPUS);

    expect(cityInserts).toBe(0);
    expect(campusBody.city_id).toBe("city1");
    expect(campusBody.primary_contact_email).toBe("rahul@vit.edu");
  });

  it("creates the city when it does not exist yet", async () => {
    let cityBody: Record<string, unknown> = {};
    server.use(
      http.get(`${BASE}/rest/v1/cities`, () => HttpResponse.json(null)),
      http.post(`${BASE}/rest/v1/cities`, async ({ request }) => {
        cityBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "city-new" });
      }),
      http.post(`${BASE}/rest/v1/campuses`, () => HttpResponse.json({ id: "c9" })),
    );

    await repo().create(NEW_CAMPUS);

    expect(cityBody.name).toBe("Bengaluru");
    expect(cityBody.state).toBe("Karnataka");
  });

  it("explains a duplicate code instead of leaking the constraint name", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/cities`, () => HttpResponse.json({ id: "city1" })),
      http.post(`${BASE}/rest/v1/campuses`, () =>
        HttpResponse.json({ code: "23505", message: "duplicate key" }, { status: 409 }),
      ),
    );

    await expect(repo().create(NEW_CAMPUS)).rejects.toThrow(/already taken/i);
  });

  it("reports a failure to load rather than showing an empty list", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/campuses`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

    await expect(repo().list()).rejects.toBeInstanceOf(CampusError);
  });

  it("deactivates rather than deleting", async () => {
    let method = "";
    let body: Record<string, unknown> = {};
    server.use(
      http.patch(`${BASE}/rest/v1/campuses`, async ({ request }) => {
        method = request.method;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "c1" });
      }),
    );

    await repo().setActive("c1", false);

    expect(method).toBe("PATCH");
    expect(body.is_active).toBe(false);
  });
});
