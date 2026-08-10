import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseSkillsView, SkillsError } from "./skills-view";

/**
 * The Supabase half of the skill repository (PRD §5).
 *
 * Writes are operator-only (Central CPC / Admin) and every score row names
 * who recorded it. A cleared score is a DELETE, never an upsert of zero.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const central = () =>
  createSupabaseSkillsView(
    client(),
    async () => "actor-1",
    async () => "central_placement_coordinator",
  );

const AREA_ROWS = [
  { id: "a1", name: "AI skills" },
  { id: "a2", name: "Aptitude" },
];

const STUDENT_ROWS = [
  {
    id: "s1",
    full_name: "Priya Ramesh",
    roll_number: "21CSE1042",
    campuses: { name: "Alliance University" },
    student_skill_scores: [{ skill_area_id: "a2", score: 85 }],
  },
  {
    id: "s2",
    full_name: "Arjun Menon",
    roll_number: "21CSE9001",
    campuses: null,
    student_skill_scores: [],
  },
];

describe("areas", () => {
  it("lists the skill areas", async () => {
    server.use(http.get(`${BASE}/rest/v1/skill_areas`, () => HttpResponse.json(AREA_ROWS)));

    expect(await central().areas()).toEqual([
      { id: "a1", name: "AI skills" },
      { id: "a2", name: "Aptitude" },
    ]);
  });
});

describe("students", () => {
  it("maps each student with their recorded scores keyed by area", async () => {
    let select = "";
    server.use(
      http.get(`${BASE}/rest/v1/students`, ({ request }) => {
        select = new URL(request.url).searchParams.get("select") ?? "";
        return HttpResponse.json(STUDENT_ROWS);
      }),
    );

    const students = await central().students();

    expect(select.replace(/\s/g, "")).toContain("student_skill_scores(skill_area_id,score)");
    expect(students).toEqual([
      {
        studentId: "s1",
        studentName: "Priya Ramesh",
        rollNumber: "21CSE1042",
        campusName: "Alliance University",
        scores: { a2: 85 },
      },
      {
        studentId: "s2",
        studentName: "Arjun Menon",
        rollNumber: "21CSE9001",
        campusName: "—",
        scores: {},
      },
    ]);
  });
});

describe("addArea", () => {
  it("inserts and returns the created area", async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}/rest/v1/skill_areas`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a9", name: "Cloud fundamentals" });
      }),
    );

    const created = await central().addArea("Cloud fundamentals");

    expect(body).toEqual({ name: "Cloud fundamentals" });
    expect(created).toEqual({ id: "a9", name: "Cloud fundamentals" });
  });

  it("reports a duplicate as a duplicate, not as a raw constraint", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/skill_areas`, () =>
        HttpResponse.json({ code: "23505", message: "duplicate key" }, { status: 409 }),
      ),
    );

    await expect(central().addArea("Aptitude")).rejects.toThrow(/already exists/i);
  });

  it("refuses anyone who is not an operator, without touching the network", async () => {
    const view = createSupabaseSkillsView(
      client(),
      async () => "actor-1",
      async () => "campus_placement_coordinator",
    );

    await expect(view.addArea("Aptitude")).rejects.toThrow(SkillsError);
  });
});

describe("saveScores", () => {
  it("upserts new scores in one batch, naming who recorded them", async () => {
    let onConflict = "";
    let body: unknown;
    server.use(
      http.post(`${BASE}/rest/v1/student_skill_scores`, async ({ request }) => {
        onConflict = new URL(request.url).searchParams.get("on_conflict") ?? "";
        body = await request.json();
        return HttpResponse.json([]);
      }),
    );

    await central().saveScores([
      { studentId: "s1", skillAreaId: "a1", score: 72.5 },
      { studentId: "s2", skillAreaId: "a1", score: 60 },
    ]);

    expect(onConflict).toBe("student_id,skill_area_id");
    expect(body).toEqual([
      { student_id: "s1", skill_area_id: "a1", score: 72.5, recorded_by: "actor-1" },
      { student_id: "s2", skill_area_id: "a1", score: 60, recorded_by: "actor-1" },
    ]);
  });

  it("clears a score with a DELETE scoped to that student and area", async () => {
    const deletes: string[] = [];
    server.use(
      http.delete(`${BASE}/rest/v1/student_skill_scores`, ({ request }) => {
        deletes.push(new URL(request.url).search);
        return HttpResponse.json([]);
      }),
    );

    await central().saveScores([{ studentId: "s1", skillAreaId: "a2", score: null }]);

    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain("student_id=eq.s1");
    expect(deletes[0]).toContain("skill_area_id=eq.a2");
  });

  it("refuses anyone who is not an operator", async () => {
    const view = createSupabaseSkillsView(
      client(),
      async () => "actor-1",
      async () => "student",
    );

    await expect(
      view.saveScores([{ studentId: "s1", skillAreaId: "a1", score: 10 }]),
    ).rejects.toThrow(/central placement coordinator/i);
  });

  it("refuses to write with no session rather than recording an anonymous score", async () => {
    const view = createSupabaseSkillsView(
      client(),
      async () => null,
      async () => "central_placement_coordinator",
    );

    await expect(
      view.saveScores([{ studentId: "s1", skillAreaId: "a1", score: 10 }]),
    ).rejects.toThrow(/sign in again/i);
  });

  it("surfaces a failed write as an error", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/student_skill_scores`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

    await expect(
      central().saveScores([{ studentId: "s1", skillAreaId: "a1", score: 10 }]),
    ).rejects.toThrow(SkillsError);
  });
});
