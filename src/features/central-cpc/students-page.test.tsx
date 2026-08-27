// @vitest-environment jsdom
import type { DirectoryStudent } from "@domain/student-directory";
import { render, screen, within } from "@testing-library/react";
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
  srfStatus: "srf_submitted",
  participationStatus: "active",
  applications: 1,
  hasSelfPlacement: false,
  placement: null,
};

const view = (
  students: readonly DirectoryStudent[] = [PLACED, UNPLACED],
): StudentDirectoryView => ({
  students: async () => students,
});

const show = (
  students: readonly DirectoryStudent[] = [PLACED, UNPLACED],
  path = "/central/students",
  download = vi.fn(),
) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <StudentDirectoryPage view={view(students)} download={download} />
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

  it("tells the reader how many students it is showing", async () => {
    show();
    expect(await screen.findByText(/2 students/i)).toBeDefined();
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
});
