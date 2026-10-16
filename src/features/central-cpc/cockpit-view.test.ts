import { PostgrestReadError } from "@lib/postgrest-read";
import { createClient } from "@supabase/supabase-js";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../mocks/node";
import { createSupabaseCockpitView } from "./cockpit-view";

/**
 * The drive cockpit's data layer — the Central CPC's, the Delivery Head's and
 * the AE's shared view of every drive.
 *
 * Untested until now, which mattered most for `reviews()`: R8 counts absences
 * across a student's ENTIRE tenure with no per-drive reset, and three of them
 * raise a disbarment review. Grouping those rows by the wrong key either
 * accuses a student who was never absent or hides one who was.
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
  drive_rounds: [
    { id: "r2", sequence: 2, name: "Technical interview" },
    { id: "r1", sequence: 1, name: "Online test" },
  ],
};

const absence = (studentId: string, roundId: string, name = "Anjali", roll = "21CSE1042") => ({
  status: "absent",
  round_id: roundId,
  applications: {
    student_id: studentId,
    drive_id: "d1",
    students: { full_name: name, roll_number: roll },
  },
});

function stub(
  opts: { drives?: unknown[]; attendance?: unknown[]; applications?: unknown[] } = {},
): {
  driveQueries: string[];
  applicationQueries: string[];
} {
  const driveQueries: string[] = [];
  const applicationQueries: string[] = [];
  server.use(
    http.get(`${BASE}/rest/v1/drives`, ({ request }) => {
      driveQueries.push(request.url);
      return HttpResponse.json(opts.drives ?? [DRIVE]);
    }),
    http.get(`${BASE}/rest/v1/attendance`, () => HttpResponse.json(opts.attendance ?? [])),
    http.get(`${BASE}/rest/v1/applications`, ({ request }) => {
      applicationQueries.push(request.url);
      return HttpResponse.json(opts.applications ?? []);
    }),
  );
  return { driveQueries, applicationQueries };
}

/** One row of `applications` — who applied to which drive. */
const applied = (driveId: string, studentId: string) => ({
  drive_id: driveId,
  student_id: studentId,
});

const view = () => createSupabaseCockpitView(client());

