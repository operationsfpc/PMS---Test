// @vitest-environment jsdom
import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { DriveTabs, type StudentDriveLists, type StudentDriveListsView } from "./drive-tabs";
import type { OpenDrive } from "./drives-list";

/**
 * N7 — four tabs, one drive in exactly one, filters that mean the same thing
 * on every tab (approved mockup 2026-08-19).
 */
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const NOW = () => new Date("2026-09-05T00:00:00Z");

const openCard: OpenDrive = {
  id: "d1",
  companyName: "Zoho",
  roleTitle: "MTS",
  roleCategory: "software_technical",
  ctcLabel: "₹6.5–9 LPA",
  offerCategory: "dream",
  applicationEnd: "2026-09-09T00:00:00Z",
  canApply: true,
  refusal: null,
  applied: false,
  details: {
    jobDescription: "",
    designations: [],
    locations: "Chennai, Bengaluru",
    openings: null,
    ctcBreakup: "",
    bondDetails: "",
    shift: "",
    joining: "",
    jobDescriptionUrl: null,
    jobDescriptionName: null,
    mandatorySkills: "",
    driveMode: "",
    applicationStart: null,
    rounds: [],
  },
};

const LISTS: StudentDriveLists = {
  toApply: [openCard],
  inProgress: [
    {
      id: "d2",
      companyName: "Accenture",
      roleTitle: "Jr. Software Engineer",
      roleCategory: "technical_support_it_ops",
      locations: "Hyderabad",
      appliedAt: "2026-09-01T00:00:00Z",
      progressLabel: "Round 2 of 3 — Technical Interview",
      roundsCleared: 1,
      totalRounds: 3,
    },
  ],
  notApplied: [
    {
      id: "d3",
      companyName: "Cognizant",
      roleTitle: "Process Executive",
      roleCategory: "operations_business",
      ctcLabel: "₹3.5 LPA",
      locations: "Chennai",
      closedOn: "2026-08-12T00:00:00Z",
    },
  ],
  appliedClosed: [
    {
      id: "d4",
      companyName: "Wipro",
      roleTitle: "Project Engineer",
      roleCategory: "software_technical",
      locations: "Pune",
      appliedAt: "2026-08-02T00:00:00Z",
      progressLabel: "Not selected — Round 2",
      roundsCleared: 1,
      totalRounds: 3,
      outcomeLabel: "Not selected — Round 2",
    },
  ],
};

function view(lists: StudentDriveLists = LISTS): StudentDriveListsView {
  return {
    lists: async () => lists,
    openDrives: async () => lists.toApply,
    apply: async () => undefined,
  };
}

describe("DriveTabs", () => {
  it("shows the four tabs with their counts, To apply selected first", async () => {
    render(<DriveTabs view={view()} now={NOW} />);

    expect(await screen.findByRole("tab", { name: "To apply (1)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "In progress (1)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Not applied · closed (1)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Applied · closed (1)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "To apply (1)" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    // The To apply card, with its time left SHOWN.
    expect(await screen.findByText("Zoho")).toBeDefined();
    expect(screen.getByText(/4 days left to apply/)).toBeDefined();
  });

  it("switches tabs: the current round, the missed drive, the outcome", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    await user.click(screen.getByRole("tab", { name: "In progress (1)" }));
    const progress = screen.getByRole("tabpanel", { name: "In progress" });
    expect(within(progress).getByText("Round 2 of 3 — Technical Interview")).toBeDefined();

    await user.click(screen.getByRole("tab", { name: "Not applied · closed (1)" }));
    expect(screen.getByText(/you didn’t apply/)).toBeDefined();

    await user.click(screen.getByRole("tab", { name: "Applied · closed (1)" }));
    expect(screen.getByText("Not selected — Round 2")).toBeDefined();
  });

  it("searches every tab with one box", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    await user.type(screen.getByRole("searchbox", { name: "Search drives" }), "accenture");

    expect(screen.getByRole("tab", { name: "To apply (0)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "In progress (1)" })).toBeDefined();
  });

  it("filters by location across tabs", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by location" }), [
      "Chennai",
    ]);

    expect(screen.getByRole("tab", { name: "To apply (1)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "In progress (0)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Not applied · closed (1)" })).toBeDefined();
  });

  it("offers the closing-time filter only on To apply, and applies it", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    const closing = screen.getByRole("combobox", { name: "Filter by closing time" });
    await user.selectOptions(closing, ["today"]);
    expect(screen.getByRole("tab", { name: "To apply (0)" })).toBeDefined();

    await user.click(screen.getByRole("tab", { name: "In progress (1)" }));
    expect(screen.queryByRole("combobox", { name: "Filter by closing time" })).toBeNull();
  });

  it("every card links to the drive's canonical page (N1)", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    expect(
      screen.getByRole<HTMLAnchorElement>("link", { name: /everything about Zoho/i }).href,
    ).toContain("/drives/d1");

    await user.click(screen.getByRole("tab", { name: "In progress (1)" }));
    expect(
      screen.getByRole<HTMLAnchorElement>("link", { name: /everything about Accenture/i }).href,
    ).toContain("/drives/d2");
  });

  it("says when a list is empty rather than showing nothing", async () => {
    const user = userEvent.setup();
    render(
      <DriveTabs
        view={view({ toApply: [], inProgress: [], notApplied: [], appliedClosed: [] })}
        now={NOW}
      />,
    );

    await screen.findByRole("tab", { name: "To apply (0)" });
    await user.click(screen.getByRole("tab", { name: "In progress (0)" }));
    expect(screen.getByText("Nothing in progress right now.")).toBeDefined();
  });
});
