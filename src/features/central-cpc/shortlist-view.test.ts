import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseShortlistView } from "./shortlist-view";

/**
 * Feeds the shortlisting workspace.
 *
 * The rule this file exists to honour is R7: applicant data comes from the
 * application SNAPSHOT, never the live student profile. A student who improved
 * their CGPA after applying must not be ranked on numbers the recruiter's
 * criteria were never evaluated against — and the snapshot is also what the
 * recruiter is eventually sent, so the two must agree.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

/**
 * ⚠️ Corrected 2026-08-24 (UAT "CGPA showing 0"). This fixture used to invent
 * a FLAT snapshot — a shape nothing ever wrote. The real envelope, verified
 * against live rows, is `buildApplicationSnapshot`'s `{ profile: { academics:
 * {…}, roleCategories, … }, resumeId }`. The view read the invented shape,
 * the mock agreed with the view, and every real applicant showed "CGPA 0".
 * The mock backend must describe production, not the code under test.
 */
const APPLICATION = {
  id: "app-1",
  student_id: "s1",
  profile_snapshot: {
    profile: {
      fullName: "Anjali Subramanian",
      rollNumber: "21CSE1042",
      overallCgpa: 8.4,
      currentArrears: 0,
      historyOfArrears: 1,
      academics: { overallCgpa: 8.4, currentArrears: 0, historyOfArrears: 1 },
      roleCategories: ["software_technical"],
    },
    resumeId: "resume-1",
  },
  students: {
    full_name: "LIVE NAME",
    roll_number: "LIVE ROLL",
    campuses: { name: "PSG College of Technology" },
  },
  shortlist_entries: [{ included: true }],
};

/** The applications `select=`, decoded — recorded by the handler that answers it. */
let applicationsSelect = "";

function stub(
  opts: {
    drive?: Record<string, unknown> | null;
    applications?: unknown[];
    skills?: unknown[];
    saveFails?: boolean;
  } = {},
) {
  const writes: unknown[] = [];
  let skillsQueried = false;
  applicationsSelect = "";

  server.use(
    http.get(`${BASE}/rest/v1/drives`, () =>
      HttpResponse.json(
        opts.drive === undefined
          ? {
              id: "d1",
              company_name: "Zoho Corporation",
              role_title: "MTS",
              role_category: "software_technical",
              mandatory_skills: "Java, SQL , React",
            }
          : opts.drive,
      ),
    ),
    http.get(`${BASE}/rest/v1/applications`, ({ request }) => {
      applicationsSelect = decodeURIComponent(
        new URL(request.url).searchParams.get("select") ?? "",
      );
      return HttpResponse.json(opts.applications ?? [APPLICATION]);
    }),
    http.get(`${BASE}/rest/v1/student_skill_scores`, () => {
      skillsQueried = true;
      return HttpResponse.json(opts.skills ?? []);
    }),
    http.post(`${BASE}/rest/v1/shortlist_entries`, async ({ request }) => {
      writes.push(await request.clone().json());
      return opts.saveFails === true
        ? new HttpResponse(null, { status: 400 })
        : HttpResponse.json([{ id: "se-1" }]);
    }),
  );

  return {
    writes,
    skillsQueried: () => skillsQueried,
  };
}

const view = (role = "central_placement_coordinator", actorId: string | null = "cpc-1") =>
  createSupabaseShortlistView(
    client(),
    async () => actorId,
    async () => role as "central_placement_coordinator",
  );

describe("the drive being shortlisted for", () => {
  it("splits a comma-separated skill list and trims it", async () => {
    stub();

    expect((await view().drive("d1")).mandatorySkills).toEqual(["Java", "SQL", "React"]);
  });

  it("accepts a skill list that already arrived as an array", async () => {
    stub({ drive: { mandatory_skills: ["Java", "SQL"] } });

    expect((await view().drive("d1")).mandatorySkills).toEqual(["Java", "SQL"]);
  });

  it("treats a blank skill list as no skills, not as one empty skill", async () => {
    stub({ drive: { mandatory_skills: "   " } });

    expect((await view().drive("d1")).mandatorySkills).toEqual([]);
  });

  it("treats a missing skill list as no skills", async () => {
    stub({ drive: { mandatory_skills: null } });

    expect((await view().drive("d1")).mandatorySkills).toEqual([]);
  });

  it("keeps the screen usable when the drive record is thin", async () => {
    stub({ drive: {} });
    const drive = await view().drive("d1");

    expect(drive.companyName).toBe("This drive");
    expect(drive.roleTitle).toBeNull();
    expect(drive.roleCategory).toBeNull();
  });
});

