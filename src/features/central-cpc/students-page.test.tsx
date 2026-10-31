// @vitest-environment jsdom
import { parseCsv } from "@domain/csv";
import type { DirectoryStudent } from "@domain/student-directory";
import type { HoldsView } from "@lib/holds-view";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { StudentDirectoryPage, type StudentDirectoryView } from "./students-page";

/**
 * 2026-08-17 (Karthik): "add one more page to display details of all students
 * part of the placement process", and "hyperlink the Placed count to open or
 * export a detailed breakdown (student name, company, package, role)".
 *
 * One screen serves both. The breakdown is this list filtered to the placed,
 * so the dashboard's number and the rows behind it cannot drift apart.
 */
const PLACED: DirectoryStudent = {
  studentId: "s1",
  fullName: "Anjali Subramanian",
  rollNumber: "21CSE1042",
  campusName: "SDNB Vaishnav College",
  degree: "B.E.",
  branch: "CSE",
  passingYear: 2026,
  cgpa: 8.6,
  srfStatus: "srf_approved",
  participationStatus: "active",
  applications: 3,
  hasSelfPlacement: false,
  placement: {
    companyName: "Zoho Corporation",
    roleTitle: "Member Technical Staff",
    ctcLpa: 6.5,
    offerCategory: "dream",
    source: "on_campus",
  },
};

/**
 * C1 (UAT 2026-08-19): Thanush — self-placed, approved, and shown as "Not
 * Placed". A self-placed student IS placed in this directory; the row says
 * where the offer came from so the reporting line stays legible.
 */
const SELF_PLACED: DirectoryStudent = {
  studentId: "s3",
  fullName: "Thanush Krishna",
  rollNumber: "21CSE1100",
  campusName: "SDNB Vaishnav College",
  degree: "B.E.",
  branch: "CSE",
  passingYear: 2026,
  cgpa: 7.4,
  srfStatus: "srf_approved",
  participationStatus: "active",
  applications: 2,
  hasSelfPlacement: true,
  placement: {
    companyName: "FACE Prep Campus",
    roleTitle: null,
    ctcLpa: 3.5,
    offerCategory: "regular",
    source: "self_placed",
  },
};

const UNPLACED: DirectoryStudent = {
  studentId: "s2",
  fullName: "Rahul Nair",
  rollNumber: "21CSE1099",
  campusName: "SDNB Vaishnav College",
  degree: "B.E.",
  branch: "ECE",
  passingYear: 2026,
  cgpa: null,
  srfStatus: "srf_submitted",
  participationStatus: "active",
  applications: 1,
  hasSelfPlacement: false,
  placement: null,
};

const view = (
  students: readonly DirectoryStudent[],
  overrides: Partial<StudentDirectoryView> = {},
): StudentDirectoryView => ({
  students: async () => students,
  ...overrides,
});

const show = (
  students: readonly DirectoryStudent[] = [PLACED, UNPLACED],
  path = "/central/students",
  download = vi.fn(),
  overrides: Partial<StudentDirectoryView> = {},
) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <StudentDirectoryPage view={view(students, overrides)} download={download} />
    </MemoryRouter>,
  );

