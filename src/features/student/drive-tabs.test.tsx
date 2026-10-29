// @vitest-environment jsdom
import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { DriveTabs, type StudentDriveLists, type StudentDriveListsView } from "./drive-tabs";
import type { OpenDrive } from "./drives-list";

/**
 * N7 — the two lists the Drives area kept after 2026-10-29: future drives and
 * applications still moving. Filters mean the same thing on both.
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
  companyDriveId: null,
  tentativeDate: null,
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
};

function view(lists: StudentDriveLists = LISTS): StudentDriveListsView {
  return {
    lists: async () => lists,
    openDrives: async () => lists.toApply,
    openDrive: async (driveId) => lists.toApply.find((drive) => drive.id === driveId) ?? null,
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
  it("shows both lists with their counts, To apply selected first", async () => {
    render(<DriveTabs view={view()} now={NOW} />);

    expect(await screen.findByRole("tab", { name: "To apply (1)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "In progress (1)" })).toBeDefined();
    expect(screen.queryByRole("tab", { name: /closed/i })).toBeNull();
    expect(screen.getByRole("tab", { name: "To apply (1)" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    // The To apply card, with its time left SHOWN.
    expect(await screen.findByText("Zoho")).toBeDefined();
    expect(screen.getByText(/4 days left to apply/)).toBeDefined();
  });

  it("switches to the application still moving and names its current round", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    await user.click(screen.getByRole("tab", { name: "In progress (1)" }));
    const progress = screen.getByRole("tabpanel", { name: "In progress" });
    expect(within(progress).getByText("Round 2 of 3 — Technical Interview")).toBeDefined();
  });

  it("searches both lists with one box", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    await user.type(screen.getByRole("searchbox", { name: "Search drives" }), "accenture");

    expect(screen.getByRole("tab", { name: "To apply (0)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "In progress (1)" })).toBeDefined();
  });

  it("filters by location across both lists", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by location" }), [
      "Chennai",
    ]);

    expect(screen.getByRole("tab", { name: "To apply (1)" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "In progress (0)" })).toBeDefined();
  });

  it("carries no closing-time filter — the cards already show the deadline", async () => {
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    expect(screen.queryByRole("combobox", { name: "Filter by closing time" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("tab", { name: "In progress (1)" }));
    expect(screen.queryByRole("combobox", { name: "Filter by closing time" })).toBeNull();
  });

  it("every card links to the drive's canonical page (N1)", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view()} now={NOW} />);
    await screen.findByText("Zoho");

    // The card already names the company and the role, so the control's own
    // word is the one `View` and both names live in its accessible name.
    expect(
      screen.getByRole<HTMLAnchorElement>("link", { name: /^view zoho — /i }).textContent,
    ).toBe("View");
    expect(screen.getByRole<HTMLAnchorElement>("link", { name: /^view zoho — /i }).href).toContain(
      "/drives/d1",
    );

    await user.click(screen.getByRole("tab", { name: "In progress (1)" }));
    expect(
      screen.getByRole<HTMLAnchorElement>("link", { name: /^view accenture — /i }).href,
    ).toContain("/drives/d2");
  });

  it("says when a list is empty rather than showing nothing", async () => {
    const user = userEvent.setup();
    render(<DriveTabs view={view({ toApply: [], inProgress: [] })} now={NOW} />);

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

/**
 * 2026-10-29: "campus manager can able to hold drives from student and no
 * notification can able to get to students". With 0126 stopping their mail,
 * these words are the whole explanation a held student gets.
 */
describe("a hold on the student's own screen", () => {
  const HELD = {
    kind: "fees" as const,
    reason: "Two semesters of fees unpaid.",
    startsAt: "2026-09-01",
    endsAt: "2026-12-15",
    confirmedAt: "2026-09-01T10:00:00Z",
  };

  it("says why, what kind, and for how long", async () => {
    render(<DriveTabs view={view({ ...LISTS, hold: HELD })} now={NOW} />);

    const card = await screen.findByRole("region", { name: /placement hold/i });
    expect(within(card).getByText(/your placements are on hold — fees/i)).toBeDefined();
    expect(within(card).getByText("Two semesters of fees unpaid.")).toBeDefined();
    // en-GB abbreviates September as "Sept"; the day and year are the claim.
    expect(within(card).getByText(/from 01 Sep[a-z]* 2026, review by 15 Dec 2026/i)).toBeDefined();
    expect(within(card).getByText("In force")).toBeDefined();
  });

  it("says plainly that no drive can be applied to while it runs", async () => {
    render(<DriveTabs view={view({ ...LISTS, hold: HELD })} now={NOW} />);

    const card = await screen.findByRole("region", { name: /placement hold/i });
    expect(within(card).getByText(/cannot apply to any drive/i)).toBeDefined();
    expect(within(card).getByText(/stops mailing you/i)).toBeDefined();
    expect(within(card).getByText(/only your campus manager can release it/i)).toBeDefined();
  });

  it("reads a self-placed request as waiting, not as a hold", async () => {
    render(
      <DriveTabs
        view={view({
          ...LISTS,
          hold: { ...HELD, kind: "self_placed", confirmedAt: null },
        })}
        now={NOW}
      />,
    );

    const card = await screen.findByRole("region", { name: /placement hold/i });
    expect(within(card).getByText(/waiting for your campus manager/i)).toBeDefined();
    expect(within(card).getByText(/awaiting confirmation/i)).toBeDefined();
    expect(within(card).getByText(/you can still apply/i)).toBeDefined();
    expect(within(card).queryByText("In force")).toBeNull();
  });

  /** The attachment is the Campus Manager's evidence, not a student document. */
  it("offers no link to the hold's own evidence", async () => {
    render(<DriveTabs view={view({ ...LISTS, hold: HELD })} now={NOW} />);

    const card = await screen.findByRole("region", { name: /placement hold/i });
    expect(within(card).queryByRole("link")).toBeNull();
  });

  it("says nothing when there is no hold", async () => {
    render(<DriveTabs view={view({ ...LISTS, hold: null })} now={NOW} />);
    await screen.findByText("Zoho");

    expect(screen.queryByRole("region", { name: /placement hold/i })).toBeNull();
  });
});

