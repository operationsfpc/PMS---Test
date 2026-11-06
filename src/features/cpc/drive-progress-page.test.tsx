// @vitest-environment jsdom
import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  type DriveProgressEntry,
  type DriveProgressOnward,
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

/**
 * Open one visit's slide-over and read inside it.
 *
 * Since 2026-10-31 the table row keeps only what a visit IS — company, date,
 * its four counts, its roles — and the students live in the pane, because
 * forty applicants at ninety pixels each pushed the next company four screens
 * down. So a test that names a student has to press `View` first, exactly as
 * the coordinator does.
 */
async function openVisit(user: ReturnType<typeof userEvent.setup>, entity: string) {
  await screen.findByText("Zoho");
  await user.click(screen.getByRole("button", { name: `View the students of ${entity}` }));
  return within(screen.getByRole("dialog"));
}

describe("DriveProgressPage", () => {
  it("shows each drive with its students' full journey", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view()} />);

    const students = await openVisit(user, "Zoho");
    const priya = students.getByText("Priya Ramesh").closest("li");
    if (priya === null) throw new Error("row not found");
    expect(within(priya).getByText(/round 1.*selected/i)).toBeDefined();
    expect(within(priya).getByText(/round 2/i)).toBeDefined();
  });

  it("shows the offer once it is made — the end of the cycle they asked to see", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view()} />);

    const students = await openVisit(user, "Zoho");
    const arjun = students.getByText("Arjun Menon").closest("li");
    if (arjun === null) throw new Error("row not found");
    expect(within(arjun).getByText(/offer.*dream/i)).toBeDefined();
  });

  it("says who applied but was not shortlisted, rather than dropping them", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view()} />);

    const students = await openVisit(user, "Zoho");
    const meena = students.getByText("Meena V").closest("li");
    if (meena === null) throw new Error("row not found");
    expect(within(meena).getByText(/not shortlisted/i)).toBeDefined();
  });

  /**
   * The other half of the same report: the table row is the whole of a visit.
   * A coordinator scanning ten companies reads one line each, not their
   * cohorts, and the names stay in the pane.
   */
  it("keeps a single-role visit to one row that says nothing about its students", async () => {
    render(<DriveProgressPage view={view()} />);

    expect(await screen.findByText("Zoho")).toBeDefined();
    expect(screen.getByText("Engineer")).toBeDefined();
    expect(screen.queryByText("Priya Ramesh")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * 2026-10-16 (Karthik): "central placement coordinator same company shows as
   * two". Two roles raised on one company visit are ONE row group now — the
   * company named once, in a cell that spans its roles — and each role is a
   * row. Folding must never merge: Priya applied to both roles and appears in
   * both rosters, because each was shortlisted, tested and offered on its own.
   */
  it("gives one company visit one row group that lists each role once", async () => {
    const mts: DriveProgressEntry = {
      ...DRIVE,
      companyDriveId: "e1",
      tentativeDate: "2026-11-05T00:00:00Z",
    };
    const qa: DriveProgressEntry = {
      ...DRIVE,
      driveId: "d2",
      roleTitle: "Quality Analyst",
      companyDriveId: "e1",
      tentativeDate: "2026-11-05T00:00:00Z",
      students: DRIVE.students.slice(0, 1),
    };

    render(<DriveProgressPage view={view([mts, qa])} />);

    expect(await screen.findByText("Zoho")).toBeDefined();
    expect(screen.getByText(/2 roles/)).toBeDefined();
    // The company opens the pane, not a record: one visit, two drive records,
    // and picking one of them silently is how the old event strip sent readers
    // to the wrong place. Each role links to its own record from inside the pane.
    expect(screen.queryByRole("link", { name: "Zoho" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Zoho in the side pane" })).toBeDefined();

    expect(screen.getByRole("button", { name: /view the students of engineer/i })).toBeDefined();
    expect(
      screen.getByRole("button", { name: /view the students of quality analyst/i }),
    ).toBeDefined();
  });

  /**
   * The card rounds itself with `overflow-hidden`, and a table is never
   * narrower than its own content, so a wide table used to lose its right-hand
   * edge — including the only button that opens a role's students. The strip
   * that scrolls has to be the table's own container, not the card.
   */
  it("keeps the table's action column inside a strip that scrolls", async () => {
    const mts: DriveProgressEntry = { ...DRIVE, companyDriveId: "e1" };
    const qa: DriveProgressEntry = {
      ...DRIVE,
      driveId: "d2",
      roleTitle: "Quality Analyst",
      companyDriveId: "e1",
      students: DRIVE.students.slice(0, 1),
    };

    render(<DriveProgressPage view={view([mts, qa])} />);
    await screen.findByText(/2 roles/);

    const table = screen.getByRole("table");
    const strip = table.parentElement;
    if (strip === null) throw new Error("the table is not wrapped in anything");
    expect(strip.className).toContain("overflow-x-auto");
    expect(strip.querySelector("tbody")).toBe(table.querySelector("tbody"));

    // The last column has no words of its own, so a reader hearing the row
    // needs the header to say what the button belongs to.
    const headers = within(table).getAllByRole("columnheader");
    const last = headers[headers.length - 1];
    if (last === undefined) throw new Error("no column headers");
    expect(last.querySelector(".sr-only")?.textContent).toBe("Action");
    expect(
      within(table).getByRole("button", { name: /view the students of engineer/i }),
    ).toBeDefined();
  });

  /**
   * A coordinator reads one role's students at a time, so the rosters live in
   * the pane rather than stacked in one long card: the row opens it on that
   * role, and the other role's students are one tab away.
   */
  it("opens the visit pane on the role the row named", async () => {
    const user = userEvent.setup();
    const mts: DriveProgressEntry = { ...DRIVE, companyDriveId: "e1" };
    const qa: DriveProgressEntry = {
      ...DRIVE,
      driveId: "d2",
      roleTitle: "Quality Analyst",
      companyDriveId: "e1",
      students: DRIVE.students.slice(0, 1),
    };

    render(<DriveProgressPage view={view([mts, qa])} />);
    await screen.findByText(/2 roles/);

    await user.click(screen.getByRole("button", { name: /view the students of engineer/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Zoho")).toBeDefined();
    expect(within(dialog).getByRole("tab", { name: "Engineer (3 applicants)" })).toBeDefined();
    expect(
      within(dialog).getByRole("tab", { name: "Quality Analyst (1 applicant)" }),
    ).toBeDefined();
    expect(within(dialog).getByText("Arjun Menon")).toBeDefined();
    expect(within(dialog).getByRole("link", { name: /^view engineer$/i })).toBeDefined();

    await user.click(within(dialog).getByRole("tab", { name: "Quality Analyst (1 applicant)" }));

    expect(within(dialog).getByText("Priya Ramesh")).toBeDefined();
    expect(within(dialog).queryByText("Arjun Menon")).toBeNull();
    expect(within(dialog).getByRole("link", { name: /^view quality analyst$/i })).toBeDefined();
  });

  /**
   * A role holds STUDENTS, not applications. Without a student id on every row
   * the figure falls back to the head-count it can actually support, so a
   * coordinator who reads "3" and phones three people finds three.
   */
  it("counts one student once in a role, however many application rows they hold", async () => {
    const withIds = DRIVE.students.map((s, i) => ({ ...s, studentId: `s${i + 1}` }));
    const [first] = DRIVE.students;
    if (first === undefined) throw new Error("fixture has no students");
    const twice = { ...first, applicationId: "a4", studentId: "s1" };
    const mts: DriveProgressEntry = { ...DRIVE, students: [...withIds, twice] };

    render(<DriveProgressPage view={view([mts])} />);
    await screen.findByText("Engineer");

    const row = screen.getByText("Engineer").closest("tr");
    if (row === null) throw new Error("row not found");
    // 4 application rows, 3 students: applicants 3, shortlisted 3, in rounds 3,
    // offers 1. Only the head-count is deduped — a stage counts the rows that
    // reached it. The four count columns follow the role title.
    const counts = within(row)
      .getAllByRole("cell")
      .slice(1, 5)
      .map((cell) => cell.textContent);
    expect(counts).toEqual(["3", "3", "3", "1"]);
  });

  /**
   * A one-role visit is one row. Its company opens the same pane the View
   * button does, and the pane carries the only deliberate route to the record
   * page — the row itself is a summary, not a navigation to a guessed record.
   */
  it("keeps a standalone drive one row whose company opens its pane", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view([DRIVE])} />);

    await screen.findByText("Engineer");
    await user.click(screen.getByRole("button", { name: "Open Zoho in the side pane" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog)
        .getByRole("link", { name: /^view engineer$/i })
        .getAttribute("href"),
    ).toBe("/drives/d1");
    expect(screen.getAllByRole("button", { name: /view the students of zoho/i })).toHaveLength(1);
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
    // 2026-11-02: the pager's rows-per-page select is a read-only control, like
    // the type chips. The rule this test protects is that nothing here WRITES.
    expect(screen.getAllByRole("combobox").map((box) => box.getAttribute("aria-label"))).toEqual([
      "Rows per page",
    ]);

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

  /**
   * 2026-11-06: a drive row that came back without its status used to be shown
   * as "Live". The one question this screen exists to answer is whether
   * students can act on a drive, so guessing the answer was worse than
   * admitting the row is missing — an unapproved drive read as live and a
   * coordinator stops chasing the approval.
   */
  it("says the status did not come back instead of calling the drive Live", async () => {
    render(<DriveProgressPage view={view([{ ...DRIVE, status: null }])} />);

    expect(await screen.findByText("Status not loaded")).toBeDefined();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("still spells a status it was given", async () => {
    render(<DriveProgressPage view={view()} />);

    const row = (await screen.findByText("Engineer")).closest("tr");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText("In rounds")).toBeDefined();
    expect(within(row).queryByText("Status not loaded")).toBeNull();
  });

  /**
   * 2026-11-06: this screen tells a coordinator who is shortlisted and where
   * each student stands, and then leaves them with one exit — the drive
   * record. The two screens where they act on that (shortlisting, attendance)
   * were back at the sidebar and opened with no drive chosen, so the read and
   * the decision were two trips apart. The pane now carries both, already
   * pointed at the role being read.
   */
  describe("the onward press", () => {
    const asRole = async (
      user: ReturnType<typeof userEvent.setup>,
      onward: DriveProgressOnward,
    ) => {
      render(<DriveProgressPage view={view()} onward={onward} />);
      return await openVisit(user, "Zoho");
    };

    it("carries a coordinator to the two screens they act on, with this role chosen", async () => {
      const user = userEvent.setup();
      const students = await asRole(user, { shortlist: true, attendance: true });

      expect(
        students
          .getByRole("link", { name: "Shortlist the applicants of Engineer" })
          .getAttribute("href"),
      ).toBe("/central/shortlisting?drive=d1");
      expect(
        students
          .getByRole("link", { name: "Mark the attendance of Engineer" })
          .getAttribute("href"),
      ).toBe("/cpc/attendance?drive=d1");
    });

    it("offers only the onward screen the account may open", async () => {
      const user = userEvent.setup();
      const students = await asRole(user, { shortlist: false, attendance: true });

      expect(students.queryByRole("link", { name: /shortlist/i })).toBeNull();
      expect(
        students
          .getByRole("link", { name: "Mark the attendance of Engineer" })
          .getAttribute("href"),
      ).toBe("/cpc/attendance?drive=d1");
    });

    it("offers neither when the account may open neither", async () => {
      const user = userEvent.setup();
      const students = await asRole(user, { shortlist: false, attendance: false });

      expect(students.queryByRole("link", { name: /shortlist/i })).toBeNull();
      expect(students.queryByRole("link", { name: /attendance/i })).toBeNull();
      // The record is still one press away for everyone.
      expect(students.getByRole("link", { name: "View Engineer" })).toBeDefined();
    });
  });

  /**
   * RLS hands an unmapped coordinator nothing at all, so their empty list and
   * a genuinely quiet campus look identical. The auth state already knows the
   * difference — the sidebar says so — and the page is now told.
   *
   * Which roles that applies to is `isScopedByCampusMapping`'s own question,
   * answered in the domain tests; the page only says what it is told.
   */
  describe("an account with nothing in front of it", () => {
    it("says the mapping is missing rather than that there are no drives", async () => {
      render(<DriveProgressPage view={view([])} campusUnmapped />);

      expect(await screen.findByText(/no campus is mapped to your account/i)).toBeDefined();
      expect(screen.queryByText(/no drives involve your students yet/i)).toBeNull();
    });

    it("still says no drives to an account that does have a campus", async () => {
      render(<DriveProgressPage view={view([])} />);

      expect(await screen.findByText(/no drives involve your students yet/i)).toBeDefined();
      expect(screen.queryByText(/no campus is mapped to your account/i)).toBeNull();
    });
  });
});

/**
 * "Add a search bar to the Drive progress section for Campus Placement
 * Coordinators … quickly search for specific companies and monitor their
 * ongoing drive progress without manual scrolling." (2026-08-18)
 *
 * The same `searchDrives` predicate the Live list uses, so "hcl" means the same
 * thing on every screen that lists drives.
 */
describe("DriveProgressPage — searching", () => {
  const two = {
    drives: async () => [
      { ...DRIVE, companyName: "Cognizant" },
      { ...DRIVE, driveId: "d2", companyName: "Accenture", roleTitle: "Jr. Software engineer" },
    ],
  };

  it("offers a column filter on the Company header", async () => {
    render(<DriveProgressPage view={two} />);
    await screen.findByText("Cognizant");

    expect(screen.getByRole("button", { name: /filter company/i })).toBeDefined();
  });

  it("narrows to the company the coordinator is asking about", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={two} />);
    await screen.findByText("Cognizant");

    await user.click(screen.getByRole("button", { name: /filter company/i }));
    await user.type(screen.getByPlaceholderText(/search company/i), "accen");

    expect(screen.getByText("Accenture")).toBeDefined();
    expect(screen.queryByText("Cognizant")).toBeNull();
  });

  it("says nothing matched rather than looking like an empty campus", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={two} />);
    await screen.findByText("Cognizant");

    await user.click(screen.getByRole("button", { name: /filter company/i }));
    await user.type(screen.getByPlaceholderText(/search company/i), "infosys");

    expect(screen.getByText(/no drives match/i)).toBeDefined();
    expect(screen.queryByText(/no drives involve your students yet/i)).toBeNull();
  });

  it("offers no column filter when there is nothing to search", async () => {
    render(<DriveProgressPage view={{ drives: async () => [] }} />);
    await screen.findByText(/no drives involve your students yet/i);

    expect(screen.queryByRole("button", { name: /filter company/i })).toBeNull();
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

  it("tags each drive row with its type", async () => {
    showTyped();
    await screen.findByText("ABCD Infosys");

    // Inside the table, not the filter chips above it: the tag belongs to the
    // row, and a chip matching in its place would pass even if the row said
    // nothing.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Internship")).toBeDefined();
    expect(within(table).getByText("Full time")).toBeDefined();
  });

  it("narrows to the chosen type", async () => {
    const user = userEvent.setup();
    showTyped();
    await screen.findByText("ABCD Infosys");

    // The drive type filter is now a column filter on the Status column header.
    const filterButton = screen.getByRole("button", { name: /filter drive type/i });
    await user.click(filterButton);

    // The dropdown opens with checkboxes for each type.
    const internshipCheckbox = screen.getByRole("checkbox", { name: /internship$/i });
    await user.click(internshipCheckbox);

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
    const user = userEvent.setup();
    render(<DriveProgressPage view={view(withCategory("super_dream"))} />);

    const students = await openVisit(user, "Zoho");
    expect(await students.findByText(/Offer · ₹12 LPA · Super Dream/)).toBeDefined();
  });

  it("uses them for an internship too", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view(withCategory("internship"))} />);

    const students = await openVisit(user, "Zoho");
    expect(await students.findByText(/Offer · ₹12 LPA · Internship/)).toBeDefined();
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
    const user = userEvent.setup();
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

    const students = await openVisit(user, "Zoho");
    expect(await students.findByText(/Offer · ₹15,000 \/ month · Internship/)).toBeDefined();
  });

  it("still quotes a salaried offer in LPA", async () => {
    const user = userEvent.setup();
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

    const students = await openVisit(user, "Zoho");
    expect(await students.findByText(/Offer · ₹12 LPA · Super Dream/)).toBeDefined();
  });
});

describe("DriveProgressPage — college chips in the pane", () => {
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
    const user = userEvent.setup();
    render(<DriveProgressPage view={view([multiCollegeDrive])} />);

    const students = await openVisit(user, "Zoho");
    expect((await students.findAllByText("Alliance University")).length).toBeGreaterThan(0);
    expect((await students.findAllByText("VIT Bangalore")).length).toBeGreaterThan(0);
    expect(students.getByText("All Colleges")).toBeDefined();
  });

  it("filters students when a college card is clicked and resets on All Colleges", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view([multiCollegeDrive])} />);

    const students = await openVisit(user, "Zoho");
    await students.findAllByText("Alliance University");

    // Click VIT Bangalore card
    await user.click(students.getByRole("button", { name: /vit bangalore/i }));

    expect(students.getByText("Arjun Menon")).toBeDefined();
    expect(students.queryByText("Priya Ramesh")).toBeNull();
    expect(students.queryByText("Meena V")).toBeNull();

    // Click All Colleges
    await user.click(students.getByRole("button", { name: /all colleges/i }));

    expect(students.getByText("Priya Ramesh")).toBeDefined();
    expect(students.getByText("Arjun Menon")).toBeDefined();
  });

  /** The strip replaces a card grid, so the chosen college has to be readable
   *  off the chip itself rather than inferred from which rows survived. */
  it("marks the chosen college chip as the one in effect", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view([multiCollegeDrive])} />);

    const students = await openVisit(user, "Zoho");
    await students.findAllByText("Alliance University");
    expect(
      students.getByRole("button", { name: /all colleges/i }).getAttribute("aria-pressed"),
    ).toBe("true");

    await user.click(students.getByRole("button", { name: /vit bangalore/i }));

    expect(
      students.getByRole("button", { name: /vit bangalore/i }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      students.getByRole("button", { name: /all colleges/i }).getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

/**
 * 2026-11-02: the board was "too long". It paged by ten VISITS — ten rows for
 * legacy drives, forty for a visit that raised four roles — and drew no pager
 * at all until it had more than ten. A page is now filled to a budget of role
 * rows, whole visits only, and the pager is always on screen.
 */
describe("DriveProgressPage — paging by role rows, never splitting a visit", () => {
  const visitRoles = (company: string, eventId: string, roleTitles: readonly string[]) =>
    roleTitles.map(
      (roleTitle, index): DriveProgressEntry => ({
        ...DRIVE,
        driveId: `${eventId}-d${index}`,
        companyDriveId: eventId,
        companyName: company,
        roleTitle,
        tentativeDate: "2026-11-05T00:00:00Z",
        students: DRIVE.students.slice(0, 1),
      }),
    );

  /** Three visits of four roles each: 12 rows, but only three companies. */
  const THREE_VISITS = [
    ...visitRoles("Alpha Corp", "e1", ["Engineer", "Analyst", "Designer", "QA"]),
    ...visitRoles("Beta Corp", "e2", ["Engineer", "Analyst", "Designer", "QA"]),
    ...visitRoles("Gamma Corp", "e3", ["Engineer", "Analyst", "Designer", "QA"]),
  ];

  it("draws the pager even when everything fits on one page", async () => {
    render(<DriveProgressPage view={view(THREE_VISITS)} />);
    await screen.findByText("Alpha Corp");

    expect(screen.getByText(/showing visits 1 to 3 of 3 · 12 role rows/i)).toBeDefined();
    expect(screen.getByText(/page 1 of 1/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);
  });

  it("fills a page to the row budget and never splits a visit", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view(THREE_VISITS)} />);
    await screen.findByText("Alpha Corp");

    await user.selectOptions(screen.getByLabelText("Rows per page"), "10");

    // Eight rows fit; the third visit would take the page to twelve, so it
    // starts page two rather than leaving half a company behind.
    expect(screen.getByText(/showing visits 1 to 2 of 3 · 8 role rows/i)).toBeDefined();
    expect(screen.getByText("Alpha Corp")).toBeDefined();
    expect(screen.getByText("Beta Corp")).toBeDefined();
    expect(screen.queryByText("Gamma Corp")).toBeNull();

    // All four roles of the first visit are on this page.
    const alpha = screen.getByText("Alpha Corp").closest("tbody");
    if (alpha === null) throw new Error("the first visit is not in a row group");
    expect(within(alpha).getAllByRole("row")).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Gamma Corp")).toBeDefined();
    expect(screen.queryByText("Alpha Corp")).toBeNull();
    expect(screen.getByText(/showing visits 3 to 3 of 3 · 4 role rows/i)).toBeDefined();
    expect(screen.getByText(/page 2 of 2/i)).toBeDefined();
  });

  it("shows a visit whole even when it alone exceeds the budget", async () => {
    const user = userEvent.setup();
    const tall = visitRoles(
      "Solo Corp",
      "e9",
      Array.from({ length: 12 }, (_, index) => `Role ${index + 1}`),
    );
    render(<DriveProgressPage view={view(tall)} />);
    await screen.findByText("Solo Corp");

    await user.selectOptions(screen.getByLabelText("Rows per page"), "10");

    expect(screen.getByText(/showing visits 1 to 1 of 1 · 12 role rows/i)).toBeDefined();
    expect(screen.getByText(/page 1 of 1/i)).toBeDefined();
  });
});