describe("StudentDirectoryPage", () => {
  it("lists every student in the placement process", async () => {
    show();
    expect(await screen.findByText("Anjali Subramanian")).toBeDefined();
    expect(screen.getByText("Rahul Nair")).toBeDefined();
  });

  /** The four facts Karthik named: name, company, package, role. */
  it("shows the placement details for a placed student", async () => {
    show();
    const row = await screen.findByRole("row", { name: /anjali subramanian/i });

    expect(within(row).getByText(/Zoho Corporation/)).toBeDefined();
    expect(within(row).getByText(/Member Technical Staff/)).toBeDefined();
    expect(within(row).getByText(/6\.5/)).toBeDefined();
  });

  /** "Not placed" must read as a fact, never as a blank cell that looks broken. */
  it("says a student is not placed rather than leaving a gap", async () => {
    show();
    const row = await screen.findByRole("row", { name: /rahul nair/i });
    expect(within(row).getByText(/not placed/i)).toBeDefined();
  });

  /** C1: a self-placed student is placed, and the row says the source. */
  it("shows a self-placed student as placed, labelled self-placed", async () => {
    show([PLACED, UNPLACED, SELF_PLACED]);
    const row = await screen.findByRole("row", { name: /thanush krishna/i });

    expect(within(row).getByText(/FACE Prep Campus/)).toBeDefined();
    expect(within(row).getByText(/self-placed/i)).toBeDefined();
    expect(within(row).queryByText(/not placed/i)).toBeNull();
  });

  it("counts a self-placed student inside the Placed filter", async () => {
    const user = userEvent.setup();
    show([PLACED, UNPLACED, SELF_PLACED]);
    await screen.findByText("Thanush Krishna");

    await user.click(screen.getByRole("radio", { name: "Placed" }));

    expect(screen.getByText("Thanush Krishna")).toBeDefined();
    expect(screen.queryByText("Rahul Nair")).toBeNull();
  });

  it("shows the roll number, campus and branch", async () => {
    show();
    const row = await screen.findByRole("row", { name: /anjali subramanian/i });
    expect(within(row).getByText(/21CSE1042/)).toBeDefined();
    expect(row.textContent).toMatch(/SDNB Vaishnav College/);
    expect(row.textContent).toMatch(/CSE/);
  });

  it("filters to the placed when asked", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText("Anjali Subramanian");

    await user.click(screen.getByRole("radio", { name: "Placed" }));

    expect(screen.getByText("Anjali Subramanian")).toBeDefined();
    expect(screen.queryByText("Rahul Nair")).toBeNull();
  });

  /**
   * The dashboard's Placed count links straight here. Arriving already
   * filtered is the whole point of the link: a coordinator who has to filter
   * again has not been taken to the breakdown, only to the list.
   */
  it("arrives already filtered when the dashboard sends it a filter", async () => {
    show([PLACED, UNPLACED], "/central/students?filter=placed");
    expect(await screen.findByText("Anjali Subramanian")).toBeDefined();
    expect(screen.queryByText("Rahul Nair")).toBeNull();
  });

  it("searches by name, roll number or company", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText("Anjali Subramanian");

    await user.type(screen.getByRole("searchbox", { name: /search/i }), "zoho");

    expect(screen.getByText("Anjali Subramanian")).toBeDefined();
    expect(screen.queryByText("Rahul Nair")).toBeNull();
  });

  it("says so plainly when a search matches nobody", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText("Anjali Subramanian");

    await user.type(screen.getByRole("searchbox", { name: /search/i }), "nobody");
    expect(screen.getByText(/no students match/i)).toBeDefined();
  });

  it("exports what is on screen, not the whole roster", async () => {
    const user = userEvent.setup();
    const download = vi.fn();
    show([PLACED, UNPLACED], "/central/students?filter=placed", download);
    await screen.findByText("Anjali Subramanian");

    await user.click(screen.getByRole("button", { name: /export/i }));

    expect(download).toHaveBeenCalledTimes(1);
    const csv = download.mock.calls[0]?.[1] as string;
    expect(csv).toMatch(/Anjali Subramanian/);
    expect(csv).toMatch(/Zoho Corporation/);
    expect(csv).not.toMatch(/Rahul Nair/);
  });

  /**
   * 2026-10-18 (UAT): the overview's counts open a popup with a CGPA column,
   * and this directory is the list those names link into. The same student
   * cannot carry a figure there and none here.
   */
  it("prints the CGPA on the row of a student whose roster carries one", async () => {
    show([PLACED, UNPLACED]);
    const row = await screen.findByRole("row", { name: /anjali subramanian/i });

    expect(within(row).getByText(/8\.60 CGPA/)).toBeDefined();
  });

  it("says nothing about CGPA for a student whose roster records none", async () => {
    show([PLACED, UNPLACED]);
    const row = await screen.findByRole("row", { name: /rahul nair/i });

    expect(within(row).queryByText(/CGPA/)).toBeNull();
  });

  it("carries the CGPA into the export, blank when unrecorded", async () => {
    const user = userEvent.setup();
    const download = vi.fn();
    show([PLACED, UNPLACED], "/central/students", download);
    await screen.findByText("Anjali Subramanian");

    await user.click(screen.getByRole("button", { name: /export/i }));

    const table = parseCsv(download.mock.calls[0]?.[1] as string);
    const header = table[0] ?? [];
    const rows = table.slice(1);
    const column = header.indexOf("CGPA");
    expect(column).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.[column]).toBe("8.60");
    expect(rows[1]?.[column]).toBe("");
  });

  /**
   * #79 (UAT 2026-10-18): this CSV is the file a coordinator hands to a recruiter
   * or keeps as the academic record, and it described a student without carrying
   * their CV. One column — and the sentence that follows says how many of them
   * arrived filled, which is #78's rule applied here.
   */
  it("links each student's resume in the export", async () => {
    const user = userEvent.setup();
    const download = vi.fn();
    show([PLACED, UNPLACED], "/central/students", download, {
      resumeLinks: async () => new Map([["s1", "https://x/anjali-cv.pdf"]]),
    });
    await screen.findByText("Anjali Subramanian");

    await user.click(screen.getByRole("button", { name: /export/i }));

    const table = parseCsv(download.mock.calls[0]?.[1] as string);
    const column = (table[0] ?? []).indexOf("Resume link");
    expect(column).toBeGreaterThanOrEqual(0);
    const rows = table.slice(1);
    expect(rows[0]?.[column]).toBe("https://x/anjali-cv.pdf");
    expect(rows[1]?.[column]).toBe("");
    expect(await screen.findByText(/1 of 2 carry a resume link/i)).toBeDefined();
  });

  it("says the export failed rather than sending a file with an empty column", async () => {
    const user = userEvent.setup();
    const download = vi.fn();
    show([PLACED, UNPLACED], "/central/students", download, {
      resumeLinks: async () => {
        throw new Error("Could not generate the resume links. Try the export again.");
      },
    });
    await screen.findByText("Anjali Subramanian");

    await user.click(screen.getByRole("button", { name: /export/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not generate the resume links/i);
    expect(download).not.toHaveBeenCalled();
  });

  /**
   * 2026-10-29: the Participation column is the only place the CSV says what
   * a student's status is, and it must read the way the screen says it —
   * "On hold", never the database's `on_hold`. The file is read by people,
   * not machines.
   */
  it("prints the participation as the screen words it for a held student in the export", async () => {
    const user = userEvent.setup();
    const download = vi.fn();
    const held: DirectoryStudent = { ...UNPLACED, participationStatus: "on_hold" };
    show([PLACED, held], "/central/students", download);
    await screen.findByText("Anjali Subramanian");

    await user.click(screen.getByRole("button", { name: /export/i }));

    const table = parseCsv(download.mock.calls[0]?.[1] as string);
    const header = table[0] ?? [];
    const rows = table.slice(1);
    const column = header.indexOf("Participation");
    expect(column).toBeGreaterThanOrEqual(0);
    expect(rows[1]?.[column]).toBe("On hold");
  });

  it("tells the reader how many students it is showing", async () => {
    show();
    // The count line and the pager both speak; the count is the filtered total,
    // the pager says which slice of it is on screen.
    expect(await screen.findByText(/^2 students$/)).toBeDefined();
    expect(screen.getByText(/showing 1 to 2 of 2 students/i)).toBeDefined();
  });
  it("says the roster is empty rather than showing a bare table", async () => {
    show([]);
    expect(await screen.findByText(/no students yet/i)).toBeDefined();
  });

  it("reports a failure instead of pretending the roster is empty", async () => {
    render(
      <MemoryRouter>
        <StudentDirectoryPage
          view={{
            students: async () => {
              throw new Error("nope");
            },
          }}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText(/no students yet/i)).toBeNull();
  });
});