describe("cockpit drives", () => {
  /**
   * This used to be a `count: "exact"` HEAD request per drive, and the test
   * proved the wrong thing: the cockpit needs the number AND the names behind
   * it, because a count that opens a popup has to be able to say who. One
   * grouped read answers both.
   */
  it("counts the applicants it read, and keeps who they were", async () => {
    stub({
      applications: ["s1", "s2", "s3"].map((id) => applied("d1", id)),
    });

    const [drive] = await view().drives();

    expect(drive?.applicationCount).toBe(3);
    expect(drive?.applicantStudentIds).toEqual(["s1", "s2", "s3"]);
  });

  it("reads every drive's applicants in one query, not one per card", async () => {
    const { applicationQueries } = stub({
      drives: [DRIVE, { ...DRIVE, id: "d2" }, { ...DRIVE, id: "d3" }],
      applications: [applied("d1", "s1"), applied("d2", "s2"), applied("d3", "s3")],
    });

    const drives = await view().drives();

    expect(applicationQueries).toHaveLength(1);
    expect(drives.map((d) => d.applicationCount)).toEqual([1, 1, 1]);
  });

  it("keeps one drive's applicants out of another's count", async () => {
    stub({
      drives: [DRIVE, { ...DRIVE, id: "d2" }],
      applications: [applied("d1", "s1"), applied("d1", "s2"), applied("d2", "s3")],
    });

    const drives = await view().drives();

    expect(drives.map((d) => [d.driveId, d.applicationCount, d.applicantStudentIds])).toEqual([
      ["d1", 2, ["s1", "s2"]],
      ["d2", 1, ["s3"]],
    ]);
  });

  it("reports no applicants rather than failing on a drive nobody applied to", async () => {
    stub({ applications: [] });
    const [drive] = await view().drives();

    expect(drive?.applicationCount).toBe(0);
    expect(drive?.applicantStudentIds).toEqual([]);
  });

  it("asks for the queue a page at a time rather than trusting the 1000-row cap", async () => {
    const { driveQueries } = stub();

    await view().drives();

    expect(driveQueries[0]).toContain("offset=0&limit=1000");
  });

  it("puts the rounds in sequence order, not the order the database returned them", async () => {
    stub();

    expect((await view().drives())[0]?.rounds.map((r) => r.name)).toEqual([
      "Online test",
      "Technical interview",
    ]);
  });

  it("carries the colleges the drive targets onto the summary", async () => {
    stub({
      drives: [
        {
          ...DRIVE,
          drive_target_campuses: [
            { campuses: { name: "PSG Tech" } },
            { campuses: { name: "Sona College" } },
          ],
        },
      ],
    });

    expect((await view().drives())[0]?.campuses).toEqual(["PSG Tech", "Sona College"]);
  });

  it("reads an empty targeting as open to every campus, not as an error", async () => {
    stub({ drives: [{ ...DRIVE, drive_target_campuses: [] }] });

    expect((await view().drives())[0]?.campuses).toEqual([]);
  });

  it("shows a drive that has no rounds yet rather than dropping it", async () => {
    stub({ drives: [{ ...DRIVE, drive_rounds: [] }] });
    const [drive] = await view().drives();

    expect(drive?.rounds).toEqual([]);
    expect(drive?.driveId).toBe("d1");
  });

  it("names a drive whose company is missing, so the row is still actionable", async () => {
    stub({ drives: [{ id: "d9", company_name: null, role_title: null, drive_rounds: [] }] });
    const [drive] = await view().drives();

    expect(drive?.companyName).toBe("Unnamed drive");
    expect(drive?.roleTitle).toBeNull();
    // A drive with no status yet is a draft, never a blank badge.
    expect(drive?.status).toBe("draft");
    expect(drive?.onHold).toBe(false);
  });

  it("carries the on-hold flag through, because a held drive cannot be published", async () => {
    stub({ drives: [{ ...DRIVE, on_hold: true }] });

    expect((await view().drives())[0]?.onHold).toBe(true);
  });

  it("returns nothing when there are no drives, rather than failing", async () => {
    stub({ drives: [] });

    expect(await view().drives()).toEqual([]);
  });
});

describe("the off-campus venue (UAT 2026-08-21, item 2)", () => {
  it("carries the drive mode and venue onto the card", async () => {
    stub({
      drives: [
        { ...DRIVE, drive_mode: "physical_outside_campus", venue: "HCL Campus, Sholinganallur" },
      ],
    });
    const [drive] = await view().drives();
    expect(drive?.driveMode).toBe("physical_outside_campus");
    expect(drive?.venue).toBe("HCL Campus, Sholinganallur");
  });

  it("records the confirmed venue with a PATCH on the one drive", async () => {
    let patched: { url: string; body: Record<string, unknown> } | null = null;
    server.use(
      http.patch(`${BASE}/rest/v1/drives`, async ({ request }) => {
        patched = {
          url: request.url,
          body: (await request.json()) as Record<string, unknown>,
        };
        return HttpResponse.json(null);
      }),
    );

    await view().updateVenue?.("d1", "HCL Campus, Sholinganallur");

    expect(patched).not.toBeNull();
    const p = patched as unknown as { url: string; body: Record<string, unknown> };
    expect(p.url).toContain("id=eq.d1");
    expect(p.body).toEqual({ venue: "HCL Campus, Sholinganallur" });
  });

  it("surfaces a refusal instead of pretending the venue saved", async () => {
    server.use(
      http.patch(`${BASE}/rest/v1/drives`, () =>
        HttpResponse.json({ message: "permission denied" }, { status: 403 }),
      ),
    );

    await expect(view().updateVenue?.("d1", "Somewhere")).rejects.toThrow(/could not save/i);
  });
});

