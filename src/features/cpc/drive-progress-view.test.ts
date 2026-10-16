import { PostgrestReadError } from "@lib/postgrest-read";
import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseDriveProgressView } from "./drive-progress-view";

/**
 * The campus coordinator's full-cycle view (D10, 2026-08-12).
 *
 * No query here filters by campus: RLS does. What this file proves is the
 * ASSEMBLY — the right result against the right round for the right student,
 * because a progress screen that shuffles outcomes between students is worse
 * than none.
 */
const BASE = "https://project.supabase.co";

const client = () =>
  createClient(BASE, "anon-key", { auth: { persistSession: false, autoRefreshToken: false } });

const view = () => createSupabaseDriveProgressView(client());

function stub(
  opts: {
    applications?: unknown[];
    rounds?: unknown[];
    participants?: unknown[];
    attendance?: unknown[];
    results?: unknown[];
    offers?: unknown[];
  } = {},
): { applicationQueries: string[] } {
  const applicationQueries: string[] = [];
  server.use(
    http.get(`${BASE}/rest/v1/applications`, ({ request }) => {
      applicationQueries.push(request.url);
      return HttpResponse.json(opts.applications ?? []);
    }),
    http.get(`${BASE}/rest/v1/drive_rounds`, () => HttpResponse.json(opts.rounds ?? [])),
    http.get(`${BASE}/rest/v1/round_participants`, () =>
      HttpResponse.json(opts.participants ?? []),
    ),
    http.get(`${BASE}/rest/v1/attendance`, () => HttpResponse.json(opts.attendance ?? [])),
    http.get(`${BASE}/rest/v1/round_results`, () => HttpResponse.json(opts.results ?? [])),
    http.get(`${BASE}/rest/v1/offers`, () => HttpResponse.json(opts.offers ?? [])),
  );
  return { applicationQueries };
}

const APPLICATION = {
  id: "a1",
  student_id: "s1",
  drive_id: "d1",
  students: { full_name: "Priya Ramesh", roll_number: "21CSE1042" },
  shortlist_entries: [{ included: true }],
  drives: { company_name: "Zoho", role_title: "Engineer", status: "in_rounds" },
};

/** Priya was called to both rounds. */
const TWO_ROUNDS = {
  rounds: [
    { id: "r2", drive_id: "d1", sequence: 2, name: "Technical" },
    { id: "r1", drive_id: "d1", sequence: 1, name: "Aptitude" },
  ],
  participants: [
    { round_id: "r1", application_id: "a1" },
    { round_id: "r2", application_id: "a1" },
  ],
};

