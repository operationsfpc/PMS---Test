// @vitest-environment jsdom
import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  DashboardPage,
  type DashboardScope,
  type DashboardSnapshot,
  type DashboardView,
} from "./dashboard-page";

/**
 * The dashboard links out since 2026-08-17 - the Placed count opens the
 * breakdown behind it - so it needs a router. Wrapping here rather than at
 * every call site keeps the 26 existing tests reading as they did.
 */
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

/**
 * The executive dashboard.
 *
 * Read-only (A20). Every number on it is computed by src/domain/statistics.ts,
 * so the placement rate shown to the CEO is the same rule the coordinators
 * work against - not a separate SELECT that quietly disagrees.
 */
const SNAPSHOT: DashboardSnapshot = {
  students: [
    {
      studentId: "a",
      fullName: "Priya Ramesh",
      rollNumber: "21CSE101",
      degree: "B.Tech",
      branch: "CSE",
      passingYear: 2026,
      cgpa: 8.8,
      participationStatus: "active",
      hasOnCampusPlacement: true,
      hasSelfPlacement: false,
      srfStatus: "srf_approved",
      hasApplied: true,
      campusId: "c1",
      campusName: "Alliance University",
    },
    {
      studentId: "b",
      fullName: "Rahul Verma",
      rollNumber: "21IT202",
      degree: "B.Tech",
      branch: "IT",
      passingYear: 2026,
      cgpa: 7.9,
      participationStatus: "active",
      hasOnCampusPlacement: false,
      hasSelfPlacement: true,
      srfStatus: "srf_approved",
      hasApplied: true,
      campusId: "c2",
      campusName: "VIT Bangalore",
    },
    {
      studentId: "c",
      fullName: "Anita Rao",
      rollNumber: "22ECE303",
      degree: "B.E",
      branch: "ECE",
      passingYear: 2027,
      cgpa: 6.4,
      participationStatus: "opted_out",
      hasOnCampusPlacement: false,
      hasSelfPlacement: false,
      srfStatus: "invited",
      hasApplied: false,
      campusId: "c1",
      campusName: "Alliance University",
    },
  ],
  placements: [{ studentId: "a", ctcLpa: 9, category: "dream" }],
  drivesByStatus: { live: 2, in_rounds: 1, completed: 2 },
  statusDrives: [
    {
      driveId: "d1",
      companyName: "Zoho Corporation",
      roleTitle: "Member Technical Staff",
      status: "live",
      driveType: "placement",
      companyDriveId: "event-1",
      tentativeDate: null,
      campuses: ["Alliance University"],
    },
    {
      driveId: "d3",
      companyName: "Freshworks",
      roleTitle: "SDE",
      status: "live",
      driveType: "placement",
      companyDriveId: null,
      tentativeDate: null,
      campuses: [],
    },
    {
      driveId: "d4",
      companyName: "Amazon",
      roleTitle: null,
      status: "in_rounds",
      driveType: "placement",
      companyDriveId: null,
      tentativeDate: null,
      campuses: [],
    },
    {
      driveId: "d5",
      companyName: "TCS",
      roleTitle: "Assistant System Engineer",
      status: "completed",
      driveType: "placement",
      companyDriveId: "event-2",
      tentativeDate: null,
      campuses: ["VIT Bangalore"],
    },
    {
      driveId: "d6",
      companyName: "Infosys",
      roleTitle: "Systems Engineer",
      status: "completed",
      driveType: "placement",
      // Each row below is its own company visit, so drivesByStatus above is the
      // count the view would actually return for it. The tests that want a
      // multi-role visit say so in their own fixture.
      companyDriveId: "event-3",
      tentativeDate: null,
      campuses: [],
    },
  ],
  liveDrives: [
    {
      driveId: "d1",
      companyName: "Zoho Corporation",
      roleTitle: "Member Technical Staff",
      driveType: "placement",
      companyDriveId: "event-1",
      tentativeDate: null,
      applicationStart: "2026-09-01T00:00:00.000Z",
      applicationEnd: "2026-09-10T00:00:00.000Z",
      eligible: 120,
      eligibleStudentIds: ["a", "b", "c"],
      applied: 30,
      appliedStudentIds: ["a", "b"],
      offers: 3,
      offerStudentIds: ["a"],
    },
  ],
  now: "2026-09-05T10:00:00.000Z",
  // One entry per category SOMEBODY holds, as a placement record (R9): student
  // "a" is the only placed student, so "a" is the only id. The rows that need
  // more categories say so in the test that reads them.
  offerCategories: [{ category: "dream", studentIds: ["a"] }],
  campuses: [
    { campusId: "c1", campusName: "Alliance University", eligible: 2, placed: 1 },
    { campusId: "c2", campusName: "VIT Bangalore", eligible: 0, placed: 0 },
  ],
  driveProgress: [
    {
      driveId: "d1",
      driveName: "Zoho Corporation — Member Technical Staff",
      companyName: "Zoho Corporation",
      roleTitle: "Member Technical Staff",
      driveType: "placement",
      status: "live",
      companyDriveId: "event-1",
      tentativeDate: null,
      campusNames: ["Alliance University"],
      students: [
        {
          applicationId: "app-1",
          studentId: "a",
          studentName: "Priya Ramesh",
          rollNumber: "21CSE101",
          campusId: "c1",
          campusName: "Alliance University",
          degree: "B.Tech",
          branch: "CSE",
          cgpa: 8.8,
          shortlisted: true,
          rounds: [
            {
              roundId: "r1",
              sequence: 1,
              name: "Aptitude",
              attendance: "present",
              result: "selected",
            },
          ],
          offer: {
            ctcLpa: 9,
            stipendMonthly: 25000,
            driveType: "placement",
            offerCategory: "dream",
          },
        },
      ],
      participation: {
        eligible: 120,
        applied: 30,
        shortlisted: 12,
        offers: 3,
        rounds: [
          {
            roundId: "r1",
            sequence: 1,
            name: "Aptitude",
            participants: [
              { studentId: "a", attendance: "present", result: "selected" },
              { studentId: "b", attendance: "absent", result: null },
            ],
          },
        ],
      },
    },
    {
      driveId: "d2",
      driveName: "Freshworks — SDE",
      companyName: "Freshworks",
      roleTitle: "SDE",
      driveType: "placement",
      status: "in_rounds",
      companyDriveId: null,
      tentativeDate: null,
      campusNames: ["VIT Bangalore"],
      students: [],
      participation: {
        eligible: 40,
        applied: 10,
        shortlisted: 4,
        offers: 1,
        rounds: [],
      },
    },
  ],
};

