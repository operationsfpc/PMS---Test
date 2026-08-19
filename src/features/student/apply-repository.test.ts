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
  resumeNames: { software_technical: "software-technical.pdf" },
  driveTypePreferences: [],
  // 2026-08-18: a drive reaches the students who asked for that area, so an
  // applicant carries what they asked for.
  roleCategories: ["software_technical" as const],
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

/**
 * F14 (UAT 2026-08-06): "Ask for a drive specific resume to be uploaded at the
 * time of applying."
 *
 * The resume is uploaded FIRST and the application references it. An
 * application written without its resume is what the recruiter would then
 * read, and there is no withdrawal to fix it with (PRD 7.4).
 */
describe("applying with a drive-specific resume", () => {
  const resume = () => new File(["cv"], "zoho.pdf", { type: "application/pdf" });

  function stubStorage(opts: { uploadFails?: boolean; documentFails?: boolean } = {}) {
    const writes: Array<{ table: string; body: Record<string, unknown> }> = [];
    const uploads: string[] = [];

    server.use(
      http.post(`${BASE}/storage/v1/object/resumes/:path*`, ({ params }) => {
        if (opts.uploadFails === true) return new HttpResponse(null, { status: 400 });
        uploads.push(String(params.path));
        return HttpResponse.json({ Key: "resumes/s1/zoho.pdf" });
      }),
      http.post(`${BASE}/rest/v1/student_documents`, async ({ request }) => {
        writes.push({
          table: "student_documents",
          body: (await request.json()) as Record<string, unknown>,
        });
        if (opts.documentFails === true) return new HttpResponse(null, { status: 400 });
        return HttpResponse.json({ id: "doc-1" });
      }),
      http.post(`${BASE}/rest/v1/applications`, async ({ request }) => {
        writes.push({
          table: "applications",
          body: (await request.json()) as Record<string, unknown>,
        });
        return HttpResponse.json({ id: "app-1" });
      }),
    );

    return { writes, uploads };
  }

  it("stores the resume and points the application at it", async () => {
    const { writes, uploads } = stubStorage();

    await repo().apply(student, drive, [], NOW, resume());

    expect(uploads).toHaveLength(1);
    expect(writes.find((w) => w.table === "applications")?.body).toMatchObject({
      resume_id: "doc-1",
    });
  });

  /** The snapshot is what every downstream step reads (R7). */
  it("freezes the drive resume into the snapshot, not the generic one", async () => {
    const { writes } = stubStorage();

    await repo().apply(student, drive, [], NOW, resume());

    const body = writes.find((w) => w.table === "applications")?.body as {
      profile_snapshot: { resumeId: string };
    };
    expect(body.profile_snapshot.resumeId).toBe("doc-1");
  });

  it("writes no application at all when the resume cannot be stored", async () => {
    const { writes } = stubStorage({ uploadFails: true });

    await expect(repo().apply(student, drive, [], NOW, resume())).rejects.toThrow(/resume/i);
    expect(writes.some((w) => w.table === "applications")).toBe(false);
  });

  /** R6 first: a refusal must not cost the student an upload. */
  it("refuses an ineligible application before uploading anything", async () => {
    const { uploads } = stubStorage();

    await expect(
      repo().apply({ ...student, srfStatus: "srf_submitted" }, drive, [], NOW, resume()),
    ).rejects.toThrow();

    expect(uploads).toHaveLength(0);
  });

  /** Nothing changes for a caller that has no drive resume to give. */
  it("still falls back to the role-category resume when none is attached", async () => {
    const { writes, uploads } = stubStorage();

    await repo().apply(student, drive, [], NOW);

    expect(uploads).toHaveLength(0);
    expect(writes.find((w) => w.table === "applications")?.body).toMatchObject({
      resume_id: "r1",
    });
  });
});