describe("createSupabaseDriveProgressView", () => {
  it("assembles a student's rounds in sequence, each with its own result", async () => {
    stub({
      applications: [APPLICATION],
      ...TWO_ROUNDS,
      attendance: [
        { round_id: "r2", application_id: "a1", status: "scheduled" },
        { round_id: "r1", application_id: "a1", status: "present" },
      ],
      results: [{ round_id: "r1", application_id: "a1", result: "selected" }],
    });

    const drives = await view().drives();
    expect(drives).toHaveLength(1);
    expect(drives[0]?.companyName).toBe("Zoho");
    expect(drives[0]?.students[0]?.rounds).toEqual([
      { sequence: 1, name: "Aptitude", attendance: "present", result: "selected" },
      { sequence: 2, name: "Technical", attendance: "scheduled", result: null },
    ]);
  });

  it("names the student, not just the application row", async () => {
    stub({ applications: [APPLICATION] });

    const [student] = (await view().drives())[0]?.students ?? [];

    expect(student?.studentId).toBe("s1");
    expect(student?.applicationId).toBe("a1");
  });

  /**
   * The round list used to be built FROM ATTENDANCE, so a student called to a
   * round nobody had marked yet showed as not in rounds here while the
   * dashboard next door counted them in it. Being called is
   * `round_participants`; attendance is what happened after.
   */
  it("lists a round the student was called to even where nobody took attendance", async () => {
    stub({
      applications: [APPLICATION],
      ...TWO_ROUNDS,
      attendance: [{ round_id: "r1", application_id: "a1", status: "present" }],
    });

    expect((await view().drives())[0]?.students[0]?.rounds).toEqual([
      { sequence: 1, name: "Aptitude", attendance: "present", result: null },
      { sequence: 2, name: "Technical", attendance: "scheduled", result: null },
    ]);
  });

  it("does not put a student in a round they were never called to", async () => {
    stub({
      applications: [APPLICATION],
      ...TWO_ROUNDS,
      attendance: [
        { round_id: "r1", application_id: "a1", status: "present" },
        { round_id: "r2", application_id: "a1", status: "present" },
        // A row for a round of another drive's, carried by the same id space.
        { round_id: "r9", application_id: "a1", status: "absent" },
      ],
    });

    const [student] = (await view().drives())[0]?.students ?? [];

    expect(student?.rounds.map((r) => r.name)).toEqual(["Aptitude", "Technical"]);
  });

  /** One `included: true` anywhere is enough; the first embedded row is not. */
  it("reads every shortlist row, so a re-included student stays shortlisted", async () => {
    stub({
      applications: [
        { ...APPLICATION, shortlist_entries: [{ included: false }, { included: true }] },
      ],
    });

    expect((await view().drives())[0]?.students[0]?.shortlisted).toBe(true);
  });

  it("never attributes one student's offer to another", async () => {
    stub({
      applications: [
        APPLICATION,
        { ...APPLICATION, id: "a2", student_id: "s2", students: { full_name: "Arjun Menon" } },
      ],
      offers: [{ student_id: "s2", drive_id: "d1", ctc_lpa: 8, offer_category: "dream" }],
    });

    const drives = await view().drives();
    const arjun = drives[0]?.students.find((s) => s.studentName === "Arjun Menon");
    const priya = drives[0]?.students.find((s) => s.studentName === "Priya Ramesh");
    // 0070 (2026-08-27): an offer now states WHICH figure it carries. The
    // rule this test holds — that Arjun's offer is Arjun's — is untouched.
    expect(arjun?.offer).toEqual({
      ctcLpa: 8,
      stipendMonthly: null,
      driveType: "placement",
      offerCategory: "dream",
    });
    expect(priya?.offer).toBeNull();
  });

  it("marks an undecided application as not shortlisted", async () => {
    stub({ applications: [{ ...APPLICATION, shortlist_entries: [] }] });

    const drives = await view().drives();
    expect(drives[0]?.students[0]?.shortlisted).toBe(false);
  });

  it("groups applications by drive", async () => {
    stub({
      applications: [
        APPLICATION,
        {
          ...APPLICATION,
          id: "a9",
          drive_id: "d2",
          drives: { company_name: "TCS", role_title: null, status: "live" },
        },
      ],
    });

    const drives = await view().drives();
    expect(drives.map((d) => d.companyName)).toEqual(["TCS", "Zoho"]);
  });

  it("returns nothing quietly when no application is visible", async () => {
    stub();
    expect(await view().drives()).toEqual([]);
  });

  it("asks for the applications a page at a time rather than trusting the 1000-row cap", async () => {
    const { applicationQueries } = stub({ applications: [APPLICATION] });

    await view().drives();

    expect(applicationQueries[0]).toContain("offset=0&limit=1000");
  });

  /**
   * Every read here used to discard its `error`. A coordinator whose attendance
   * read was refused saw students with no rounds at all — the same picture as
   * students who never got called, and there is no answer a campus manager
   * acts on more wrongly.
   */
  it("throws rather than showing a cycle it could not read", async () => {
    stub({ applications: [APPLICATION], ...TWO_ROUNDS });
    server.use(
      http.get(`${BASE}/rest/v1/attendance`, () =>
        HttpResponse.json({ message: "permission denied" }, { status: 401 }),
      ),
    );

    await expect(view().drives()).rejects.toThrow(PostgrestReadError);
  });

  it("throws rather than showing an empty campus", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/applications`, () =>
        HttpResponse.json({ message: "permission denied" }, { status: 401 }),
      ),
    );

    await expect(view().drives()).rejects.toThrow(PostgrestReadError);
  });
});