describe("the applicants (R7 — from the snapshot)", () => {
  it("uses the frozen snapshot's name, not the live student row", async () => {
    stub();
    const [applicant] = await view().applicants("d1");

    expect(applicant?.studentName).toBe("Anjali Subramanian");
    expect(applicant?.rollNumber).toBe("21CSE1042");
  });

  it("falls back to the live row only when the snapshot has no identity", async () => {
    stub({ applications: [{ ...APPLICATION, profile_snapshot: {} }] });
    const [applicant] = await view().applicants("d1");

    expect(applicant?.studentName).toBe("LIVE NAME");
    expect(applicant?.rollNumber).toBe("LIVE ROLL");
  });

  it("reads the college from the live student row, since a snapshot never carried it", async () => {
    stub();
    const [applicant] = await view().applicants("d1");

    // R7 freezes what the recruiter judged the student ON. Which campus the
    // student belongs to is not a figure they declared, so it is read live —
    // the one field on this row that deliberately ignores the snapshot.
    expect(applicant?.college).toBe("PSG College of Technology");
    expect(applicationsSelect).toContain("campuses(name)");
  });

  it("shows no college for an applicant whose student row did not come back", async () => {
    stub({ applications: [{ ...APPLICATION, profile_snapshot: null, students: null }] });

    expect((await view().applicants("d1"))[0]?.college).toBeNull();
  });

  it("names an applicant with neither, rather than rendering nothing", async () => {
    stub({ applications: [{ ...APPLICATION, profile_snapshot: null, students: null }] });
    const [applicant] = await view().applicants("d1");

    expect(applicant?.studentName).toBe("Unknown student");
    expect(applicant?.rollNumber).toBe("—");
  });

  it("reads the academics the application was judged on", async () => {
    stub();
    const [applicant] = await view().applicants("d1");

    expect(applicant?.overallCgpa).toBe(8.4);
    expect(applicant?.historyOfArrears).toBe(1);
  });

  /**
   * #17 (UAT 2026-10-18): "two Priyas, both at 8.4" — the card carried marks
   * and nothing that identified the person behind them. Every field here is
   * ALREADY frozen in the same snapshot the CGPA is read from, so this is a
   * widening of the same source of truth, not a second one.
   */
  it("carries the programme, the school marks and the contact off the snapshot", async () => {
    stub({
      applications: [
        {
          ...APPLICATION,
          profile_snapshot: {
            profile: {
              fullName: "Priya Ramesh",
              rollNumber: "21CSE1042",
              email: "priya.ramesh@example.in",
              degree: "B.E.",
              branch: "CSE",
              passingYear: 2026,
              tenthPercentage: 91.4,
              twelfthPercentage: 88,
              overallCgpa: 8.4,
            },
            resumeId: "resume-1",
          },
        },
      ],
    });
    const [applicant] = await view().applicants("d1");

    expect(applicant?.email).toBe("priya.ramesh@example.in");
    expect(applicant?.degree).toBe("B.E.");
    expect(applicant?.branch).toBe("CSE");
    expect(applicant?.passingYear).toBe(2026);
    expect(applicant?.tenthPercentage).toBe(91.4);
    expect(applicant?.twelfthPercentage).toBe(88);
  });

  /** `buildApplicationSnapshot` copies the whole student, `academics` included,
   *  so the nested block is where the verified figures actually live. */
  it("reads them from the nested academics block when the snapshot carries one", async () => {
    stub({
      applications: [
        {
          ...APPLICATION,
          profile_snapshot: {
            profile: {
              fullName: "Priya Ramesh",
              rollNumber: "21CSE1042",
              academics: {
                degree: "B.Tech",
                branch: "ECE",
                passingYear: 2027,
                tenthPercentage: 82.6,
                twelfthPercentage: 90,
              },
            },
            resumeId: null,
          },
        },
      ],
    });
    const [applicant] = await view().applicants("d1");

    expect(applicant?.degree).toBe("B.Tech");
    expect(applicant?.branch).toBe("ECE");
    expect(applicant?.passingYear).toBe(2027);
    expect(applicant?.tenthPercentage).toBe(82.6);
  });

  /**
   * A missing figure is left MISSING. `AcademicProfile` cannot hold null, so an
   * unrecorded marksheet reaches the snapshot as `0` — and a card that prints
   * "10th 0%" tells the coordinator this candidate sat the exam and failed it.
   */
  it("leaves an unrecorded figure silent instead of showing its zero", async () => {
    stub({
      applications: [
        {
          ...APPLICATION,
          profile_snapshot: {
            profile: {
              fullName: "Rahul Nair",
              rollNumber: "21CSE0001",
              degree: "",
              passingYear: 0,
              tenthPercentage: 0,
              twelfthPercentage: null,
            },
            resumeId: null,
          },
        },
      ],
    });
    const [applicant] = await view().applicants("d1");

    expect(applicant?.degree).toBeNull();
    expect(applicant?.passingYear).toBeNull();
    expect(applicant?.tenthPercentage).toBeNull();
    expect(applicant?.twelfthPercentage).toBeNull();
    expect(applicant?.email).toBeNull();
  });

  it("reads a flat snapshot that has no nested academics block", async () => {
    stub({
      applications: [
        {
          ...APPLICATION,
          profile_snapshot: { fullName: "Flat", rollNumber: "R1", overallCgpa: 7.2 },
        },
      ],
    });

    expect((await view().applicants("d1"))[0]?.overallCgpa).toBe(7.2);
  });

  it("treats missing marks as zero rather than NaN, which would sort unpredictably", async () => {
    stub({ applications: [{ ...APPLICATION, profile_snapshot: {} }] });
    const [applicant] = await view().applicants("d1");

    expect(applicant?.overallCgpa).toBe(0);
    expect(applicant?.currentArrears).toBe(0);
  });

  /**
   * 2026-08-06: the invented `skill_scores` table (A12) is retired. Skills
   * now come from the Central Student Skill Repository (0037), where a score
   * is already on the 0-100 scale R11 expects (A35) and is NAMED by its
   * skill-area row rather than a free-text metric.
   */
  it("reads institutional scores from the skill repository, named by their area", async () => {
    stub({ skills: [{ student_id: "s1", score: 72.5, skill_areas: { name: "AI skills" } }] });

    expect((await view().applicants("d1"))[0]?.skillScores).toEqual([
      { skill: "AI skills", score: 72.5 },
    ]);
  });

  it("drops a score whose area row is missing rather than inventing a name", async () => {
    stub({ skills: [{ student_id: "s1", score: 50, skill_areas: null }] });

    expect((await view().applicants("d1"))[0]?.skillScores).toEqual([]);
  });

  it("never attributes one student's skill scores to another", async () => {
    stub({ skills: [{ student_id: "someone-else", score: 50, skill_areas: { name: "Java" } }] });

    expect((await view().applicants("d1"))[0]?.skillScores).toEqual([]);
  });

  it("does not ask about skills when nobody has applied", async () => {
    const { skillsQueried } = stub({ applications: [] });

    expect(await view().applicants("d1")).toEqual([]);
    expect(skillsQueried()).toBe(false);
  });

  it("reports who is already on the shortlist", async () => {
    stub();

    expect((await view().applicants("d1"))[0]?.shortlisted).toBe(true);
  });

  it("treats an absent shortlist entry as not shortlisted", async () => {
    stub({ applications: [{ ...APPLICATION, shortlist_entries: [] }] });

    expect((await view().applicants("d1"))[0]?.shortlisted).toBe(false);
  });

  it("treats an excluded shortlist entry as not shortlisted", async () => {
    stub({ applications: [{ ...APPLICATION, shortlist_entries: [{ included: false }] }] });

    expect((await view().applicants("d1"))[0]?.shortlisted).toBe(false);
  });

  it("ignores a preference list that is not a list", async () => {
    stub({
      applications: [
        { ...APPLICATION, profile_snapshot: { preferredRoleCategories: "software_technical" } },
      ],
    });

    expect((await view().applicants("d1"))[0]?.preferredRoleCategories).toEqual([]);
  });
});

