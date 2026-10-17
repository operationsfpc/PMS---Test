// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { type DriveProgressStudentItem, DriveRoster } from "./drive-roster";

const SAMPLE_STUDENTS: DriveProgressStudentItem[] = [
  {
    applicationId: "app-1",
    studentId: "s-1",
    studentName: "Priya Ramesh",
    rollNumber: "21CSE101",
    campusId: "c-1",
    campusName: "KGiSL Institute",
    degree: "B.Tech",
    branch: "Computer Science",
    cgpa: 8.85,
    shortlisted: true,
    rounds: [
      {
        roundId: "r-1",
        sequence: 1,
        name: "Aptitude Assessment",
        attendance: "present",
        result: "selected",
      },
      {
        roundId: "r-2",
        sequence: 2,
        name: "Technical Interview",
        attendance: "present",
        result: "selected",
      },
    ],
    offer: {
      ctcLpa: 8.5,
      stipendMonthly: 25000,
      driveType: "placement",
      offerCategory: "Dream",
    },
  },
  {
    applicationId: "app-2",
    studentId: "s-2",
    studentName: "Arjun Menon",
    rollNumber: "21IT205",
    campusId: "c-1",
    campusName: "KGiSL Institute",
    degree: "B.Tech",
    branch: "Information Technology",
    cgpa: 7.9,
    shortlisted: true,
    rounds: [
      {
        roundId: "r-1",
        sequence: 1,
        name: "Aptitude Assessment",
        attendance: "present",
        result: "selected",
      },
      {
        roundId: "r-2",
        sequence: 2,
        name: "Technical Interview",
        attendance: "scheduled",
        result: null,
      },
    ],
    offer: null,
  },
  {
    applicationId: "app-3",
    studentId: "s-3",
    studentName: "Sneha Nair",
    rollNumber: "21ECE302",
    campusId: "c-2",
    campusName: "VIT Bangalore",
    degree: "B.E",
    branch: "Electronics",
    cgpa: 7.2,
    shortlisted: false,
    rounds: [],
    offer: null,
  },
];

describe("the one-role roster", () => {
  /** Expanding a row links to the student's own record, so it needs a router. */
  const show = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
  const list = (props: { students: readonly DriveProgressStudentItem[]; collegeFilter?: string }) =>
    show(
      <DriveRoster
        students={props.students}
        {...(props.collegeFilter === undefined ? {} : { collegeFilter: props.collegeFilter })}
      />,
    );

  it("names every student on the role, and says how many", () => {
    list({ students: SAMPLE_STUDENTS });

    expect(screen.getByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByText("Arjun Menon")).toBeDefined();
    expect(screen.getByText("Sneha Nair")).toBeDefined();
    expect(screen.getByText(/Showing 3 of 3 students/i)).toBeDefined();
  });

  it("keeps only the students of the college it was scoped to", () => {
    list({ students: SAMPLE_STUDENTS, collegeFilter: "VIT Bangalore" });

    expect(screen.getByText("Sneha Nair")).toBeDefined();
    expect(screen.queryByText("Priya Ramesh")).toBeNull();
    expect(screen.getByText(/Filtered to VIT Bangalore/i)).toBeDefined();
  });

  it("narrows to the student being looked for, by name or by roll number", async () => {
    const user = userEvent.setup();
    list({ students: SAMPLE_STUDENTS });

    const searchInput = screen.getByPlaceholderText(/search student/i);
    await user.type(searchInput, "Arjun");

    expect(screen.getByText("Arjun Menon")).toBeDefined();
    expect(screen.queryByText("Priya Ramesh")).toBeNull();
    expect(screen.queryByText("Sneha Nair")).toBeNull();

    await user.clear(searchInput);
    await user.type(searchInput, "21ECE");

    expect(screen.getByText("Sneha Nair")).toBeDefined();
    expect(screen.queryByText("Arjun Menon")).toBeNull();
  });

  it("lists the stage the coordinator asks about, not the whole cycle", async () => {
    const user = userEvent.setup();
    list({ students: SAMPLE_STUDENTS });

    await user.click(screen.getByRole("button", { name: /offers/i }));

    expect(screen.getByText("Priya Ramesh")).toBeDefined();
    expect(screen.queryByText("Arjun Menon")).toBeNull();
    expect(screen.queryByText("Sneha Nair")).toBeNull();

    await user.click(screen.getByRole("button", { name: /in rounds/i }));

    expect(screen.getByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByText("Arjun Menon")).toBeDefined();
    expect(screen.queryByText("Sneha Nair")).toBeNull();
  });

  it("opens a student's whole cycle when their row is expanded", async () => {
    const user = userEvent.setup();
    list({ students: SAMPLE_STUDENTS });

    expect(screen.queryByText(/Aptitude Assessment/i)).toBeNull();
    expect(screen.queryByText(/Placement Offer Details/i)).toBeNull();

    const priya = screen.getByRole("button", { name: /Priya Ramesh/i });
    await user.click(priya);

    expect(screen.getByText(/Aptitude Assessment/i)).toBeDefined();
    expect(screen.getByText(/Technical Interview/i)).toBeDefined();
    expect(screen.getByText(/Placement Offer Details/i)).toBeDefined();
    expect(screen.getByText(/Dream/i)).toBeDefined();
    expect(screen.getAllByText(/Computer Science/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/8.85 CGPA/i).length).toBeGreaterThanOrEqual(1);

    await user.click(priya);
    expect(screen.queryByText("Aptitude Assessment")).toBeNull();
  });

  it("takes the expanded row to that student's own record", async () => {
    const user = userEvent.setup();
    list({ students: SAMPLE_STUDENTS });

    await user.click(screen.getByRole("button", { name: /Priya Ramesh/i }));

    const link = screen.getByRole("link", { name: /open the student record/i });
    expect(link.getAttribute("href")).toBe("/students/s-1");
  });

  it("offers no record link for a row whose student could not be read", async () => {
    const user = userEvent.setup();
    const [priya] = SAMPLE_STUDENTS;
    if (priya === undefined) throw new Error("fixture missing");

    list({ students: [{ ...priya, studentId: undefined }] });
    await user.click(screen.getByRole("button", { name: /Priya Ramesh/i }));

    expect(screen.getByText(/Aptitude Assessment/i)).toBeDefined();
    expect(screen.queryByRole("link", { name: /open the student record/i })).toBeNull();
  });
});
