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

    await user.click(screen.getByRole("radio", { name: /^placed/i }));

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

    await user.click(screen.getByRole("radio", { name: /^placed/i }));

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
