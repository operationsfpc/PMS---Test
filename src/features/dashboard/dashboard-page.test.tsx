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
    },
    {
      studentId: "b",
      participationStatus: "active",
      hasOnCampusPlacement: false,
      hasSelfPlacement: true,
    },
    {
      studentId: "c",
      participationStatus: "opted_out",
      hasOnCampusPlacement: false,
      hasSelfPlacement: false,
    },
  ],
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
        view={view({ students: [], drivesByStatus: {}, offersByCategory: {}, campuses: [] })}
      />,
    );

    expect(await screen.findByText(/no students yet/i)).toBeDefined();
  });
});
