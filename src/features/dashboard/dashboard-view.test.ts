import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseDashboardView } from "./dashboard-view";

/**
 * The shared reporting dashboard: CEO, ER, ER Head, Campus Manager and - since
 * 0018 - the Key Account Manager, whose campuses are now mapped to them.
 *
 * It was never tested at this layer, and it is the only screen a KAM has. What
 * matters here is that it gathers FACTS and judges nothing: the placement rate
 * is computed by src/domain/statistics.ts from the rows this view returns, so
 * a miscounted row is a wrong number on the CEO's screen.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const student = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  participation_status: "active",
  campus_id: "c1",
  campuses: { name: "Alliance University" },
  ...over,
});

function stub(opts: { students?: unknown[]; offers?: unknown[]; drives?: unknown[] } = {}): {
  studentQueries: string[];
} {
  const studentQueries: string[] = [];

  server.use(
    http.get(`${BASE}/rest/v1/students`, ({ request }) => {
      studentQueries.push(new URL(request.url).search);
      return HttpResponse.json(opts.students ?? [student()]);
    }),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
    http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json(opts.drives ?? [])),
  );

  return { studentQueries };
}

describe("createSupabaseDashboardView", () => {
  it("returns one fact row per student for the domain to count", async () => {
    stub({ students: [student(), student({ id: "s2", participation_status: "opted_out" })] });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students).toHaveLength(2);
    expect(snapshot.students[1]?.participationStatus).toBe("opted_out");
  });

  it("counts a placement offer as an on-campus placement", async () => {
    stub({
      offers: [
        { student_id: "s1", source: "on_campus", drive_type: "placement", offer_category: "dream" },
      ],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students[0]?.hasOnCampusPlacement).toBe(true);
    expect(snapshot.offersByCategory).toEqual({ dream: 1 });
  });

  it("counts a convertible internship as a placement, and a plain one as neither", async () => {
    stub({
      students: [student(), student({ id: "s2" })],
      offers: [
        {
          student_id: "s1",
          source: "on_campus",
          drive_type: "internship_convertible",
          offer_category: "regular",
        },
        { student_id: "s2", source: "on_campus", drive_type: "internship", offer_category: null },
      ],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students[0]?.hasOnCampusPlacement).toBe(true);
    expect(snapshot.students[1]?.hasOnCampusPlacement).toBe(false);
    // A plain internship has no category, so it never lands on the ladder.
    expect(snapshot.offersByCategory).toEqual({ regular: 1 });
  });

  it("keeps a self-placed offer out of the on-campus count entirely (PRD §16.2)", async () => {
    stub({
      offers: [
        {
          student_id: "s1",
          source: "self_placed",
          drive_type: "placement",
          offer_category: "dream",
        },
      ],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students[0]?.hasSelfPlacement).toBe(true);
    expect(snapshot.students[0]?.hasOnCampusPlacement).toBe(false);
    expect(snapshot.offersByCategory).toEqual({});
  });

  it("counts drives by status", async () => {
    stub({ drives: [{ status: "live" }, { status: "live" }, { status: "completed" }] });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.drivesByStatus).toEqual({ live: 2, completed: 1 });
  });

  it("breaks the same definitions down per campus, so a row cannot disagree with the headline", async () => {
    stub({
      students: [
        student(),
        student({ id: "s2", campus_id: "c2", campuses: { name: "VIT Bangalore" } }),
        student({ id: "s3", participation_status: "opted_out" }),
      ],
      offers: [
        { student_id: "s1", source: "on_campus", drive_type: "placement", offer_category: "dream" },
      ],
    });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.campuses).toEqual([
      { campusId: "c1", campusName: "Alliance University", eligible: 1, placed: 1 },
      { campusId: "c2", campusName: "VIT Bangalore", eligible: 1, placed: 0 },
    ]);
  });

  it("names a student with no campus rather than dropping them from the report", async () => {
    stub({ students: [student({ campus_id: null, campuses: null })] });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.campuses[0]?.campusName).toBe("Unassigned campus");
  });

  /**
   * Scoping is RLS's job - a KAM is returned only the students on the campuses
   * mapped to them (0018). The optional filter is a narrowing on top of that,
   * and passing none must never mean "no students".
   */
  it("asks for every student it is allowed to see when given no campus filter", async () => {
    const { studentQueries } = stub();

    await createSupabaseDashboardView(client()).snapshot();

    expect(studentQueries[0]).not.toMatch(/campus_id=in/);
  });

  it("narrows to the given campuses when it is given some", async () => {
    const { studentQueries } = stub();

    await createSupabaseDashboardView(client(), ["c1", "c2"]).snapshot();

    expect(studentQueries[0]).toMatch(/campus_id=in\.%28c1%2Cc2%29/);
  });

  it("does not treat an empty campus list as 'no campuses'", async () => {
    const { studentQueries } = stub();

    await createSupabaseDashboardView(client(), []).snapshot();

    expect(studentQueries[0]).not.toMatch(/campus_id=in/);
  });

  it("skips the offer query entirely when there are no students to ask about", async () => {
    stub({ students: [] });

    const snapshot = await createSupabaseDashboardView(client()).snapshot();

    expect(snapshot.students).toEqual([]);
    expect(snapshot.offersByCategory).toEqual({});
  });
});