const view = (snapshot: DashboardSnapshot = SNAPSHOT): DashboardView => ({
  snapshot: async () => snapshot,
});

describe("DashboardPage", () => {
  it("shows the placement rate from the domain rule, excluding opt-outs", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    // 1 placed of 2 counted (the opted-out student leaves the denominator).
    const headline = await screen.findByRole("region", { name: /headline/i });
    expect(within(headline).getByText("50%")).toBeDefined();
  });

  it("reports self-placement and opt-out on their own lines", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const headline = await screen.findByRole("region", { name: /headline/i });
    expect(within(headline).getByText(/self-placed/i)).toBeDefined();
    expect(within(headline).getByText(/opted out/i)).toBeDefined();
  });

  it("breaks offers down by category", async () => {
    render(
      <DashboardPage
        title="Executive overview"
        view={view({
          ...SNAPSHOT,
          offerCategories: [
            { category: "dream", studentIds: ["a"] },
            { category: "super_dream", studentIds: ["a", "b"] },
          ],
        })}
      />,
    );

    const section = await screen.findByRole("region", { name: /offers by category/i });
    expect(within(section).getByText(/super dream/i)).toBeDefined();
  });

  it("shows a per-campus breakdown", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const section = await screen.findByRole("region", { name: /by campus/i });
    expect(within(section).getByText("Alliance University")).toBeDefined();
  });

  it("shows a campus with no students without dividing by zero", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const section = await screen.findByRole("region", { name: /by campus/i });
    const row = within(section).getByText("VIT Bangalore").closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText("0%")).toBeDefined();
  });

  it("uses the title it is given, so each role can label its own view", async () => {
    render(<DashboardPage view={view()} title="Campus overview" />);

    expect(
      await screen.findByRole("heading", { level: 1, name: /campus overview/i }),
    ).toBeDefined();
  });

  it("says so plainly when there is no data yet", async () => {
    render(
      <DashboardPage
        title="Executive overview"
        view={view({
          students: [],
          placements: [],
          drivesByStatus: {},
          statusDrives: [],
          offerCategories: [],
          campuses: [],
          liveDrives: [],
          driveProgress: [],
          now: "2026-09-05T10:00:00.000Z",
        })}
      />,
    );

    expect(await screen.findByText(/no students yet/i)).toBeDefined();
  });
});

/**
 * "Total registered students, through to number of students placed, to CTC
 * details" — requested 2026-08-05 for every stakeholder.
 *
 * Both panels are read from src/domain, so the funnel on the CEO's screen and
 * the package quoted in a board pack come from the same rules the coordinators
 * work against.
 */
describe("the students overview", () => {
  /**
   * F5 (UAT 2026-08-06): "The current registration funnel should have only the
   * items 1,2,3 and 5. rENAME IT AS students overview or so."
   */
  it("shows the four stages that are facts about a student", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const funnel = await screen.findByRole("region", { name: /students overview/i });

    for (const stage of [
      "On the roster",
      "Registration form submitted",
      "Verified by a coordinator",
      "Placed",
    ]) {
      expect(within(funnel).getByText(stage)).toBeDefined();
    }
  });

  it("no longer carries the drive-specific stage", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const funnel = await screen.findByRole("region", { name: /students overview/i });
    expect(within(funnel).queryByText("Applied to a drive")).toBeNull();
  });

  it("counts each stage, and says what share of the roster it is", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const funnel = await screen.findByRole("region", { name: /students overview/i });
    const roster = within(funnel).getByText("On the roster").closest("li");
    if (roster === null) throw new Error("stage not found");

    expect(within(roster).getByText("3")).toBeDefined();
    expect(within(roster).getByText(/100%/)).toBeDefined();
  });

  it("shows the two students who registered, of the three on the roster", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const funnel = await screen.findByRole("region", { name: /students overview/i });
    const verified = within(funnel).getByText("Verified by a coordinator").closest("li");
    if (verified === null) throw new Error("stage not found");

    expect(within(verified).getByText("2")).toBeDefined();
    expect(within(verified).getByText(/66.7%/)).toBeDefined();
  });
});