/**
 * G7 (UAT 2026-08-20): "Student numbers/counts aren't clickable, and there's
 * no way to drill into student details from that view." The name opens the
 * canonical record, and the summary counts apply their filter.
 */
describe("drilling into a student (G7)", () => {
  it("links every student's name to their canonical record", async () => {
    show();

    const link = await screen.findByRole("link", { name: /anjali subramanian/i });
    expect(link.getAttribute("href")).toBe("/students/s1");
  });

  it("the placed and not-placed counts apply their filter when clicked", async () => {
    const user = userEvent.setup();
    show();

    await screen.findByText(/rahul nair/i);
    await user.click(screen.getByRole("button", { name: /1 placed/i }));

    // The placed filter leaves only Anjali on the table.
    expect(screen.queryByText(/rahul nair/i)).toBeNull();
    expect(screen.getByRole("link", { name: /anjali subramanian/i })).toBeDefined();

    await user.click(screen.getByRole("button", { name: /1 not placed/i }));
    expect(screen.getByText(/rahul nair/i)).toBeDefined();
    expect(screen.queryByRole("link", { name: /anjali subramanian/i })).toBeNull();
  });
});

/**
 * 2026-08-26: the placement overview's cards each open this page, already
 * filtered to the population the card counted. Every one of those parameters
 * has to arrive, apply, and be reversible - a filter the reader cannot see or
 * undo is a screen that appears to have lost half its students.
 */