/**
 * UAT 2026-10-16: "on ui still the company show each roles seperate for
 * students too it should show company name". Two applications raised under one
 * company visit are one visit — the card names the company once and folds each
 * role underneath, with its own round, its own money and its own record.
 */
describe("DriveTabs — one card per company visit", () => {
  const pair = (driveType: ("placement" | "internship")[]): StudentDriveLists["inProgress"] => [
    {
      id: "d20",
      companyName: "FACE Prep tst",
      roleTitle: "SDE",
      roleCategory: "software_technical",
      driveType: driveType[0] ?? null,
      companyDriveId: "e1",
      locations: "Bengaluru",
      appliedAt: "2026-09-01T00:00:00Z",
      progressLabel: "Round 1 of 2 — Aptitude",
      roundsCleared: 0,
      totalRounds: 2,
    },
    {
      id: "d21",
      companyName: "FACE Prep tst",
      roleTitle: "Data analyst",
      roleCategory: "operations_business",
      driveType: driveType[1] ?? null,
      companyDriveId: "e1",
      locations: "Bengaluru",
      appliedAt: "2026-09-02T00:00:00Z",
      progressLabel: "Round 2 of 3 — Technical Interview",
      roundsCleared: 1,
      totalRounds: 3,
    },
  ];

  const openTab = async (name: RegExp) => {
    const user = userEvent.setup();
    render(
      <DriveTabs
        view={view({ ...LISTS, inProgress: pair(["placement", "internship"]) })}
        now={NOW}
      />,
    );
    await screen.findByText("Zoho");
    await user.click(screen.getByRole("tab", { name }));
    return screen.getByRole("tabpanel", { name: /in progress/i });
  };

  it("names the company once for two applications to one visit", async () => {
    const panel = await openTab(/^In progress/);
    expect(within(panel).getAllByText("FACE Prep tst")).toHaveLength(1);
    expect(within(panel).getByText("2 roles")).toBeDefined();
  });

  it("keeps each role's own round beneath its own heading, both already open", async () => {
    const panel = await openTab(/^In progress/);
    expect(
      within(panel)
        .getByRole("button", { name: /data analyst/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(within(panel).getByText("Round 1 of 2 — Aptitude")).toBeDefined();
    expect(within(panel).getByText("Round 2 of 3 — Technical Interview")).toBeDefined();
  });

  it("links each role to its own drive record, never to whichever came first", async () => {
    const panel = await openTab(/^In progress/);
    const links = within(panel).getAllByRole("link", { name: /^view /i });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/drives/d20", "/drives/d21"]);
  });

  it("refuses to name one type for a visit that mixed an internship with a full-time role", async () => {
    const panel = await openTab(/^In progress/);
    expect(within(panel).getByText("Mixed types")).toBeDefined();
    const analyst = within(panel).getByRole("button", { name: /data analyst/i });
    expect(within(analyst).getByText("Internship")).toBeDefined();
    expect(within(analyst).queryByText("Full time")).toBeNull();
  });

  it("says the shared type once when every role of the visit is the same kind", async () => {
    const user = userEvent.setup();
    render(
      <DriveTabs
        view={view({ ...LISTS, inProgress: pair(["placement", "placement"]) })}
        now={NOW}
      />,
    );
    await screen.findByText("Zoho");
    await user.click(screen.getByRole("tab", { name: /^In progress/ }));
    const panel = screen.getByRole("tabpanel", { name: /in progress/i });

    expect(within(panel).getByText("Full time")).toBeDefined();
    expect(within(panel).queryByText("Mixed types")).toBeNull();
  });

  it("leaves a single-role visit as the plain card it always was", async () => {
    const [first] = pair(["placement", "placement"]);
    const rows = first === undefined ? [] : [{ ...first, companyDriveId: null }];
    const user = userEvent.setup();
    render(<DriveTabs view={view({ ...LISTS, inProgress: rows })} now={NOW} />);
    await screen.findByText("Zoho");
    await user.click(screen.getByRole("tab", { name: /^In progress/ }));

    expect(screen.queryByText("1 roles")).toBeNull();
    expect(screen.getByText("FACE Prep tst")).toBeDefined();
    expect(screen.getByText("SDE · Software / Technical")).toBeDefined();
  });
});