describe("the package figures", () => {
  it("quotes the highest, average and median package", async () => {
    render(
      <DashboardPage
        title="Executive overview"
        view={view({
          ...SNAPSHOT,
          placements: [
            { studentId: "a", ctcLpa: 6, category: "dream" },
            { studentId: "b", ctcLpa: 8, category: "dream" },
            { studentId: "d", ctcLpa: 30, category: "super_dream" },
          ],
        })}
      />,
    );

    const figures = await screen.findByRole("region", { name: "Package figures" });

    expect(within(figures).getByText("₹30 LPA")).toBeDefined();
    // The median is quoted BESIDE the average precisely because one large
    // package pulls them apart: ₹14.67 average against an ₹8 median.
    expect(within(figures).getByText("₹14.67 LPA")).toBeDefined();
    expect(within(figures).getByText("₹8 LPA")).toBeDefined();
  });

  it("breaks the package down by category", async () => {
    render(
      <DashboardPage
        title="Executive overview"
        view={view({
          ...SNAPSHOT,
          placements: [
            { studentId: "a", ctcLpa: 6, category: "dream" },
            { studentId: "d", ctcLpa: 30, category: "super_dream" },
          ],
        })}
      />,
    );

    const byCategory = await screen.findByRole("list", { name: /package by category/i });
    const superDream = within(byCategory)
      .getByText(/super dream/i)
      .closest("li");
    if (superDream === null) throw new Error("row not found");

    // Two placed at ₹30 would read "avg ₹30 LPA · high ₹30 LPA"; one reads both.
    expect(superDream.textContent).toContain("1 placed");
    expect(superDream.textContent).toContain("₹30 LPA");
  });

  it("says so plainly when nobody is placed yet, rather than quoting zero", async () => {
    render(
      <DashboardPage title="Executive overview" view={view({ ...SNAPSHOT, placements: [] })} />,
    );

    const packages = await screen.findByRole("region", { name: "Package" });

    expect(within(packages).getByText(/no packages yet/i)).toBeDefined();
    expect(within(packages).queryByText("₹0 LPA")).toBeNull();
  });
});

/**
 * Live drive data, requested 2026-08-05: "drives completed, number of offers
 * got in drives, open drives time left, number of eligible to applied
 * students".
 *
 * The clock and the conversion both come from src/domain/drive-analytics.ts,
 * and `now` is passed in rather than read from the browser — a coordinator's
 * laptop clock is not the authority on when applications close.
 */
describe("live drives", () => {
  it("counts how many drives have completed", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const headline = await screen.findByRole("region", { name: /headline/i });
    expect(within(headline).getByText(/drives completed/i)).toBeDefined();
    expect(within(headline).getByText("2")).toBeDefined();
  });

  it("shows each open drive with the time left to apply", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const live = await screen.findByRole("region", { name: /open drives/i });
    expect(within(live).getByText("Zoho Corporation")).toBeDefined();
    expect(within(live).getByText("4 days left")).toBeDefined();
  });

  it("shows how many eligible students actually applied", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const live = await screen.findByRole("region", { name: /open drives/i });
    expect(within(live).getByText(/30 of 120 eligible/i)).toBeDefined();
    expect(within(live).getByText("25%")).toBeDefined();
  });

  it("shows the offers that came out of the drive", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const live = await screen.findByRole("region", { name: /open drives/i });
    const row = within(live).getByText("Zoho Corporation").closest("li");
    if (row === null) throw new Error("row not found");

    expect(row.textContent).toContain("3 offers");
  });

  it("marks a drive closing within two days as urgent", async () => {
    render(
      <DashboardPage
        title="Executive overview"
        view={view({
          ...SNAPSHOT,
          liveDrives: [
            {
              ...(SNAPSHOT.liveDrives[0] as (typeof SNAPSHOT.liveDrives)[number]),
              applicationEnd: "2026-09-06T09:00:00.000Z",
            },
          ],
        })}
      />,
    );

    const live = await screen.findByRole("region", { name: /open drives/i });
    expect(within(live).getByText(/closing soon/i)).toBeDefined();
  });

  it("says a drive with no window set is unscheduled, rather than closed", async () => {
    render(
      <DashboardPage
        title="Executive overview"
        view={view({
          ...SNAPSHOT,
          liveDrives: [
            {
              ...(SNAPSHOT.liveDrives[0] as (typeof SNAPSHOT.liveDrives)[number]),
              applicationStart: null,
              applicationEnd: null,
            },
          ],
        })}
      />,
    );

    const live = await screen.findByRole("region", { name: /open drives/i });
    expect(within(live).getByText(/no application window set/i)).toBeDefined();
  });

  it("says so when no drive is open, rather than showing an empty list", async () => {
    render(
      <DashboardPage title="Executive overview" view={view({ ...SNAPSHOT, liveDrives: [] })} />,
    );

    const live = await screen.findByRole("region", { name: /open drives/i });
    expect(within(live).getByText(/no drives are open/i)).toBeDefined();
  });

  /**
   * 2026-10-16: one company visit that raised two roles used to print as two
   * lines, so a reader counting Zoho twice was counting one drive twice — the
   * same defect reported against the central cockpit.
   */
  it("shows one company visit once, with a progress line per role", async () => {
    const mts = SNAPSHOT.liveDrives[0] as (typeof SNAPSHOT.liveDrives)[number];
    const secondRole = {
      ...mts,
      driveId: "d2",
      roleTitle: "Quality Analyst",
      eligible: 100,
      // "b" is eligible for (and has applied to) both roles.
      eligibleStudentIds: ["b", "c"],
      applied: 2,
      appliedStudentIds: ["b"],
      offers: 0,
      offerStudentIds: [],
    };

    render(
      <DashboardPage
        title="Executive overview"
        view={view({ ...SNAPSHOT, liveDrives: [mts, secondRole] })}
      />,
    );

    const live = await screen.findByRole("region", { name: /open drives/i });
    expect(within(live).getAllByText("Zoho Corporation")).toHaveLength(1);
    expect(within(live).getByText("2 roles")).toBeDefined();
    expect(within(live).getByText("Member Technical Staff")).toBeDefined();
    expect(within(live).getByText("Quality Analyst")).toBeDefined();
    // Four eligibility rows are three students; three application rows are two.
    expect(within(live).getByText("2 of 3 students")).toBeDefined();
    expect(within(live).getByText(/at this visit have applied to at least one role/)).toBeDefined();
  });
});

