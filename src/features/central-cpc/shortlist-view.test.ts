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

const APPLICATION = {
  id: "app-1",
  student_id: "s1",
  profile_snapshot: {
    fullName: "Anjali Subramanian",
    rollNumber: "21CSE1042",
    academics: { overallCgpa: 8.4, currentArrears: 0, historyOfArrears: 1 },
    preferredRoleCategories: ["software_technical"],
  },
  students: { full_name: "LIVE NAME", roll_number: "LIVE ROLL" },
  shortlist_entries: [{ included: true }],
};

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
    http.get(`${BASE}/rest/v1/applications`, () =>
      HttpResponse.json(opts.applications ?? [APPLICATION]),
    ),
    http.get(`${BASE}/rest/v1/skill_scores`, () => {
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
   * A12: skill_scores carries its own max_score, so a 45/50 is 90 - not 45.
   * R11 weights the skill match against a 0-100 scale, and feeding it a raw
   * score silently under-ranks every student assessed out of anything else.
   */
  it("normalises a skill score against its own maximum", async () => {
    stub({ skills: [{ student_id: "s1", metric: "Java", score: 45, max_score: 50 }] });

    expect((await view().applicants("d1"))[0]?.skillScores).toEqual([{ skill: "Java", score: 90 }]);
  });

  it("scores zero rather than dividing by a zero maximum", async () => {
    stub({ skills: [{ student_id: "s1", metric: "Java", score: 45, max_score: 0 }] });

    expect((await view().applicants("d1"))[0]?.skillScores).toEqual([{ skill: "Java", score: 0 }]);
  });

  it("never attributes one student's skill scores to another", async () => {
    stub({ skills: [{ student_id: "someone-else", metric: "Java", score: 50, max_score: 100 }] });

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

describe("saving the shortlist", () => {
  const decision = {
    applicationId: "app-1",
    included: true,
    rank: 1,
    score: 91.5,
    rationale: "Top coding score",
  };

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
