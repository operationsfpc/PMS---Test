// @vitest-environment jsdom
import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  type DriveProgressEntry,
  DriveProgressPage,
  type DriveProgressView,
} from "./drive-progress-page";

const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

/**
 * D10 (2026-08-12): the campus placement coordinator follows their students
 * through the ENTIRE cycle — shortlist, every round, the offer. Read-only:
 * recording stays with the Central CPC, attendance on its own screen.
 */
const DRIVE: DriveProgressEntry = {
  driveId: "d1",
  companyName: "Zoho",
  roleTitle: "Engineer",
  status: "in_rounds",
  students: [
    {
      applicationId: "a1",
      studentName: "Priya Ramesh",
      rollNumber: "21CSE1042",
      shortlisted: true,
      rounds: [
        { sequence: 1, name: "Aptitude", attendance: "present", result: "selected" },
        { sequence: 2, name: "Technical", attendance: "scheduled", result: null },
      ],
      offer: null,
    },
    {
      applicationId: "a2",
      studentName: "Arjun Menon",
      rollNumber: "21CSE9001",
      shortlisted: true,
      rounds: [{ sequence: 1, name: "Aptitude", attendance: "absent", result: "rejected" }],
      offer: { ctcLpa: 8, offerCategory: "dream" },
    },
    {
      applicationId: "a3",
      studentName: "Meena V",
      rollNumber: "21CSE5555",
      shortlisted: false,
      rounds: [],
      offer: null,
    },
  ],
};

const view = (drives: readonly DriveProgressEntry[] = [DRIVE]): DriveProgressView => ({
  drives: async () => drives,
});

describe("DriveProgressPage", () => {
  it("shows each drive with its students' full journey", async () => {
    render(<DriveProgressPage view={view()} />);

    expect(await screen.findByText("Zoho")).toBeDefined();

    const priya = screen.getByText("Priya Ramesh").closest("li");
    if (priya === null) throw new Error("row not found");
    expect(within(priya).getByText(/round 1.*selected/i)).toBeDefined();
    expect(within(priya).getByText(/round 2/i)).toBeDefined();
  });

  it("shows the offer once it is made — the end of the cycle they asked to see", async () => {
    render(<DriveProgressPage view={view()} />);

    const arjun = (await screen.findByText("Arjun Menon")).closest("li");
    if (arjun === null) throw new Error("row not found");
    expect(within(arjun).getByText(/offer.*dream/i)).toBeDefined();
  });

  it("says who applied but was not shortlisted, rather than dropping them", async () => {
    render(<DriveProgressPage view={view()} />);

    const meena = (await screen.findByText("Meena V")).closest("li");
    if (meena === null) throw new Error("row not found");
    expect(within(meena).getByText(/not shortlisted/i)).toBeDefined();
  });

  /**
   * Narrowed 2026-08-18, deliberately: the page gained a search box, and a
   * search changes nothing about a drive. What this test is FOR is that no
   * control here can record a result, mark attendance or decide an offer -
   * recording stays with the Central CPC (D10). So: no writing controls, and
   * the only button on the page is the search submit.
   */
  it("is read-only — nothing here records anything", async () => {
    render(<DriveProgressPage view={view()} />);

    await screen.findByText("Zoho");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();

    // 2026-08-27: the drive-type filter added four buttons. The rule this
    // test protects is that nothing here WRITES — narrowing a list does not.
    // Asserted as "no verb" rather than as an exact list, so the next
    // read-only control does not look like a regression while a Save button
    // still would.
    const verbs = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((text) => /save|record|mark|approve|reject|submit|declare|remove|delete/i.test(text));
    expect(verbs).toEqual([]);
  });

  it("says so when no drive touches their campus yet", async () => {
    render(<DriveProgressPage view={view([])} />);

    expect(await screen.findByText(/no drives involve your students yet/i)).toBeDefined();
  });
});

/**
 * "Add a search bar to the Drive progress section for Campus Placement
 * Coordinators … quickly search for specific companies and monitor their
 * ongoing drive progress without manual scrolling." (2026-08-18)
 *
 * The same `searchDrives` predicate the Live list uses, so "hcl" means the same
 * thing on every screen that lists drives - and each card here carries a whole
 * cohort's rounds, so this page is the longest scroll in the application.
 */