/**
 * F4 (UAT 2026-08-06): "The registration funnel should be available both
 * overall and campus-wise. There can be a small drop down that shows all
 * campuses as default and a drop down to select a campus. The Central
 * Placement Coordinator should have access to a consolidated dashboard with
 * the ability to switch between individual campuses."
 */
describe("switching campus", () => {
  it("offers every campus, and starts on all of them", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    const picker = (await screen.findByLabelText("Campus")) as HTMLSelectElement;

    expect(picker.value).toBe("");
    expect(within(picker).getByRole("option", { name: /all campuses/i })).toBeDefined();
    expect(within(picker).getByRole("option", { name: "Alliance University" })).toBeDefined();
    expect(within(picker).getByRole("option", { name: "VIT Bangalore" })).toBeDefined();
  });

  it("counts the whole roster until a campus is chosen", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    const funnel = await screen.findByRole("region", { name: /students overview/i });
    const roster = within(funnel).getByText("On the roster").closest("li");
    if (roster === null) throw new Error("stage not found");

    expect(within(roster).getByText("3")).toBeDefined();
  });

  it("narrows the students overview to the campus chosen", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText("Campus"), "c2");

    // The switcher now re-reads the whole snapshot, so wait for the scoped one.
    const funnel = await screen.findByRole("region", { name: /students overview/i });
    const roster = within(funnel).getByText("On the roster").closest("li");
    if (roster === null) throw new Error("stage not found");

    expect(within(roster).getByText("1")).toBeDefined();
  });

  /** The headline must follow the funnel, or the screen quotes two cohorts. */
  it("narrows the placement figures to the same campus", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText("Campus"), "c1");

    // Alliance: two students, one placed, one opted out -> 1 of 1 counted.
    const headline = await screen.findByRole("region", { name: /headline/i });
    expect(within(headline).getByText("100%")).toBeDefined();
  });

  it("says which campus is being shown, so a filtered screen is never mistaken for the whole", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText("Campus"), "c2");

    expect(screen.getByText(/showing vit bangalore/i)).toBeDefined();
  });

  /**
   * The switcher must MOVE the whole screen, not just the student rows. It
   * used to be a client-side filter over `students`, so the funnel was one
   * campus while the package figures and the drive box beside it were still the
   * whole organisation — one screen, two cohorts.
   */
  it("re-reads every figure for the campus chosen", async () => {
    const scopes: (DashboardScope | undefined)[] = [];
    const recordingView: DashboardView = {
      snapshot: async (scope) => {
        scopes.push(scope);
        return SNAPSHOT;
      },
    };
    const user = userEvent.setup();
    render(<DashboardPage view={recordingView} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText("Campus"), "c1");
    await screen.findByRole("region", { name: /headline/i });

    expect(scopes[0]).toEqual({});
    expect(scopes[1]).toEqual({ campusIds: ["c1"] });
  });

  /** The picker cannot come from the scoped read: it would shrink to one option. */
  it("keeps every campus in the picker after switching to one", async () => {
    const scopedView: DashboardView = {
      snapshot: async (scope) =>
        scope?.campusIds === undefined || scope.campusIds.length === 0
          ? SNAPSHOT
          : { ...SNAPSHOT, campuses: SNAPSHOT.campuses.filter((c) => c.campusId === "c1") },
    };
    const user = userEvent.setup();
    render(<DashboardPage view={scopedView} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText("Campus"), "c1");
    await screen.findByRole("region", { name: /headline/i });

    const picker = (await screen.findByLabelText("Campus")) as HTMLSelectElement;
    expect(within(picker).getByRole("option", { name: "VIT Bangalore" })).toBeDefined();
  });
});

/**
 * supabase-js resolves with `{ data: null }` when a read fails, and this screen
 * used to print that as "No students yet. Import a campus roster to begin." An
 * outage and an empty campus looked identical. The view now throws; the page
 * has to say so.
 */
describe("DashboardPage — when the overview cannot be read", () => {
  it("reports the failure instead of an empty campus", async () => {
    const failing: DashboardView = {
      snapshot: async () => {
        throw new Error("students: could not be read (401)");
      },
    };
    render(<DashboardPage view={failing} title="Placement overview" />);

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/401/)).toBeDefined();
    expect(screen.queryByText(/no students yet/i)).toBeNull();
  });

  it("offers to read it again", async () => {
    let attempts = 0;
    const flaky: DashboardView = {
      snapshot: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("connection reset");
        return SNAPSHOT;
      },
    };
    const user = userEvent.setup();
    render(<DashboardPage view={flaky} title="Placement overview" />);

    await user.click(await screen.findByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("region", { name: /headline/i })).toBeDefined();
  });
});

/**
 * F5 (UAT 2026-08-06): "There has to be another box to track drive specific
 * data. This should have Drive name and College name filters. wITHIN this,
 * should have information of eligible students (students to whom a drive is
 * opened), applied students, attendance and clearance in each round till final
 * offer."
 */
