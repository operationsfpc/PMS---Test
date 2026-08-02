import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { ApplyError, createSupabaseApplyRepository } from "./apply-repository";

/**
 * Applying to a drive.
 *
 * Two domain rules meet here: R6 decides whether the student may apply at all,
 * and R7 freezes what the recruiter will see. Neither is re-implemented; a
 * refusal must never reach the database, and an application must never be
 * written without its snapshot.
 */
const BASE = "https://project.supabase.co";

const student = {
  id: "s1",
  fullName: "Asha Ramanathan",
  rollNumber: "TEC001",
  email: "asha@example.com",
  degree: "B.E",
  branch: "CSE",
  passingYear: 2027,
  overallCgpa: 8.24,
  tenthPercentage: 91.4,
  twelfthPercentage: 88,
  currentArrears: 0,
  historyOfArrears: 0,
  technicalSkills: "TypeScript",
  resumes: [{ id: "r1", roleCategory: "software_technical" as const }],
  srfStatus: "srf_approved" as const,
  participationStatus: "active" as const,
  academics: {
    degree: "B.E",
    branch: "CSE",
    passingYear: 2027,
    overallCgpa: 8.24,
    tenthPercentage: 91.4,
    twelfthPercentage: 88,
    currentArrears: 0,
    historyOfArrears: 0,
    city: "Chennai",
    campus: "Test Engineering College",
  },
  offers: [],
};

const drive = {
  id: "d1",
  roleCategory: "software_technical" as const,
  driveType: "placement" as const,
  offerCategory: "dream" as const,
  openToAllOverride: false,
  applicationStart: new Date("2026-09-01T00:00:00Z"),
  applicationEnd: new Date("2026-09-10T00:00:00Z"),
  status: "live" as const,
  criteria: {
    eligibleDegrees: [],
    eligibleBranches: [],
    eligiblePassingYears: [],
    minOverallCgpa: null,
    minTenthPercentage: null,
    minTwelfthPercentage: null,
    arrearPolicy: "flexible" as const,
    targetCities: [],
    targetCampuses: [],
  },
};

const NOW = new Date("2026-09-05T00:00:00Z");

const repo = () =>
  createSupabaseApplyRepository(
    createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } }),
  );

describe("createSupabaseApplyRepository", () => {
  it("writes the application with the frozen snapshot and the matching resume", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/rest/v1/applications`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "a1" });
      }),
    );

    await repo().apply(student, drive, [], NOW);

    expect(body.drive_id).toBe("d1");
    expect(body.student_id).toBe("s1");
    expect(body.resume_id).toBe("r1");
    const snapshot = body.profile_snapshot as { profile: { overallCgpa: number } };
    expect(snapshot.profile.overallCgpa).toBe(8.24);
  });

  it("refuses before the window opens, without touching the database", async () => {
    let called = false;
    server.use(
      http.post(`${BASE}/rest/v1/applications`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    await expect(
      repo().apply(student, drive, [], new Date("2026-08-01T00:00:00Z")),
    ).rejects.toBeInstanceOf(ApplyError);
    expect(called).toBe(false);
  });

  it("refuses a student whose SRF is not approved", async () => {
    await expect(
      repo().apply({ ...student, srfStatus: "srf_submitted" }, drive, [], NOW),
    ).rejects.toBeInstanceOf(ApplyError);
  });

  it("refuses a student who has opted out", async () => {
    await expect(
      repo().apply({ ...student, participationStatus: "opted_out" }, drive, [], NOW),
    ).rejects.toBeInstanceOf(ApplyError);
  });

  it("explains a duplicate application rather than showing a database error", async () => {
    server.use(
      http.post(`${BASE}/rest/v1/applications`, () =>
        HttpResponse.json(
          { code: "23505", message: "duplicate key", details: null, hint: null },
          { status: 409 },
        ),
      ),
    );

    await expect(repo().apply(student, drive, [], NOW)).rejects.toThrow(/already applied/i);
  });
});
