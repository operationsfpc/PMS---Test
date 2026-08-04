// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
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
    },
    {
      studentId: "b",
      participationStatus: "active",
      hasOnCampusPlacement: false,
      hasSelfPlacement: true,
      srfStatus: "srf_approved",
      hasApplied: true,
    },
    {
      studentId: "c",
      participationStatus: "opted_out",
      hasOnCampusPlacement: false,
      hasSelfPlacement: false,
      srfStatus: "invited",
      hasApplied: false,
    },
  ],
  placements: [{ studentId: "a", ctcLpa: 9, category: "dream" }],
  drivesByStatus: { live: 2, in_rounds: 1, completed: 4 },
  offersByCategory: { regular: 3, dream: 2, super_dream: 1 },
  campuses: [
    { campusId: "c1", campusName: "Alliance University", eligible: 2, placed: 1 },
    { campusId: "c2", campusName: "VIT Bangalore", eligible: 0, placed: 0 },
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
describe("the registration funnel", () => {
  it("shows every stage from the roster down to placed", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const funnel = await screen.findByRole("region", { name: /registration funnel/i });

    for (const stage of [
      "On the roster",
      "Registration form submitted",
      "Verified by a coordinator",
      "Applied to a drive",
      "Placed",
    ]) {
      expect(within(funnel).getByText(stage)).toBeDefined();
    }
  });

  it("counts each stage, and says what share of the roster it is", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const funnel = await screen.findByRole("region", { name: /registration funnel/i });
    const roster = within(funnel).getByText("On the roster").closest("li");
    if (roster === null) throw new Error("stage not found");

    expect(within(roster).getByText("3")).toBeDefined();
    expect(within(roster).getByText(/100%/)).toBeDefined();
  });

  it("shows the two students who registered, of the three on the roster", async () => {
    render(<DashboardPage view={view()} title="Executive overview" />);

    const funnel = await screen.findByRole("region", { name: /registration funnel/i });
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