describe("DriveProgressPage — searching", () => {
  const two = {
    drives: async () => [
      { ...DRIVE, companyName: "Cognizant" },
      { ...DRIVE, driveId: "d2", companyName: "Accenture", roleTitle: "Jr. Software engineer" },
    ],
  };

  it("offers a labelled search box", async () => {
    render(<DriveProgressPage view={two} />);
    await screen.findByText("Cognizant");

    expect(screen.getByRole("searchbox", { name: /search drives/i })).toBeDefined();
  });

  it("narrows to the company the coordinator is asking about", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={two} />);
    await screen.findByText("Cognizant");

    await user.type(screen.getByRole("searchbox", { name: /search drives/i }), "accen");

    expect(screen.getByText("Accenture")).toBeDefined();
    expect(screen.queryByText("Cognizant")).toBeNull();
  });

  it("says nothing matched rather than looking like an empty campus", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={two} />);
    await screen.findByText("Cognizant");

    await user.type(screen.getByRole("searchbox", { name: /search drives/i }), "infosys");

    expect(screen.getByText(/no drives match/i)).toBeDefined();
    expect(screen.queryByText(/no drives involve your students yet/i)).toBeNull();
  });

  it("offers no search box at all when there is nothing to search", async () => {
    render(<DriveProgressPage view={{ drives: async () => [] }} />);
    await screen.findByText(/no drives involve your students yet/i);

    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

/**
 * Karthik, 2026-08-27: the filter and the tag belong on every list of ongoing
 * drives — this is the campus coordinator's.
 */
describe("DriveProgressPage — filtering and tagging by drive type", () => {
  const typed = [
    { ...DRIVE, driveId: "p1", companyName: "Zoho", driveType: "placement" as const },
    {
      ...DRIVE,
      driveId: "p2",
      companyName: "ABCD Infosys",
      driveType: "internship" as const,
    },
  ];

  const showTyped = () => render(<DriveProgressPage view={{ drives: async () => typed }} />);

  it("tags each drive with its type", async () => {
    showTyped();
    await screen.findByText("ABCD Infosys");

    expect(screen.getAllByText("Internship").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Full time").length).toBeGreaterThan(0);
  });

  it("narrows to the chosen type", async () => {
    const user = userEvent.setup();
    showTyped();
    await screen.findByText("ABCD Infosys");

    const filter = screen.getByRole("group", { name: /drive type/i });
    await user.click(within(filter).getByRole("button", { name: /^Internship \d+$/ }));

    expect(screen.getByText("ABCD Infosys")).toBeDefined();
    expect(screen.queryByText("Zoho")).toBeNull();
  });
});

/**
 * 2026-08-27: the CPC's progress board spelled the offer category with the
 * same underscore-stripping humaniser — "Offer · ₹8 LPA · super dream".
 */
describe("the offer badge's spelling", () => {
  const withCategory = (offerCategory: string): readonly DriveProgressEntry[] => [
    {
      ...DRIVE,
      students: [
        {
          applicationId: "a9",
          studentName: "Nithya S",
          rollNumber: "21CSE7777",
          shortlisted: true,
          rounds: [],
          offer: { ctcLpa: 12, offerCategory },
        },
      ],
    },
  ];

  it("uses the domain's words for a rung", async () => {
    render(<DriveProgressPage view={view(withCategory("super_dream"))} />);

    expect(await screen.findByText(/Offer · ₹12 LPA · Super Dream/)).toBeDefined();
  });

  it("uses them for an internship too", async () => {
    render(<DriveProgressPage view={view(withCategory("internship"))} />);

    expect(await screen.findByText(/Offer · ₹12 LPA · Internship/)).toBeDefined();
  });
});

/**
 * 🔴 2026-08-27, "option 1": the coordinator's board printed
 * "Offer · ₹10 LPA" against an internship paying ₹15,000 a month.
 */
describe("what the board says an internship offer paid", () => {
  const withOffer = (offer: Record<string, unknown>): readonly DriveProgressEntry[] => [
    {
      ...DRIVE,
      students: [
        {
          applicationId: "a9",
          studentName: "Nithya S",
          rollNumber: "21CSE7777",
          shortlisted: true,
          rounds: [],
          offer: offer as DriveProgressEntry["students"][number]["offer"],
        },
      ],
    },
  ];

  it("quotes a stipend monthly, never as a package", async () => {
    render(
      <DriveProgressPage
        view={view(
          withOffer({
            ctcLpa: null,
            stipendMonthly: 15000,
            driveType: "internship",
            offerCategory: "internship",
          }),
        )}
      />,
    );

    expect(await screen.findByText(/Offer · ₹15,000 \/ month · Internship/)).toBeDefined();
  });

  it("still quotes a salaried offer in LPA", async () => {
    render(
      <DriveProgressPage
        view={view(
          withOffer({
            ctcLpa: 12,
            stipendMonthly: null,
            driveType: "placement",
            offerCategory: "super_dream",
          }),
        )}
      />,
    );

    expect(await screen.findByText(/Offer · ₹12 LPA · Super Dream/)).toBeDefined();
  });
});

describe("DriveProgressPage — college-wise breakdown cards", () => {
  const multiCollegeDrive: DriveProgressEntry = {
    driveId: "d1",
    companyName: "Zoho",
    roleTitle: "Software Engineer",
    status: "in_rounds",
    students: [
      {
        applicationId: "a1",
        studentName: "Priya Ramesh",
        rollNumber: "21CSE1042",
        campusName: "Alliance University",
        shortlisted: true,
        rounds: [{ sequence: 1, name: "Aptitude", attendance: "present", result: "selected" }],
        offer: { ctcLpa: 8, offerCategory: "dream" },
      },
      {
        applicationId: "a2",
        studentName: "Arjun Menon",
        rollNumber: "21CSE9001",
        campusName: "VIT Bangalore",
        shortlisted: true,
        rounds: [{ sequence: 1, name: "Aptitude", attendance: "present", result: null }],
        offer: null,
      },
      {
        applicationId: "a3",
        studentName: "Meena V",
        rollNumber: "21CSE5555",
        campusName: "Alliance University",
        shortlisted: false,
        rounds: [],
        offer: null,
      },
    ],
  };

  it("shows clickable college breakdown cards with counts", async () => {
    render(<DriveProgressPage view={view([multiCollegeDrive])} />);

    expect((await screen.findAllByText("Alliance University")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("VIT Bangalore")).length).toBeGreaterThan(0);
    expect(screen.getByText("All Colleges")).toBeDefined();
  });

  it("filters students when a college card is clicked and resets on All Colleges", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view([multiCollegeDrive])} />);

    await screen.findAllByText("Alliance University");

    // Click VIT Bangalore card
    const vitButton = screen.getByRole("button", { name: /vit bangalore/i });
    await user.click(vitButton);

    expect(screen.getByText("Arjun Menon")).toBeDefined();
    expect(screen.queryByText("Priya Ramesh")).toBeNull();
    expect(screen.queryByText("Meena V")).toBeNull();

    // Click All Colleges
    const allCollegesButton = screen.getByRole("button", { name: /all colleges/i });
    await user.click(allCollegesButton);

    expect(screen.getByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByText("Arjun Menon")).toBeDefined();
  });
});