describe("the drive-specific box", () => {
  const box = () => screen.findByRole("region", { name: /drive progress/i });

  it("is a separate box from the students overview", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    expect(await box()).toBeDefined();
  });

  it("shows the stages of a drive, from eligible through to the final offer", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    const section = await box();
    const zoho = within(section).getByRole("link", { name: /zoho/i }).closest("div");
    if (!zoho) throw new Error("drive not found");

    for (const stage of ["Eligible", "Applied", "Shortlisted", "1. Aptitude", "Final offer"]) {
      expect(within(zoho).getByText(stage)).toBeDefined();
    }
  });

  it("reports attendance and clearance for each round", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    const section = await box();
    const round = within(section).getByText("1. Aptitude").closest("tr");
    if (round === null) throw new Error("round not found");

    // Two called, one present, one absent, one selected of the one who came.
    expect(within(round).getByText(/1 of 2 attended/i)).toBeDefined();
    expect(within(round).getByText(/1 cleared/i)).toBeDefined();
  });

  it("filters by company", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText(/^company$/i), "Freshworks");

    const section = await box();
    expect(within(section).getByRole("link", { name: /freshworks/i })).toBeDefined();
    expect(within(section).queryByRole("link", { name: /zoho/i })).toBeNull();
  });

  /**
   * UAT 2026-10-16: "same company shows as two". Two roles of one visit are one
   * visit — the box names the company once and folds each role, with its own
   * funnel table, underneath.
   */
  it("names the company once when one visit raised two roles", async () => {
    const [base] = SNAPSHOT.driveProgress;
    if (base === undefined) throw new Error("missing base drive");
    const second = {
      ...base,
      driveId: "d3",
      driveName: "Zoho Corporation — Engineer Trainee",
      roleTitle: "Engineer Trainee",
    };

    render(
      <DashboardPage
        view={view({ ...SNAPSHOT, driveProgress: [base, second] })}
        title="Placement overview"
      />,
    );

    const section = await box();
    // The company filter below lists every company too, so the roster is counted
    // without it — the visit still has to name the company once inside the box.
    const namedInRoster = within(section)
      .getAllByText("Zoho Corporation")
      .filter((el) => el.closest("select") === null);
    expect(namedInRoster).toHaveLength(1);
    expect(within(section).getByText("2 roles")).toBeDefined();
    expect(
      within(section)
        .getByRole("button", { name: /engineer trainee/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("filters by college name", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText(/college/i), "VIT Bangalore");

    const section = await box();
    expect(within(section).getByRole("link", { name: /freshworks/i })).toBeDefined();
    expect(within(section).queryByRole("link", { name: /zoho/i })).toBeNull();
  });

  it("says so when the filters match no drive at all", async () => {
    render(
      <DashboardPage view={view({ ...SNAPSHOT, driveProgress: [] })} title="Placement overview" />,
    );

    expect(within(await box()).getByText(/no drives match/i)).toBeDefined();
  });

  it("shows a drive with no rounds yet without inventing any", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText(/^company$/i), "Freshworks");

    const section = await box();
    expect(within(section).getByText("Eligible")).toBeDefined();
    expect(within(section).queryByText(/attended/i)).toBeNull();
  });

  it("displays names of students currently in the ongoing drive on the card", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    const section = await box();
    expect(within(section).getByText("Priya Ramesh")).toBeDefined();
  });

  /**
   * The visit pane, not a per-drive popup: the company is named once and the
   * role's students are listed under it.
   */
  it("opens the visit pane and displays student placement details when clicked", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    const section = await box();
    const studentBtn = within(section).getByRole("button", { name: /Priya Ramesh/i });
    await user.click(studentBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(within(dialog).getByText(/Zoho Corporation/i)).toBeDefined();

    // Click Priya Ramesh to expand her placement details
    const modalStudent = within(dialog).getByRole("button", { name: /Priya Ramesh/i });
    await user.click(modalStudent);

    expect(within(dialog).getByText(/Placement Offer Details/i)).toBeDefined();
    expect(within(dialog).getAllByText(/₹9 LPA/i).length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText(/Aptitude/i).length).toBeGreaterThanOrEqual(1);
  });

  it("scopes students on the drive card to the Campus Manager's assigned campus", async () => {
    const baseDrive = SNAPSHOT.driveProgress[0];
    if (baseDrive === undefined) throw new Error("missing base drive");

    const customSnapshot: DashboardSnapshot = {
      ...SNAPSHOT,
      driveProgress: [
        {
          ...baseDrive,
          students: [
            {
              applicationId: "app-1",
              studentId: "a",
              studentName: "Student Campus 1",
              rollNumber: "21CSE101",
              campusId: "c1",
              campusName: "Alliance University",
              shortlisted: true,
              rounds: [],
              offer: null,
            },
            {
              applicationId: "app-2",
              studentId: "b",
              studentName: "Student Campus 2",
              rollNumber: "21IT202",
              campusId: "c2",
              campusName: "VIT Bangalore",
              shortlisted: true,
              rounds: [],
              offer: null,
            },
          ],
        },
      ],
    };

    const user = userEvent.setup();
    render(<DashboardPage view={view(customSnapshot)} title="Campus overview" />);

    // Select campus c1
    const campusSelect = await screen.findByLabelText("Campus");
    await user.selectOptions(campusSelect, "c1");

    const section = await box();
    expect(within(section).getByText("Student Campus 1")).toBeDefined();
    expect(within(section).queryByText("Student Campus 2")).toBeNull();
  });
});

/**
 * 2026-08-17 (Karthik): "Hyperlink the Placed count (in Students overview /
 * Package) to open or export a detailed breakdown (e.g. student name, company,
 * package, role). Gives coordinators instant visibility into individual
 * placement records directly from the overview dashboard."
 *
 * The number was a dead end: a coordinator could see that one student was
 * placed and had no way to ask who.
 *
 * 2026-10-16 (Karthik): "if shows count i need who all is there" — the link
 * became a popup. Asking who made a number and then having to leave the page to
 * find out, losing the figure you were questioning, was the same dead end one
 * click further along. The directory stays one click away in the footer, so the
 * export path the 2026 tests pinned is still there; what changed is that the
 * first answer is the list of people, on the spot.
 *
 * Every test below therefore checks three things at once: the popup NAMES the
 * people the count stood for, it holds exactly as many rows as the number that
 * opened it, and its footer still carries the directory href — with the same
 * filter, because a popup that disagrees with the list behind it is the defect
 * this replaced.
 */
