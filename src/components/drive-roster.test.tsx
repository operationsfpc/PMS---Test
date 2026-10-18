// @vitest-environment jsdom

import type { AttendanceStatus, RoundResult } from "@domain/types";
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
      offerCategory: "dream",
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
    /*
     * 2026-10-18 (UAT): "the same data again when I open it". The collapsed
     * row already names the college, the programme and the CGPA, so the drawer
     * holds only what the row cannot say — each of those once, on the screen.
     */
    expect(screen.getAllByText(/Computer Science/i)).toHaveLength(1);
    expect(screen.getAllByText(/8\.85 CGPA/i)).toHaveLength(1);
    expect(screen.queryByText(/^College$/)).toBeNull();
    expect(screen.queryByText(/Degree & Branch/i)).toBeNull();
    expect(screen.queryByText(/Overall CGPA/i)).toBeNull();

    await user.click(priya);
    expect(screen.queryByText("Aptitude Assessment")).toBeNull();
  });

  it("takes the expanded row to that student's own record", async () => {
    const user = userEvent.setup();
    list({ students: SAMPLE_STUDENTS });

    await user.click(screen.getByRole("button", { name: /Priya Ramesh/i }));

    const link = screen.getByRole("link", { name: /^view priya ramesh$/i });
    expect(link.getAttribute("href")).toBe("/students/s-1");
    expect(link.textContent).toBe("View");
  });

  it("offers no record link for a row whose student could not be read", async () => {
    const user = userEvent.setup();
    const [priya] = SAMPLE_STUDENTS;
    if (priya === undefined) throw new Error("fixture missing");

    list({ students: [{ ...priya, studentId: undefined }] });
    await user.click(screen.getByRole("button", { name: /Priya Ramesh/i }));

    expect(screen.getByText(/Aptitude Assessment/i)).toBeDefined();
    expect(screen.queryByRole("link", { name: /^view /i })).toBeNull();
  });
});

/**
 * 2026-10-18: this roster printed the database's own words — `on_hold`,
 * `scheduled`, `super_dream` — because nothing between the row and the screen
 * translated them, and a CSS `capitalize` was asked to spell a domain value.
 * A coordinator reading their own students should never have to know the schema.
 */
describe("the words a roster may put on screen", () => {
  const show = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

  const withRound = (
    attendance: AttendanceStatus,
    result: RoundResult | null,
    offerCategory: string | null = null,
  ): DriveProgressStudentItem[] => [
    {
      applicationId: "app-9",
      studentId: "s-9",
      studentName: "Kanishka Devan",
      rollNumber: "22CSE077",
      campusId: "c-1",
      campusName: "KGiSL Institute",
      cgpa: 7.4,
      shortlisted: true,
      rounds: [{ roundId: "r-1", sequence: 1, name: "Technical Interview", attendance, result }],
      offer:
        offerCategory === null
          ? null
          : { ctcLpa: 12, stipendMonthly: null, driveType: "placement", offerCategory },
    },
  ];

  const expand = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /Kanishka Devan/i }));
  };

  it("spells a round's result instead of showing its column value", async () => {
    const user = userEvent.setup();
    show(<DriveRoster students={withRound("present", "on_hold")} />);
    await expand(user);

    expect(screen.getByText("Result: On hold")).toBeDefined();
    expect(screen.queryByText(/on_hold/i)).toBeNull();
  });

  it("says a result was never recorded, rather than naming a status that is absent", async () => {
    const user = userEvent.setup();
    show(<DriveRoster students={withRound("present", null)} />);
    await expand(user);

    expect(screen.getByText("Result not recorded")).toBeDefined();
  });

  it("says nobody has marked the attendance yet, which is what `scheduled` means", async () => {
    const user = userEvent.setup();
    show(<DriveRoster students={withRound("scheduled", null)} />);
    await expand(user);

    expect(screen.getByText("Not marked yet")).toBeDefined();
    expect(screen.queryByText(/^scheduled$/i)).toBeNull();
  });

  it("keeps the closed badge on the round's own words, not the raw enum", () => {
    show(<DriveRoster students={withRound("scheduled", null)} />);

    expect(screen.getByText(/Round 1 · Not marked yet/i)).toBeDefined();
  });

  it("capitalises a category the ladder holds, and leaves one it does not", async () => {
    const user = userEvent.setup();
    show(<DriveRoster students={withRound("present", "selected", "super_dream")} />);
    await expand(user);

    expect(screen.getByText("Super Dream")).toBeDefined();
    expect(screen.queryByText(/super_dream/)).toBeNull();
  });

  it("calls an unclassified offer unclassified, not a category it never was", async () => {
    const user = userEvent.setup();
    // An offer the CPC declared without ever picking a category.
    const unclassified = withRound("present", "selected", "regular").map((student) =>
      student.offer === null
        ? student
        : { ...student, offer: { ...student.offer, offerCategory: null } },
    );
    show(<DriveRoster students={unclassified} />);
    await expand(user);

    expect(screen.getByText("Not classified")).toBeDefined();
    expect(screen.queryByText("Standard")).toBeNull();
  });
});