/**
 * 2026-11-02: "each data should be proper clickable as popup read". The row is
 * a summary of a visit, so every fact it prints opens the pane where that fact
 * lives: the company and the role open the role, and each count opens that
 * role already filtered to the stage the count named.
 */
describe("DriveProgressPage — a row opens the pane where it was pressed", () => {
  const twoRoles = (): readonly DriveProgressEntry[] => {
    const mts: DriveProgressEntry = { ...DRIVE, companyDriveId: "e1" };
    const qa: DriveProgressEntry = {
      ...DRIVE,
      driveId: "d2",
      roleTitle: "Quality Analyst",
      companyDriveId: "e1",
      students: DRIVE.students.slice(0, 1),
    };
    return [mts, qa];
  };

  it("opens the pane on the role whose name was pressed", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view(twoRoles())} />);
    await screen.findByText(/2 roles/);

    await user.click(screen.getByRole("button", { name: "Open Quality Analyst in the side pane" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog)
        .getByRole("tab", { name: "Quality Analyst (1 applicant)" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(within(dialog).getByText("Priya Ramesh")).toBeDefined();
    expect(within(dialog).queryByText("Arjun Menon")).toBeNull();
  });

  it("opens the company on the visit's first role", async () => {
    const user = userEvent.setup();
    render(<DriveProgressPage view={view(twoRoles())} />);
    await screen.findByText(/2 roles/);

    await user.click(screen.getByRole("button", { name: "Open Zoho in the side pane" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog)
        .getByRole("tab", { name: "Engineer (3 applicants)" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  const STAGES: readonly {
    readonly description: string;
    readonly stageChip: RegExp;
    readonly shown: readonly string[];
    readonly hidden: readonly string[];
  }[] = [
    {
      description: "applicants",
      stageChip: /3 total applicants/i,
      shown: ["Priya Ramesh", "Arjun Menon", "Meena V"],
      hidden: [],
    },
    {
      description: "shortlisted students",
      stageChip: /2 shortlisted/i,
      shown: ["Priya Ramesh", "Arjun Menon"],
      hidden: ["Meena V"],
    },
    {
      description: "students in rounds",
      stageChip: /2 in rounds/i,
      shown: ["Priya Ramesh", "Arjun Menon"],
      hidden: ["Meena V"],
    },
    {
      description: "students with an offer",
      stageChip: /1 offers/i,
      shown: ["Arjun Menon"],
      hidden: ["Priya Ramesh", "Meena V"],
    },
  ];

  it.each(STAGES)(
    "opens the pane at the stage behind the $description count",
    async ({ description, stageChip, shown, hidden }) => {
      const user = userEvent.setup();
      render(<DriveProgressPage view={view()} />);
      await screen.findByText("Engineer");

      await user.click(screen.getByRole("button", { name: `Open the ${description} of Engineer` }));

      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("button", { name: stageChip }).getAttribute("aria-pressed"),
      ).toBe("true");
      for (const name of shown) expect(within(dialog).getByText(name)).toBeDefined();
      for (const name of hidden) expect(within(dialog).queryByText(name)).toBeNull();
    },
  );
});