describe("the opt-out flag (D7)", () => {
  it("marks an applicant whose student row says opted_out", async () => {
    stub({
      applications: [
        {
          ...APPLICATION,
          students: { ...APPLICATION.students, participation_status: "opted_out" },
        },
      ],
    });

    const rows = await view().applicants("d1");
    expect(rows[0]?.optedOut).toBe(true);
  });

  it("leaves an active applicant unmarked", async () => {
    stub({
      applications: [
        { ...APPLICATION, students: { ...APPLICATION.students, participation_status: "active" } },
      ],
    });

    const rows = await view().applicants("d1");
    expect(rows[0]?.optedOut).toBe(false);
  });
});

describe("saving the shortlist", () => {
  const decision = {
    applicationId: "app-1",
    included: true,
    rank: 1,
    score: 91.5,
    rationale: "Top coding score",
    optOutOverrideReason: null,
  };

  it("carries the opt-out override reason to the row (D7)", async () => {
    const { writes } = stub();

    await view().saveShortlist("d1", [
      { ...decision, optOutOverrideReason: "Recruiter asked for her by name" },
    ]);

    const written = (writes[0] as Array<Record<string, unknown>>)[0];
    expect(written?.opt_out_override_reason).toBe("Recruiter asked for her by name");
  });

  /** PRD §13.1: the recommendation is logged ALONGSIDE the human decision. */
  it("writes the rank, score and rationale next to the decision, attributed", async () => {
    const { writes } = stub();

    await view().saveShortlist("d1", [decision]);

    expect(writes[0]).toEqual([
      {
        application_id: "app-1",
        included: true,
        rank: 1,
        score: 91.5,
        rationale: "Top coding score",
        decided_by: "cpc-1",
        opt_out_override_reason: null,
      },
    ]);
  });

  it("refuses anyone but the Central Placement Coordinator", async () => {
    const { writes } = stub();

    await expect(
      view("campus_placement_coordinator").saveShortlist("d1", [decision]),
    ).rejects.toThrow(/Central Placement Coordinator/i);
    expect(writes).toHaveLength(0);
  });

  it("refuses when the session has gone, rather than writing an unattributed decision", async () => {
    const { writes } = stub();

    await expect(
      view("central_placement_coordinator", null).saveShortlist("d1", [decision]),
    ).rejects.toThrow(/session has expired/i);
    expect(writes).toHaveLength(0);
  });

  it("writes nothing at all when there is nothing to save", async () => {
    const { writes } = stub();

    await view().saveShortlist("d1", []);

    expect(writes).toHaveLength(0);
  });

  it("says so when the shortlist could not be saved", async () => {
    stub({ saveFails: true });

    await expect(view().saveShortlist("d1", [decision])).rejects.toThrow(/could not save/i);
  });
});