describe("cockpit disbarment reviews (R8)", () => {
  it("raises a review at three absences, counted across different drives", async () => {
    stub({
      attendance: [absence("s1", "r1"), absence("s1", "r2"), absence("s1", "r3")],
    });

    const reviews = await view().reviews();

    expect(reviews).toEqual([
      { studentId: "s1", studentName: "Anjali", rollNumber: "21CSE1042", absences: 3 },
    ]);
  });

  it("does not raise a review below the limit", async () => {
    stub({ attendance: [absence("s1", "r1"), absence("s1", "r2")] });

    expect(await view().reviews()).toEqual([]);
  });

  it("counts each student separately, so one student's absences never accuse another", async () => {
    stub({
      attendance: [
        absence("s1", "r1"),
        absence("s1", "r2"),
        absence("s2", "r1", "Rahul", "21CSE1099"),
      ],
    });

    expect(await view().reviews()).toEqual([]);
  });

  it("puts the student in the most trouble at the top", async () => {
    stub({
      attendance: [
        absence("s1", "r1"),
        absence("s1", "r2"),
        absence("s1", "r3"),
        absence("s2", "r1", "Rahul", "21CSE1099"),
        absence("s2", "r2", "Rahul", "21CSE1099"),
        absence("s2", "r3", "Rahul", "21CSE1099"),
        absence("s2", "r4", "Rahul", "21CSE1099"),
      ],
    });

    expect((await view().reviews()).map((r) => r.studentId)).toEqual(["s2", "s1"]);
  });

  /**
   * Three of them, deliberately: one unresolvable row can never reach the
   * limit on its own, so a single row would pass whether the guard existed or
   * not. Three would group under one undefined key and accuse a student who
   * does not exist.
   */
  it("skips rows whose application it cannot resolve, rather than inventing a student", async () => {
    stub({
      attendance: [1, 2, 3].map((n) => ({
        status: "absent",
        round_id: `r${n}`,
        applications: null,
      })),
    });

    expect(await view().reviews()).toEqual([]);
  });

  it("still reports a student whose name did not come back", async () => {
    stub({
      attendance: [1, 2, 3].map((n) => ({
        status: "absent",
        round_id: `r${n}`,
        applications: { student_id: "s1", drive_id: "d1", students: null },
      })),
    });

    const [review] = await view().reviews();

    expect(review?.studentName).toBe("Unknown student");
    expect(review?.rollNumber).toBe("—");
  });
});

/**
 * 2026-08-27: the cockpit filters and tags by drive type, and shows an
 * internship's stipend, so the view has to fetch all three columns.
 */
describe("createSupabaseCockpitView — the drive type and the stipend", () => {
  it("carries the type and the stipend through to the screen", async () => {
    stub({
      drives: [
        {
          ...DRIVE,
          drive_type: "internship",
          stipend_min_monthly: 15000,
          stipend_max_monthly: 20000,
        },
      ],
    });

    const [drive] = await createSupabaseCockpitView(client()).drives();
    expect(drive?.driveType).toBe("internship");
    expect(drive?.stipendMinMonthly).toBe(15000);
    expect(drive?.stipendMaxMonthly).toBe(20000);
  });

  it("leaves them null when the drive records none", async () => {
    stub({ drives: [DRIVE] });

    const [drive] = await createSupabaseCockpitView(client()).drives();
    expect(drive?.driveType ?? null).toBeNull();
    expect(drive?.stipendMinMonthly ?? null).toBeNull();
  });
});

/**
 * The two reads this view makes used to discard their `error` and carry on
 * with `data === null`, which the screen rendered as an empty queue. A refusal
 * and an emptiness are opposite answers, and only one of them is safe to act
 * on — the Central CPC publishes from this list.
 */
describe("createSupabaseCockpitView — a read that failed", () => {
  it("throws rather than listing no drives", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/drives`, () =>
        HttpResponse.json({ message: "permission denied for table drives" }, { status: 401 }),
      ),
    );

    await expect(view().drives()).rejects.toThrow(PostgrestReadError);
  });

  it("throws rather than listing no applicants against a drive it did read", async () => {
    stub();
    server.use(
      http.get(`${BASE}/rest/v1/applications`, () =>
        HttpResponse.json({ message: "permission denied" }, { status: 401 }),
      ),
    );

    await expect(view().drives()).rejects.toThrow(PostgrestReadError);
  });

  it("throws rather than reporting that no student needs a review", async () => {
    server.use(
      http.get(`${BASE}/rest/v1/attendance`, () =>
        HttpResponse.json({ message: "permission denied" }, { status: 401 }),
      ),
    );

    await expect(view().reviews()).rejects.toThrow(PostgrestReadError);
  });
});