describe("every card opens the students behind it", () => {
  const headline = async (name: RegExp) =>
    within(await screen.findByRole("region", { name: /headline/i })).getByRole("button", { name });

  /** The card that is not about students still navigates. */
  const headlineLink = async (name: RegExp) =>
    within(await screen.findByRole("region", { name: /headline/i })).getByRole("link", { name });

  /** Press a count and return the popup that names the people inside it. */
  async function press(trigger: HTMLElement, title: RegExp) {
    await userEvent.click(trigger);
    return await screen.findByRole("dialog", { name: title });
  }

  async function close(dialog: HTMLElement) {
    await userEvent.click(within(dialog).getByRole("button", { name: /close panel/i }));
  }

  /** The people in the list, header row excluded. */
  const listed = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole("row")
      .filter((row) => within(row).queryAllByRole("columnheader").length === 0);

  /** The number that opened the popup still heads it, and matches the rows. */
  function counted(dialog: HTMLElement, count: number) {
    expect(
      within(dialog).getByText(new RegExp(`^${count} student${count === 1 ? "" : "s"}`)),
    ).toBeDefined();
    expect(listed(dialog)).toHaveLength(count);
  }

  const directory = (dialog: HTMLElement) =>
    within(dialog).getByRole("link", { name: /open in all students/i });

  /*
   * 2026-08-26 (Karthik): "make the cards in Placement Overview clickable to
   * show student info, just like in Live Drives." The Live-drives pattern is
   * that every number opens exactly the people it counted — which also fixed a
   * mismatch, since the Placed count pointed at `filter=placed` (self-placed
   * included, C1) while the card counted on-campus placements only (PRD 16.2).
   * The hrefs below hold that line: popup, count and directory all one
   * population.
   */
  const CARDS: readonly {
    readonly card: string;
    readonly name: RegExp;
    readonly title: RegExp;
    readonly count: number;
    readonly people: readonly string[];
    readonly href: string;
  }[] = [
    {
      card: "Placement rate",
      name: /placement rate/i,
      // A rate is a fraction, so the popup shows the whole fraction — the
      // denominator, each row saying whether it is the numerator.
      title: /in the placement denominator/i,
      count: 2,
      people: ["Priya Ramesh", "Rahul Verma"],
      href: "/central/students",
    },
    {
      card: "Placed on campus",
      name: /placed on campus/i,
      title: /^placed on campus$/i,
      count: 1,
      people: ["Priya Ramesh"],
      href: "/central/students?filter=on_campus",
    },
    {
      card: "Self-placed",
      name: /self-placed/i,
      title: /^self-placed$/i,
      count: 1,
      people: ["Rahul Verma"],
      href: "/central/students?filter=self_placed",
    },
    {
      card: "Opted out",
      name: /opted out/i,
      title: /^opted out$/i,
      count: 1,
      people: ["Anita Rao"],
      href: "/central/students?filter=opted_out",
    },
  ];

  it.each(CARDS)(
    "opens the students behind the $card count",
    async ({ name, title, count, people, href }) => {
      render(<DashboardPage view={view()} title="Placement overview" />);

      const dialog = await press(await headline(name), title);
      for (const person of people) {
        expect(within(dialog).getByText(person)).toBeDefined();
      }
      counted(dialog, count);
      expect(directory(dialog).getAttribute("href")).toBe(href);
    },
  );

  it("keeps the number itself inside every headline button", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    expect((await headline(/placed on campus/i)).textContent).toMatch(/\d/);
  });

  const FUNNEL: readonly {
    readonly stage: string;
    readonly count: number;
    readonly people: readonly string[];
    readonly href: string;
  }[] = [
    {
      stage: "On the roster",
      count: 3,
      people: ["Priya Ramesh", "Rahul Verma", "Anita Rao"],
      href: "/central/students",
    },
    {
      stage: "Registration form submitted",
      count: 2,
      people: ["Priya Ramesh", "Rahul Verma"],
      href: "/central/students?filter=submitted",
    },
    {
      stage: "Verified by a coordinator",
      count: 2,
      people: ["Priya Ramesh", "Rahul Verma"],
      href: "/central/students?filter=verified",
    },
    {
      stage: "Placed",
      count: 1,
      people: ["Priya Ramesh"],
      href: "/central/students?filter=on_campus",
    },
  ];

  it.each(FUNNEL)(
    "opens the $stage row on the same population it counted",
    async ({ stage, count, people, href }) => {
      render(<DashboardPage view={view()} title="Placement overview" />);

      const overview = await screen.findByRole("region", { name: /students overview/i });
      const dialog = await press(
        within(overview).getByRole("button", { name: new RegExp(stage, "i") }),
        new RegExp(`^${stage}$`, "i"),
      );
      for (const person of people) {
        expect(within(dialog).getByText(person)).toBeDefined();
      }
      counted(dialog, count);
      expect(directory(dialog).getAttribute("href")).toBe(href);
    },
  );

  /**
   * Each row of the popup says where that student stands, so the list is not
   * just a name dump — "verified" and "placed" both sat in the same row before.
   */
  it("says which stage each row of the roster popup has reached", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    const overview = await screen.findByRole("region", { name: /students overview/i });
    const dialog = await press(
      within(overview).getByRole("button", { name: /on the roster/i }),
      /^on the roster$/i,
    );
    expect(within(dialog).getByText("Placed")).toBeDefined();
    expect(within(dialog).getByText("Verified")).toBeDefined();
    expect(within(dialog).getByText("Not submitted")).toBeDefined();
  });

  it("opens the campus behind each row of the campus breakdown", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    const section = await screen.findByRole("region", { name: /by campus/i });
    const dialog = await press(
      within(section).getByRole("button", { name: /alliance university/i }),
      /in the denominator at alliance university/i,
    );
    // 1 of 2 at that campus: Anita is Alliance too, but she left the denominator.
    expect(within(dialog).getByText("Priya Ramesh")).toBeDefined();
    expect(within(dialog).queryByText("Anita Rao")).toBeNull();
    counted(dialog, 1);
    expect(directory(dialog).getAttribute("href")).toBe(
      "/central/students?campus=Alliance+University",
    );
  });

  it("opens the students placed in each offer category", async () => {
    render(
      <DashboardPage
        title="Placement overview"
        view={view({
          ...SNAPSHOT,
          offerCategories: [
            { category: "dream", studentIds: ["a"] },
            { category: "super_dream", studentIds: ["a", "b"] },
          ],
        })}
      />,
    );

    const section = await screen.findByRole("region", { name: /offers by category/i });
    const dialog = await press(
      within(section).getByRole("button", { name: /super dream/i }),
      /super dream offers/i,
    );
    expect(within(dialog).getByText("Priya Ramesh")).toBeDefined();
    expect(within(dialog).getByText("Rahul Verma")).toBeDefined();
    counted(dialog, 2);
    expect(directory(dialog).getAttribute("href")).toBe(
      "/central/students?filter=placed&category=super_dream",
    );
  });

  it("opens the students placed in each category of the package breakdown", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    const list = await screen.findByRole("list", { name: /package by category/i });
    const dialog = await press(within(list).getByRole("button", { name: /dream/i }), /^dream$/i);
    expect(within(dialog).getByText("Priya Ramesh")).toBeDefined();
    counted(dialog, 1);
    expect(directory(dialog).getAttribute("href")).toBe(
      "/central/students?filter=placed&category=dream",
    );
  });

  /**
   * F4: a card clicked while one campus is selected must open THAT campus, in
   * both the list and the directory behind it. Landing on the whole organisation
   * would answer a question nobody asked and quietly contradict the number that
   * was pressed.
   */
  it("carries the selected campus into the popup and the link behind it", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    await userEvent.selectOptions(await screen.findByLabelText("Campus"), "c1");

    const placed = await press(await headline(/placed on campus/i), /^placed on campus$/i);
    expect(within(placed).getByText(/at Alliance University/)).toBeDefined();
    expect(listed(placed)).toHaveLength(1);
    expect(directory(placed).getAttribute("href")).toBe(
      "/central/students?filter=on_campus&campus=Alliance+University",
    );
    await close(placed);

    const overview = await screen.findByRole("region", { name: /students overview/i });
    const roster = await press(
      within(overview).getByRole("button", { name: /on the roster/i }),
      /^on the roster$/i,
    );
    // Two of the three students are Alliance: the roster the figure counted.
    counted(roster, 2);
    expect(within(roster).queryByText("Rahul Verma")).toBeNull();
    expect(directory(roster).getAttribute("href")).toBe(
      "/central/students?campus=Alliance+University",
    );
  });

  it("leaves the drives-completed card alone when a campus is selected", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    await userEvent.selectOptions(await screen.findByLabelText("Campus"), "c1");

    // A drive is not a student and the drive list has no campus filter.
    expect((await headlineLink(/drives completed/i)).getAttribute("href")).toBe(
      "/central/drives/completed",
    );
  });

  it("keeps the drives-completed card a link, not a popup", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    expect(await headlineLink(/drives completed/i)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

/**
 * The package figures. A popup that opens on nobody teaches the reader that
 * none of these are worth pressing, so a figure names its holders when somebody
 * earns it - and when nobody does, which is ordinary for an average and for the
 * midpoint of an even-sized cohort, it opens the placed list and SAYS the figure
 * belongs to nobody. The number a board meeting quotes must not be presented as
 * somebody's salary when it is an arithmetic.
 */
describe("the package figures", () => {
  const TWO: DashboardSnapshot = {
    ...SNAPSHOT,
    placements: [
      { studentId: "a", ctcLpa: 9, category: "dream" },
      { studentId: "b", ctcLpa: 4, category: "regular" },
    ],
  };

  const figure = async (name: RegExp) =>
    within(await screen.findByRole("region", { name: /package figures/i })).getByRole("button", {
      name,
    });

  /** Press a figure and return its popup. */
  async function open(name: RegExp, title: RegExp) {
    await userEvent.click(await figure(name));
    return await screen.findByRole("dialog", { name: title });
  }

  const listed = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole("row")
      .filter((row) => within(row).queryAllByRole("columnheader").length === 0);

  const directory = (dialog: HTMLElement) =>
    within(dialog).getByRole("link", { name: /open in all students/i });

  it("names the holders of the highest and the lowest package", async () => {
    render(<DashboardPage view={view(TWO)} title="Placement overview" />);

    const high = await open(/highest/i, /highest package/i);
    expect(within(high).getByText("Priya Ramesh")).toBeDefined();
    expect(listed(high)).toHaveLength(1);
    // The row says what she earns, not only that she is the highest.
    expect(within(high).getByText("₹9 LPA")).toBeDefined();
    expect(directory(high).getAttribute("href")).toBe("/central/students?filter=placed&ctc=9");
    await userEvent.click(within(high).getByRole("button", { name: /close panel/i }));

    const low = await open(/lowest/i, /lowest package/i);
    expect(within(low).getByText("Rahul Verma")).toBeDefined();
    expect(listed(low)).toHaveLength(1);
    expect(directory(low).getAttribute("href")).toBe("/central/students?filter=placed&ctc=4");
  });

  it("opens the whole placed list, and says so, for a figure no student holds", async () => {
    render(<DashboardPage view={view(TWO)} title="Placement overview" />);

    // Average and median are both 6.5 here, and nobody earns 6.5.
    const average = await open(/average/i, /average package/i);
    expect(within(average).getByText(/not anybody.s own salary/)).toBeDefined();
    expect(listed(average)).toHaveLength(2);
    expect(directory(average).getAttribute("href")).toBe("/central/students?filter=placed");
    await userEvent.click(within(average).getByRole("button", { name: /close panel/i }));

    const median = await open(/median/i, /median package/i);
    expect(within(median).getByText(/not anybody.s own salary/)).toBeDefined();
    expect(directory(median).getAttribute("href")).toBe("/central/students?filter=placed");
  });

  it("names the holder of a median that is a real package", async () => {
    const three: DashboardSnapshot = {
      ...SNAPSHOT,
      placements: [
        { studentId: "a", ctcLpa: 9, category: "dream" },
        { studentId: "b", ctcLpa: 6.5, category: "dream" },
        { studentId: "c", ctcLpa: 4, category: "regular" },
      ],
    };
    render(<DashboardPage view={view(three)} title="Placement overview" />);

    const median = await open(/median/i, /median package/i);
    expect(within(median).getByText("Rahul Verma")).toBeDefined();
    expect(listed(median)).toHaveLength(1);
    expect(within(median).queryByText(/not anybody.s own salary/)).toBeNull();
    expect(directory(median).getAttribute("href")).toBe("/central/students?filter=placed&ctc=6.5");
  });
});

/**
 * 2026-08-27: "Offers by category" and "Package by category" spelled their
 * categories by stripping underscores and leaning on CSS `capitalize` to fix
 * the case. The DOM said "super dream"; the screen said "Super Dream" only
 * because of a stylesheet. A category's spelling is a domain fact, not a
 * presentation trick — and CSS could not rescue "internship" once (10) made
 * it a category.
 */
describe("category spelling", () => {
  it("names offer categories in the domain's words, without help from CSS", async () => {
    render(
      <DashboardPage
        view={view({
          ...SNAPSHOT,
          offerCategories: [
            { category: "regular", studentIds: ["a"] },
            { category: "super_dream", studentIds: ["a"] },
            { category: "internship", studentIds: ["a", "b"] },
          ],
        })}
        title="Executive overview"
      />,
    );

    const offers = await screen.findByRole("region", { name: "Offers by category" });
    expect(within(offers).getByText("Super Dream")).toBeDefined();
    expect(within(offers).getByText("Internship")).toBeDefined();
    expect(within(offers).queryByText("super dream")).toBeNull();
  });

  it("names package categories the same way", async () => {
    render(
      <DashboardPage
        view={view({
          ...SNAPSHOT,
          placements: [{ studentId: "a", ctcLpa: 14, category: "super_dream" }],
        })}
        title="Executive overview"
      />,
    );

    const packages = await screen.findByRole("list", { name: "Package by category" });
    expect(within(packages).getByText("Super Dream")).toBeDefined();
    expect(within(packages).queryByText("super dream")).toBeNull();
  });
});

/**
 * The drill-down behind "Drives by status". The popup must list exactly the
 * drives behind the count that opened it — no more, no fewer — and say which
 * colleges each one targets, because that is the question the row raises.
 */
describe("DashboardPage — the drives behind a status count", () => {
  it("opens a popup listing exactly the drives in that status, with their colleges", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    await userEvent.click(await screen.findByRole("button", { name: "live: 2 drives" }));

    const dialog = await screen.findByRole("dialog", { name: "Drives — live" });
    expect(within(dialog).getByText("Zoho Corporation")).toBeDefined();
    expect(within(dialog).getByText("Freshworks")).toBeDefined();
    expect(within(dialog).queryByText("TCS")).toBeNull();
    expect(within(dialog).getByText("Open to: Alliance University")).toBeDefined();
    expect(within(dialog).getByText("Open to every campus")).toBeDefined();
  });

  it("opens the drives of a different status when its row is clicked", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    await userEvent.click(await screen.findByRole("button", { name: "completed: 2 drives" }));

    const dialog = await screen.findByRole("dialog", { name: "Drives — completed" });
    expect(within(dialog).getByText("TCS")).toBeDefined();
    expect(within(dialog).getByText("Open to: VIT Bangalore")).toBeDefined();
    expect(within(dialog).queryByText("Zoho Corporation")).toBeNull();
  });

  it("closes the popup on Escape", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    await userEvent.click(await screen.findByRole("button", { name: "live: 2 drives" }));
    expect(await screen.findByRole("dialog", { name: "Drives — live" })).toBeDefined();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Drives — live" })).toBeNull();
  });

  /**
   * The count is company VISITS and the rows are roles, so the popup has to
   * open on visits — otherwise "completed: 2" lists three drives and the two
   * figures on the same screen disagree with each other.
   */
  it("lists a two-role visit once, with every role still reachable", async () => {
    const visit = SNAPSHOT.statusDrives.find((drive) => drive.driveId === "d5");
    if (visit === undefined) throw new Error("fixture changed");

    render(
      <DashboardPage
        title="Executive overview"
        view={view({
          ...SNAPSHOT,
          statusDrives: [
            ...SNAPSHOT.statusDrives,
            { ...visit, driveId: "d8", roleTitle: "Business Analyst", campuses: [] },
          ],
        })}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "completed: 2 drives, 3 roles" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Drives — completed" });
    expect(within(dialog).getByText("2 drives · 3 roles")).toBeDefined();
    expect(within(dialog).getAllByText("TCS")).toHaveLength(1);
    expect(within(dialog).getByText("2 roles")).toBeDefined();
    const roleLink = (name: string) => within(dialog).getByRole("link", { name });

    expect(roleLink("Assistant System Engineer").getAttribute("href")).toBe("/drives/d5");
    expect(roleLink("Business Analyst").getAttribute("href")).toBe("/drives/d8");
    // A visit that raised one role is still that role's own record page.
    expect(roleLink("Infosys").getAttribute("href")).toBe("/drives/d6");
  });
});
