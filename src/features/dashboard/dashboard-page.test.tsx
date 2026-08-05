// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DashboardPage, type DashboardSnapshot, type DashboardView } from "./dashboard-page";

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
  drivesByStatus: { live: 2, in_rounds: 1, completed: 4 },
  liveDrives: [
    {
      driveId: "d1",
      companyName: "Zoho Corporation",
      roleTitle: "Member Technical Staff",
      applicationStart: "2026-09-01T00:00:00.000Z",
      applicationEnd: "2026-09-10T00:00:00.000Z",
      eligible: 120,
      applied: 30,
      offers: 3,
    },
  ],
  now: "2026-09-05T10:00:00.000Z",
  offersByCategory: { regular: 3, dream: 2, super_dream: 1 },
  campuses: [
    { campusId: "c1", campusName: "Alliance University", eligible: 2, placed: 1 },
    { campusId: "c2", campusName: "VIT Bangalore", eligible: 0, placed: 0 },
  ],
  driveProgress: [
    {
      driveId: "d1",
      driveName: "Zoho Corporation — Member Technical Staff",
      campusNames: ["Alliance University"],
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
      campusNames: ["VIT Bangalore"],
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
    render(<DashboardPage view={view()} title="Executive overview" />);

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
          offersByCategory: {},
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
    expect(within(headline).getByText("4")).toBeDefined();
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

    const funnel = screen.getByRole("region", { name: /students overview/i });
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
    const headline = screen.getByRole("region", { name: /headline/i });
    expect(within(headline).getByText("100%")).toBeDefined();
  });

  it("says which campus is being shown, so a filtered screen is never mistaken for the whole", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText("Campus"), "c2");

    expect(screen.getByText(/showing vit bangalore/i)).toBeDefined();
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
    const zoho = within(section).getByText(/zoho/i).closest("div");
    if (zoho === null) throw new Error("drive not found");

    for (const stage of ["Eligible", "Applied", "Shortlisted", "1. Aptitude", "Final offer"]) {
      expect(within(zoho).getByText(stage)).toBeDefined();
    }
  });

  it("reports attendance and clearance for each round", async () => {
    render(<DashboardPage view={view()} title="Placement overview" />);

    const section = await box();
    const round = within(section).getByText("1. Aptitude").closest("li");
    if (round === null) throw new Error("round not found");

    // Two called, one present, one absent, one selected of the one who came.
    expect(within(round).getByText(/1 of 2 attended/i)).toBeDefined();
    expect(within(round).getByText(/1 cleared/i)).toBeDefined();
  });

  it("filters by drive name", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.type(await screen.findByLabelText(/drive name/i), "freshworks");

    const section = await box();
    expect(within(section).getByText(/freshworks/i)).toBeDefined();
    expect(within(section).queryByText(/zoho/i)).toBeNull();
  });

  it("filters by college name", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.selectOptions(await screen.findByLabelText(/college/i), "VIT Bangalore");

    const section = await box();
    expect(within(section).getByText(/freshworks/i)).toBeDefined();
    expect(within(section).queryByText(/zoho/i)).toBeNull();
  });

  it("says so when the filters match no drive at all", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.type(await screen.findByLabelText(/drive name/i), "nobody");

    expect(within(await box()).getByText(/no drives match/i)).toBeDefined();
  });

  it("shows a drive with no rounds yet without inventing any", async () => {
    const user = userEvent.setup();
    render(<DashboardPage view={view()} title="Placement overview" />);

    await user.type(await screen.findByLabelText(/drive name/i), "freshworks");

    const section = await box();
    expect(within(section).getByText("Eligible")).toBeDefined();
    expect(within(section).queryByText(/attended/i)).toBeNull();
  });
});