/** WS8 (2026-08-12): the export reads snapshots and logs the sharing event. */
describe("exporting", () => {
  it("returns saved entries with their frozen snapshots", async () => {
    stub({
      applications: [
        {
          ...APPLICATION,
          profile_snapshot: { profile: { rollNumber: "R1", fullName: "Priya" }, resumeId: "res-1" },
          shortlist_entries: [{ included: true }],
        },
      ],
    });

    const entries = await view().exportEntries("d1");
    expect(entries).toEqual([
      {
        applicationId: "app-1",
        included: true,
        snapshot: { profile: { rollNumber: "R1", fullName: "Priya" }, resumeId: "res-1" },
      },
    ]);
  });

  it("treats an application never decided as not included", async () => {
    stub({ applications: [{ ...APPLICATION, shortlist_entries: [] }] });

    const entries = await view().exportEntries("d1");
    expect(entries[0]?.included).toBe(false);
  });

  it("logs who exported what, for how many students (PRD 13.2)", async () => {
    const writes: unknown[] = [];
    stub();
    server.use(
      http.post(`${BASE}/rest/v1/recruiter_exports`, async ({ request }) => {
        writes.push(await request.clone().json());
        return HttpResponse.json([{ id: "re-1" }]);
      }),
    );

    await view().logExport("d1", ["Roll number", "Name"], 3);

    expect(writes[0]).toMatchObject({
      drive_id: "d1",
      exported_by: "cpc-1",
      columns: ["Roll number", "Name"],
      student_count: 3,
    });
  });
});

/** Answer 5a (2026-08-24): the resumes travel in the pack, fetched by id. */
describe("resumeFiles", () => {
  it("downloads each resume and reports its extension from the stored path", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/student_documents`, () =>
        HttpResponse.json([
          { id: "resume-1", storage_path: "s1/resume-technical.PDF" },
          { id: "resume-2", storage_path: "s2/resume.docx" },
        ]),
      ),
    );
    const client_ = client();
    client_.storage.from = ((bucket: string) => ({
      download: async (path: string) => ({
        data: new Blob([`${bucket}:${path}`]),
        error: null,
      }),
    })) as unknown as typeof client_.storage.from;

    const files = await createSupabaseShortlistView(
      client_,
      async () => "cpc-1",
      async () => "central_placement_coordinator",
    ).resumeFiles?.(["resume-1", "resume-2"]);

    expect(files?.get("resume-1")?.extension).toBe(".pdf");
    expect(files?.get("resume-2")?.extension).toBe(".docx");
    expect(files?.size).toBe(2);
  });

  it("fails loudly when a resume cannot be downloaded — a partial pack must not leave", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/student_documents`, () =>
        HttpResponse.json([{ id: "resume-1", storage_path: "s1/gone.pdf" }]),
      ),
    );
    const client_ = client();
    client_.storage.from = (() => ({
      download: async () => ({ data: null, error: new Error("404") }),
    })) as unknown as typeof client_.storage.from;

    await expect(
      createSupabaseShortlistView(
        client_,
        async () => "cpc-1",
        async () => "central_placement_coordinator",
      ).resumeFiles?.(["resume-1"]),
    ).rejects.toThrow(/could not be downloaded/i);
  });
});