describe("arriving from the placement overview", () => {
  /** Holds an on-campus record AND a self-placed offer. */
  const BOTH: DirectoryStudent = {
    ...PLACED,
    studentId: "s4",
    fullName: "Divya Ramesh",
    campusName: "Alliance University",
    hasSelfPlacement: true,
  };

  const EVERYONE = [PLACED, UNPLACED, SELF_PLACED, BOTH];

  it("shows only on-campus placements for filter=on_campus", async () => {
    show(EVERYONE, "/central/students?filter=on_campus");
    await screen.findByText("Anjali Subramanian");

    expect(screen.getByText("Divya Ramesh")).toBeDefined();
    expect(screen.queryByText("Thanush Krishna")).toBeNull();
    expect(screen.queryByText("Rahul Nair")).toBeNull();
  });

  /** The card counts every self-placed offer, including a doubly-placed student's. */
  it("shows every self-placed student for filter=self_placed", async () => {
    show(EVERYONE, "/central/students?filter=self_placed");
    await screen.findByText("Thanush Krishna");

    expect(screen.getByText("Divya Ramesh")).toBeDefined();
    expect(screen.queryByText("Anjali Subramanian")).toBeNull();
  });

  it.each([
    ["submitted", "Rahul Nair"],
    ["verified", "Anjali Subramanian"],
  ])("filters to the %s funnel row", async (filter, expected) => {
    show(EVERYONE, `/central/students?filter=${filter}`);
    expect(await screen.findByText(expected)).toBeDefined();
  });

  it("shows the arriving filter as the selected one", async () => {
    show(EVERYONE, "/central/students?filter=on_campus");
    await screen.findByText("Anjali Subramanian");

    expect(
      (screen.getByRole("radio", { name: /placed on campus/i }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("narrows to one campus and says which", async () => {
    show(EVERYONE, "/central/students?campus=Alliance+University");
    await screen.findByText("Divya Ramesh");

    expect(screen.queryByText("Anjali Subramanian")).toBeNull();
    expect((screen.getByLabelText("Campus") as HTMLSelectElement).value).toBe(
      "Alliance University",
    );
  });

  it("lets the reader change or clear the campus", async () => {
    const user = userEvent.setup();
    show(EVERYONE, "/central/students?campus=Alliance+University");
    await screen.findByText("Divya Ramesh");

    await user.selectOptions(screen.getByLabelText("Campus"), "");

    expect(screen.getByText("Anjali Subramanian")).toBeDefined();
  });

  it("narrows to one package figure", async () => {
    show(EVERYONE, "/central/students?filter=placed&ctc=6.5");
    await screen.findByText("Anjali Subramanian");

    expect(screen.queryByText("Thanush Krishna")).toBeNull();
  });

  it("narrows to one offer category", async () => {
    show(EVERYONE, "/central/students?filter=placed&category=regular");
    await screen.findByText("Thanush Krishna");

    expect(screen.queryByText("Anjali Subramanian")).toBeNull();
  });

  /**
   * 2026-08-27: `internship` became a storable offer category, so it became a
   * spellable URL. A placement record is never an internship (R9), so the
   * filter would draw a chip that can match nobody — a list that looks broken
   * rather than empty. Only the ladder is drillable here.
   */
  it("ignores a category that no placement can ever carry", async () => {
    show(EVERYONE, "/central/students?filter=placed&category=internship");
    await screen.findByText("Thanush Krishna");

    // Nothing was filtered out, and no drill-down chip was drawn.
    expect(screen.getByText("Anjali Subramanian")).toBeDefined();
    expect(screen.queryByRole("button", { name: /clear the category filter/i })).toBeNull();
  });

  /**
   * A drill-down the reader cannot see is a list that looks wrong. Both of
   * these say what they are and clear themselves when pressed.
   */
  it("shows the package drill-down as a control that clears itself", async () => {
    const user = userEvent.setup();
    show(EVERYONE, "/central/students?filter=placed&ctc=6.5");
    await screen.findByText("Anjali Subramanian");

    await user.click(screen.getByRole("button", { name: /clear.*6\.5/i }));

    expect(screen.getByText("Thanush Krishna")).toBeDefined();
  });

  it("shows the category drill-down as a control that clears itself", async () => {
    const user = userEvent.setup();
    show(EVERYONE, "/central/students?filter=placed&category=regular");
    await screen.findByText("Thanush Krishna");

    await user.click(screen.getByRole("button", { name: /clear.*regular/i }));

    expect(screen.getByText("Anjali Subramanian")).toBeDefined();
  });

  /** Changing the filter must not silently drop the campus the reader is in. */
  it("keeps the campus when the filter changes", async () => {
    const user = userEvent.setup();
    show(EVERYONE, "/central/students?filter=on_campus&campus=Alliance+University");
    await screen.findByText("Divya Ramesh");

    await user.click(screen.getByRole("radio", { name: "All students" }));

    expect(screen.getByText("Divya Ramesh")).toBeDefined();
    expect(screen.queryByText("Anjali Subramanian")).toBeNull();
  });

  it("ignores a filter it does not recognise rather than showing nothing", async () => {
    show(EVERYONE, "/central/students?filter=nonsense");
    expect(await screen.findByText("Anjali Subramanian")).toBeDefined();
    expect(screen.getByText("Rahul Nair")).toBeDefined();
  });

  it("ignores a package figure that is not a number", async () => {
    show(EVERYONE, "/central/students?ctc=abc");
    expect(await screen.findByText("Anjali Subramanian")).toBeDefined();
  });

  /**
   * 2026-10-29: the roster's participation status is already shown on every
   * row, but the chip is the way a manager reaches the held students without
   * scrolling. The domain supports it; the chip was simply missing.
   */
  const HELD: DirectoryStudent = {
    ...UNPLACED,
    studentId: "s5",
    fullName: "Meera Iyer",
    rollNumber: "21CSE1200",
    participationStatus: "on_hold",
  };

  it("filters to the held student for filter=on_hold", async () => {
    show([...EVERYONE, HELD], "/central/students?filter=on_hold");
    await screen.findByText("Meera Iyer");

    expect(screen.queryByText("Anjali Subramanian")).toBeNull();
    expect(screen.queryByText("Rahul Nair")).toBeNull();
    expect(screen.queryByText("Thanush Krishna")).toBeNull();
  });

  it("shows the arriving on-hold filter as the selected chip", async () => {
    show([...EVERYONE, HELD], "/central/students?filter=on_hold");
    await screen.findByText("Meera Iyer");

    expect((screen.getByRole("radio", { name: /on hold/i }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  /**
   * 2026-10-29: "idle — like students not even tried to apply" (the `idle`
   * hold kind, 0130). The chip is how a manager finds them to place one.
   */
  const IDLE: DirectoryStudent = {
    ...UNPLACED,
    studentId: "s6",
    fullName: "Farhan Ali",
    rollNumber: "21CSE1300",
    applications: 0,
  };

  it("filters to the student who never applied for filter=never_applied", async () => {
    show([...EVERYONE, HELD, IDLE], "/central/students?filter=never_applied");
    await screen.findByText("Farhan Ali");

    expect(screen.queryByText("Rahul Nair")).toBeNull();
    expect(screen.queryByText("Meera Iyer")).toBeNull();
    expect(screen.queryByText("Anjali Subramanian")).toBeNull();
  });

  it("shows the arriving never-applied filter as the selected chip", async () => {
    show([...EVERYONE, HELD, IDLE], "/central/students?filter=never_applied");
    await screen.findByText("Farhan Ali");

    expect(
      (screen.getByRole("radio", { name: /never applied/i }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});

/**
 * 2026-10-29: the one write this roster offers, and the only role the route
 * hands it to (0125). These are the near side of that gate — the database
 * refuses every other role regardless, and src/db/hold-gate.test.ts proves it.
 */
const holdsView = (overrides: Partial<HoldsView> = {}): HoldsView => ({
  live: async () => null,
  pendingFor: async () => null,
  pendingIds: async () => [],
  history: async () => [],
  place: async () => "hold-1",
  confirm: async () => {},
  release: async () => {},
  extend: async () => {},
  orderUrl: async () => null,
  evidenceUrl: async () => null,
  ...overrides,
});

const showHolds = (students: readonly DirectoryStudent[], holds: HoldsView) =>
  render(
    <MemoryRouter initialEntries={["/central/students"]}>
      <StudentDirectoryPage view={view(students)} holds={holds} download={vi.fn()} />
    </MemoryRouter>,
  );

describe("StudentDirectoryPage holds", () => {
  it("draws no way to hold for a role the route did not hand holds to", async () => {
    show();
    await screen.findByText("Rahul Nair");

    expect(screen.queryByRole("columnheader", { name: /actions/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /hold/i })).toBeNull();
  });

  it("names the student each row's hold will land on", async () => {
    showHolds([PLACED, UNPLACED], holdsView());
    await screen.findByRole("button", { name: "Hold Rahul Nair" });

    expect(screen.getByRole("button", { name: "Hold Anjali Subramanian" })).toBeDefined();
  });

  /**
   * The row's own "On hold" is the proof, and it has to come from the roster,
   * not from the click that was hoped for — so a successful place re-reads.
   */
  it("places the hold, says who is held, and re-reads the roster to prove it", async () => {
    const user = userEvent.setup();
    const place = vi.fn(async () => "hold-1");
    let reads = 0;

    render(
      <MemoryRouter initialEntries={["/central/students"]}>
        <StudentDirectoryPage
          view={{
            students: async () => {
              reads += 1;
              return reads === 1 ? [UNPLACED] : [{ ...UNPLACED, participationStatus: "on_hold" }];
            },
          }}
          holds={holdsView({ place })}
          download={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Hold Rahul Nair" }));
    // The page's own filter chips are radios too, so the dialog is scoped.
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /^Fees/ }));
    await user.type(
      within(dialog).getByRole("textbox", { name: /reason/i }),
      "Two semesters of fees unpaid.",
    );
    // 0130 made the review date mandatory, so the dialog will not send without one.
    fireEvent.change(within(dialog).getByLabelText(/review by/i), {
      target: { value: "2026-12-15" },
    });
    await user.click(within(dialog).getByRole("button", { name: /place hold/i }));

    expect(await screen.findByText(/is on hold/)).toBeDefined();
    expect(place).toHaveBeenCalledWith({
      studentId: "s2",
      kind: "fees",
      reason: "Two semesters of fees unpaid.",
      startsAt: expect.any(String),
      endsAt: "2026-12-15",
      order: null,
    });

    const row = await screen.findByRole("row", { name: /rahul nair/i });
    expect(within(row).getByText("On hold")).toBeDefined();
    expect(within(row).queryByRole("button", { name: /hold/i })).toBeNull();
  });

  it("does not offer a second hold to a student already held", async () => {
    showHolds([{ ...UNPLACED, participationStatus: "on_hold" }], holdsView());

    const row = await screen.findByRole("row", { name: /rahul nair/i });
    expect(within(row).getByText("On hold")).toBeDefined();
    expect(within(row).queryByRole("button", { name: /hold/i })).toBeNull();
  });

  /** Nothing is sent while the draft is wrong, so no half-placed hold exists. */
  it("refuses a hold with neither a kind nor a reason before asking the database", async () => {
    const user = userEvent.setup();
    const place = vi.fn(async () => "hold-1");
    showHolds([UNPLACED], holdsView({ place }));

    await user.click(await screen.findByRole("button", { name: "Hold Rahul Nair" }));
    await user.click(screen.getByRole("button", { name: /place hold/i }));

    expect(place).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Choose what the hold is for/);
  });

  /** 0125's raised sentence is the manager's only explanation, so it is shown. */
  it("shows the database's refusal inside the dialog instead of losing it", async () => {
    const user = userEvent.setup();
    showHolds(
      [UNPLACED],
      holdsView({
        place: async () => {
          throw new Error("Only a Campus Manager may place a placement hold.");
        },
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Hold Rahul Nair" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /^Self-placed/ }));
    await user.type(
      within(dialog).getByRole("textbox", { name: /reason/i }),
      "Offer already in hand.",
    );
    fireEvent.change(within(dialog).getByLabelText(/review by/i), {
      target: { value: "2026-12-15" },
    });
    await user.click(within(dialog).getByRole("button", { name: /place hold/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Only a Campus Manager/);
    expect(screen.queryByText(/is on hold/)).toBeNull();
  });

  /**
   * 0130: the student's request closes nothing until a manager confirms it, so
   * the directory says who is waiting rather than hoping the right record gets
   * opened — and the row offers no second Hold button the database would
   * refuse.
   */
  it("says a self-placed request is waiting, and links to the student who filed it", async () => {
    showHolds([PLACED, UNPLACED], holdsView({ pendingIds: async () => ["s2"] }));
    await screen.findByText(/1 self-placed request is waiting on you/);

    const door = screen.getByRole("link", { name: "Open the request from Rahul Nair" });
    expect(door.getAttribute("href")).toBe("/students/s2");

    const row = await screen.findByRole("row", { name: /rahul nair/i });
    expect(within(row).getByText("Request waiting")).toBeDefined();
    expect(within(row).queryByRole("button", { name: /hold/i })).toBeNull();

    // The student nobody asked about still offers the action.
    expect(screen.getByRole("button", { name: "Hold Anjali Subramanian" })).toBeDefined();
  });

  it("draws no queue when nothing is waiting", async () => {
    showHolds([PLACED, UNPLACED], holdsView());
    await screen.findByRole("button", { name: "Hold Rahul Nair" });

    expect(screen.queryByText(/waiting on you/i)).toBeNull();
  });

  /** A queue read that fails is not an empty queue, and not a silent one. */
  it("says when the waiting requests could not be read", async () => {
    showHolds(
      [PLACED, UNPLACED],
      holdsView({
        pendingIds: async () => {
          throw new Error("Could not read the requests waiting on you.");
        },
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Could not read the requests waiting on you/,
    );
    // The roster itself is untouched.
    expect(screen.getByRole("button", { name: "Hold Rahul Nair" })).toBeDefined();
  });
});
