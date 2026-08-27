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
  profileResumeName: null,
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
    venue: "",
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

describe("DriveTabs — a placed student is not locked out (C2, UAT 2026-08-19)", () => {
  it("tells a placed student which rungs remain open, instead of looking shut", async () => {
    render(<DriveTabs view={view({ ...LISTS, placedAt: "regular" })} now={NOW} />);

    const note = await screen.findByText(/you are placed/i);
    expect(note.textContent).toMatch(/regular/i);
    expect(note.textContent).toMatch(/higher/i);
  });

  it("says nothing about placement to a student who has none", async () => {
    render(<DriveTabs view={view()} now={NOW} />);

    await screen.findByText("Zoho");
    expect(screen.queryByText(/you are placed/i)).toBeNull();
  });

  it("admits internship drives are closed when the one-internship allowance is used (Q2, 2026-08-21)", async () => {
    render(
      <DriveTabs
        view={view({ ...LISTS, placedAt: "regular", internshipCapConsumed: true })}
        now={NOW}
      />,
    );

    const note = await screen.findByText(/you are placed/i);
    expect(note.textContent).toMatch(/higher/i);
    expect(note.textContent).toMatch(/internship-only drives are closed/i);
    expect(note.textContent).toMatch(/one-internship allowance/i);
  });

  it("does not mention the internship allowance when it is untouched", async () => {
    render(
      <DriveTabs
        view={view({ ...LISTS, placedAt: "regular", internshipCapConsumed: false })}
        now={NOW}
      />,
    );

    const note = await screen.findByText(/you are placed/i);
    expect(note.textContent).not.toMatch(/internship-only/i);
  });
});

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

/**
 * Karthik, 2026-08-27: the drive-type filter belongs on the student's list
 * too. This page already carries a row of dropdowns, so the filter joins them
 * rather than arriving as a competing set of chips.
 */
describe("DriveTabs — filtering and tagging by drive type", () => {
  const typed: StudentDriveLists = {
    ...LISTS,
    toApply: [
      { ...openCard, id: "t1", companyName: "Zoho", driveType: "placement" },
      {
        ...openCard,
        id: "t2",
        companyName: "LTI Mindtree",
        driveType: "internship_convertible",
      },
      {
        ...openCard,
        id: "t3",
        companyName: "ABCD Infosys",
        driveType: "internship",
        offerCategory: "internship",
      },
    ],
    inProgress: [],
    notApplied: [],
    appliedClosed: [],
  };

  it("tags each drive with its type", async () => {
    render(<DriveTabs view={view(typed)} now={NOW} />);
    await screen.findByText("ABCD Infosys");

    // The filter dropdown carries the same words, so the tags are looked for
    // on the cards rather than anywhere on the page.
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Internship → Full time")).toBeDefined();
    expect(within(panel).getByText("Full time")).toBeDefined();
  });

  it("narrows to the chosen type", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view(typed)} now={NOW} />);
    await screen.findByText("ABCD Infosys");

    await user.selectOptions(screen.getByLabelText(/filter by drive type/i), "internship");

    expect(screen.getByText("ABCD Infosys")).toBeDefined();
    expect(screen.queryByText("Zoho")).toBeNull();
    expect(screen.queryByText("LTI Mindtree")).toBeNull();
  });

  it("comes back to everything when All types is chosen", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view(typed)} now={NOW} />);
    await screen.findByText("ABCD Infosys");
    const filter = screen.getByLabelText(/filter by drive type/i);

    await user.selectOptions(filter, "internship");
    await user.selectOptions(filter, "");

    expect(screen.getByText("Zoho")).toBeDefined();
  });

  /**
   * PB3 (2026-08-27): the offer category of an internship IS "Internship", and
   * so is its type tag. Showing both puts the same word on the card twice, in
   * two colours, saying nothing the second time.
   */
  it("does not print Internship twice on the same card", async () => {
    render(
      <DriveTabs view={view({ ...typed, toApply: [typed.toApply[2] as OpenDrive] })} now={NOW} />,
    );
    await screen.findByText("ABCD Infosys");

    expect(within(screen.getByRole("tabpanel")).getAllByText("Internship")).toHaveLength(1);
  });

  it("still shows a full-time drive's category beside its type", async () => {
    render(
      <DriveTabs view={view({ ...typed, toApply: [typed.toApply[0] as OpenDrive] })} now={NOW} />,
    );
    await screen.findByText("Zoho");

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Dream")).toBeDefined();
    expect(within(panel).getByText("Full time")).toBeDefined();
  });
});
