import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabasePortfolioView } from "./portfolio-view";

/**
 * The owner's view of their drives, from live rows.
 *
 * Which drives come back at all is RLS's decision - an AE is returned only the
 * drives they raised - so this file is about the shape, not the scope: the
 * applicant list is read from `profile_snapshot`, the frozen copy taken at
 * apply time, never from the live student row. That is both the immutability
 * rule (PRD §7.3) and the only way an AE, who cannot read `students`, can see
 * who applied at all.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const DRIVE = {
  id: "d1",
  company_name: "Zoho Corporation",
  role_title: "Member Technical Staff",
  status: "in_rounds",
  on_hold: false,
  created_by: "ae-1",
  approved_by: "dh-1",
  published_by: "cpc-1",
  drive_rounds: [
    {
      id: "r1",
      sequence: 1,
      name: "Online test",
      round_participants: [{ application_id: "app-1" }],
      round_results: [{ application_id: "app-1", result: "selected" }],
      attendance: [{ application_id: "app-1", status: "present" }],
    },
    {
      id: "r2",
      sequence: 2,
      name: "Technical interview",
      round_participants: [],
      round_results: [],
      attendance: [],
    },
  ],
  applications: [
    {
      id: "app-1",
      student_id: "s1",
      profile_snapshot: {
        profile: { fullName: "Anjali Subramanian", rollNumber: "21CSE1042" },
      },
      students: { campuses: { name: "Alliance University" } },
      shortlist_entries: [{ included: true }],
    },
  ],
};

const stub = (drives: unknown[] = [DRIVE], offers: unknown[] = []) =>
  server.use(
    http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json(drives)),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(offers)),
  );

const view = () => createSupabasePortfolioView(client());

describe("createSupabasePortfolioView", () => {
  it("carries the ownership through, so the screen can say whose drive it is", async () => {
    stub();
    const [drive] = await view().drives();

    expect(drive?.createdBy).toBe("ae-1");
    expect(drive?.approvedBy).toBe("dh-1");
    expect(drive?.publishedBy).toBe("cpc-1");
  });

  it("counts a round as decided only once a result has been declared in it", async () => {
    stub();
    const [drive] = await view().drives();

    expect(drive?.totalRounds).toBe(2);
    expect(drive?.roundsDecided).toBe(1);
  });

  it("names applicants from the frozen snapshot, not the live student row", async () => {
    stub();
    const [drive] = await view().drives();

    expect(drive?.applicants[0]?.studentName).toBe("Anjali Subramanian");
    expect(drive?.applicants[0]?.rollNumber).toBe("21CSE1042");
    expect(drive?.applicants[0]?.campus).toBe("Alliance University");
  });

  it("still shows an applicant whose campus it is not allowed to read", async () => {
    stub([{ ...DRIVE, applications: [{ ...DRIVE.applications[0], students: null }] }]);
    const [drive] = await view().drives();

    expect(drive?.applicants[0]?.studentName).toBe("Anjali Subramanian");
    expect(drive?.applicants[0]?.campus).toBe("—");
  });

  it("attaches each applicant's rounds, marking the ones that named them", async () => {
    stub();
    const rounds = (await view().drives())[0]?.applicants[0]?.rounds;

    expect(rounds).toEqual([
      {
        sequence: 1,
        name: "Online test",
        participating: true,
        attendance: "present",
        result: "selected",
      },
      {
        sequence: 2,
        name: "Technical interview",
        participating: false,
        attendance: null,
        result: null,
      },
    ]);
  });

  it("reads whether a coordinator included the applicant in the recruiter list", async () => {
    stub();
    expect((await view().drives())[0]?.applicants[0]?.shortlisted).toBe(true);
  });

  it("treats a shortlist it cannot read as not shortlisted, never as included", async () => {
    stub([{ ...DRIVE, applications: [{ ...DRIVE.applications[0], shortlist_entries: [] }] }]);

    expect((await view().drives())[0]?.applicants[0]?.shortlisted).toBe(false);
  });

  it("marks the applicants who ended with an offer from this drive", async () => {
    stub([DRIVE], [{ drive_id: "d1", student_id: "s1" }]);
    const [drive] = await view().drives();

    expect(drive?.applicants[0]?.hasOffer).toBe(true);
  });

  it("does not credit this drive with an offer that came from another", async () => {
    stub([DRIVE], [{ drive_id: "elsewhere", student_id: "s1" }]);

    expect((await view().drives())[0]?.applicants[0]?.hasOffer).toBe(false);
  });

  it("survives a drive with no rounds and no applicants", async () => {
    stub([
      {
        ...DRIVE,
        id: "d2",
        drive_rounds: [],
        applications: [],
        role_title: null,
      },
    ]);
    const [drive] = await view().drives();

    expect(drive?.totalRounds).toBe(0);
    expect(drive?.applicants).toEqual([]);
    expect(drive?.roleTitle).toBe("Role not specified");
  });

  it("returns nothing when RLS returns nothing, rather than failing", async () => {
    stub([]);
    expect(await view().drives()).toEqual([]);
  });
});
