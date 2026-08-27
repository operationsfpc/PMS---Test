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

function stub(opts: { drives?: unknown[]; attendance?: unknown[]; applicants?: number } = {}) {
  server.use(
    http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json(opts.drives ?? [DRIVE])),
    http.get(`${BASE}/rest/v1/attendance`, () => HttpResponse.json(opts.attendance ?? [])),
    // An exact count is a HEAD request; PostgREST answers in content-range.
    http.head(`${BASE}/rest/v1/applications`, () => {
      const total = opts.applicants ?? 0;
      return new HttpResponse(null, {
        headers: { "content-range": `0-${Math.max(total - 1, 0)}/${total}` },
      });
    }),
  );
}

const view = () => createSupabaseCockpitView(client());

describe("cockpit drives", () => {
  it("counts applications without pulling the applicants themselves", async () => {
    stub({ applicants: 42 });

    expect((await view().drives())[0]?.applicationCount).toBe(42);
  });

  it("puts the rounds in sequence order, not the order the database returned them", async () => {
    stub();

    expect((await view().drives())[0]?.rounds.map((r) => r.name)).toEqual([
      "Online test",
      "Technical interview",
    ]);
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
    server.use(
      http.get(`${BASE}/rest/v1/drives`, () =>
        HttpResponse.json([
          {
            ...DRIVE,
            drive_type: "internship",
            stipend_min_monthly: 15000,
            stipend_max_monthly: 20000,
          },
        ]),
      ),
    );

    const [drive] = await createSupabaseCockpitView(client()).drives();
    expect(drive?.driveType).toBe("internship");
    expect(drive?.stipendMinMonthly).toBe(15000);
    expect(drive?.stipendMaxMonthly).toBe(20000);
  });

  it("leaves them null when the drive records none", async () => {
    server.use(http.get(`${BASE}/rest/v1/drives`, () => HttpResponse.json([DRIVE])));

    const [drive] = await createSupabaseCockpitView(client()).drives();
    expect(drive?.driveType ?? null).toBeNull();
    expect(drive?.stipendMinMonthly ?? null).toBeNull();
  });
});