/**
 * 2026-08-26 (Karthik): "Export shortlist (CSV)" answered with
 * "A resume could not be downloaded (…-images (6).pdf). Try the export again."
 *
 * Not a transient failure and not a missing file: a resume uploaded at apply
 * time is recorded as `resumes/<student>/<file>`, and the export asked the
 * `resumes` bucket for exactly that — i.e. `resumes/resumes/<student>/…`.
 * Verified against production before this test was written: all 14 resume
 * rows were unresolvable, so the pack had never once been built.
 */
describe("resumeFiles — the path the bucket actually knows", () => {
  const downloadsWithPath = (paths: string[]) => {
    const client_ = client();
    client_.storage.from = ((bucket: string) => ({
      download: async (path: string) => {
        paths.push(path);
        return { data: new Blob([bucket]), error: null };
      },
    })) as unknown as typeof client_.storage.from;
    return client_;
  };

  it("asks for the object key, not the bucket-prefixed row value", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/student_documents`, () =>
        HttpResponse.json([
          { id: "resume-1", storage_path: "resumes/s1/d1-1787027936502-images (6).pdf" },
        ]),
      ),
    );
    const paths: string[] = [];

    const files = await createSupabaseShortlistView(
      downloadsWithPath(paths),
      async () => "cpc-1",
      async () => "central_placement_coordinator",
    ).resumeFiles?.(["resume-1"]);

    expect(paths).toEqual(["s1/d1-1787027936502-images (6).pdf"]);
    expect(files?.get("resume-1")?.extension).toBe(".pdf");
  });

  /** A profile resume (SRF) is stored bare, and must keep working untouched. */
  it("still asks for a bare path exactly as stored", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/student_documents`, () =>
        HttpResponse.json([{ id: "resume-2", storage_path: "s2/profile-sales-abc-cv.pdf" }]),
      ),
    );
    const paths: string[] = [];

    await createSupabaseShortlistView(
      downloadsWithPath(paths),
      async () => "cpc-1",
      async () => "central_placement_coordinator",
    ).resumeFiles?.(["resume-2"]);

    expect(paths).toEqual(["s2/profile-sales-abc-cv.pdf"]);
  });
});

describe("resumeSignedUrls — generates signed URLs with normalized keys", () => {
  it("normalizes prefixed paths and requests signed URLs", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/student_documents`, () =>
        HttpResponse.json([
          { id: "resume-1", storage_path: "resumes/s1/resume.pdf" },
          { id: "resume-2", storage_path: "s2/cv.pdf" },
        ]),
      ),
    );

    const client_ = client();
    const requestedPaths: string[] = [];
    client_.storage.from = ((bucket: string) => ({
      createSignedUrls: async (paths: string[]) => {
        requestedPaths.push(...paths);
        return {
          data: paths.map((path) => ({
            path,
            signedUrl: `https://supabase.co/storage/v1/object/sign/${bucket}/${path}?token=secret`,
            error: null,
          })),
          error: null,
        };
      },
    })) as unknown as typeof client_.storage.from;

    const urls = await createSupabaseShortlistView(
      client_,
      async () => "cpc-1",
      async () => "central_placement_coordinator",
    ).resumeSignedUrls?.(["resume-1", "resume-2"]);

    expect(requestedPaths).toEqual(["s1/resume.pdf", "s2/cv.pdf"]);
    expect(urls?.get("resume-1")).toBe(
      "https://supabase.co/storage/v1/object/sign/resumes/s1/resume.pdf?token=secret",
    );
    expect(urls?.get("resume-2")).toBe(
      "https://supabase.co/storage/v1/object/sign/resumes/s2/cv.pdf?token=secret",
    );
  });

  it("returns an empty map when given no resume IDs", async () => {
    const urls = await view().resumeSignedUrls?.([]);
    expect(urls?.size).toBe(0);
  });
});
