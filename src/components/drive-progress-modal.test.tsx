// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DriveProgressModal, type DriveProgressStudentItem } from "./drive-progress-modal";

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

describe("DriveProgressModal", () => {
  /** Expanding a row links to the student's own record, so the modal needs a router. */
  const show = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it("does not render when isOpen is false", () => {
    show(
      <DriveProgressModal
        isOpen={false}
        onClose={vi.fn()}
        driveName="Zoho — Software Engineer"
        students={SAMPLE_STUDENTS}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders when open with drive name, student list, and count", () => {
    show(
      <DriveProgressModal
        isOpen={true}
        onClose={vi.fn()}
        driveName="Zoho — Software Engineer"
        students={SAMPLE_STUDENTS}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(screen.getByText(/Zoho — Software Engineer/i)).toBeDefined();
    expect(screen.getByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByText("Arjun Menon")).toBeDefined();
    expect(screen.getByText("Sneha Nair")).toBeDefined();
  });

  it("filters students by search input (name or roll number)", async () => {
    const user = userEvent.setup();
    show(
      <DriveProgressModal
        isOpen={true}
        onClose={vi.fn()}
        driveName="Zoho — Software Engineer"
        students={SAMPLE_STUDENTS}
      />,
    );

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

  it("filters students by stage buttons (offers, in rounds, shortlisted)", async () => {
    const user = userEvent.setup();
    show(
      <DriveProgressModal
        isOpen={true}
        onClose={vi.fn()}
        driveName="Zoho — Software Engineer"
        students={SAMPLE_STUDENTS}
      />,
    );

    // Click offers button
    const offersBtn = screen.getByRole("button", { name: /offers/i });
    await user.click(offersBtn);

    expect(screen.getByText("Priya Ramesh")).toBeDefined();
    expect(screen.queryByText("Arjun Menon")).toBeNull();
    expect(screen.queryByText("Sneha Nair")).toBeNull();

    // Click in rounds button
    const inRoundsBtn = screen.getByRole("button", { name: /in rounds/i });
    await user.click(inRoundsBtn);

    expect(screen.getByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByText("Arjun Menon")).toBeDefined();
    expect(screen.queryByText("Sneha Nair")).toBeNull();
  });

  it("expands a student to show placement details when clicked", async () => {
    const user = userEvent.setup();
    show(
      <DriveProgressModal
        isOpen={true}
        onClose={vi.fn()}
        driveName="Zoho — Software Engineer"
        students={SAMPLE_STUDENTS}
      />,
    );

    // Initially placement details are not visible
    expect(screen.queryByText(/Aptitude Assessment/i)).toBeNull();
    expect(screen.queryByText(/Placement Offer Details/i)).toBeNull();

    // Click Priya Ramesh to expand
    const studentBtn = screen.getByRole("button", { name: /Priya Ramesh/i });
    await user.click(studentBtn);

    // Placement details are now visible
    expect(screen.getByText(/Aptitude Assessment/i)).toBeDefined();
    expect(screen.getByText(/Technical Interview/i)).toBeDefined();
    expect(screen.getByText(/Placement Offer Details/i)).toBeDefined();
    expect(screen.getByText(/Dream/i)).toBeDefined();
    expect(screen.getAllByText(/Computer Science/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/8.85 CGPA/i).length).toBeGreaterThanOrEqual(1);

    // Click again to collapse
    await user.click(studentBtn);
    expect(screen.queryByText("Aptitude Assessment")).toBeNull();
  });

  it("takes the expanded row to that student's own record", async () => {
    const user = userEvent.setup();
    show(
      <DriveProgressModal
        isOpen={true}
        onClose={vi.fn()}
        driveName="Zoho — Software Engineer"
        students={SAMPLE_STUDENTS}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Priya Ramesh/i }));

    const link = screen.getByRole("link", { name: /open the student record/i });
    expect(link.getAttribute("href")).toBe("/students/s-1");
  });

  it("offers no record link for a row whose student could not be read", async () => {
    const user = userEvent.setup();
    const [priya] = SAMPLE_STUDENTS;
    if (priya === undefined) throw new Error("fixture missing");

    show(
      <DriveProgressModal
        isOpen={true}
        onClose={vi.fn()}
        driveName="Zoho — Software Engineer"
        students={[{ ...priya, studentId: undefined }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Priya Ramesh/i }));

    expect(screen.getByText(/Aptitude Assessment/i)).toBeDefined();
    expect(screen.queryByRole("link", { name: /open the student record/i })).toBeNull();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    show(
      <DriveProgressModal
        isOpen={true}
        onClose={handleClose}
        driveName="Zoho — Software Engineer"
        students={SAMPLE_STUDENTS}
      />,
    );

    const closeBtn = screen.getAllByRole("button", { name: /close/i })[0];
    if (!closeBtn) throw new Error("Close button not found");
    await user.click(closeBtn);

    expect(handleClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape key is pressed", () => {
    const handleClose = vi.fn();
    show(
      <DriveProgressModal
        isOpen={true}
        onClose={handleClose}
        driveName="Zoho — Software Engineer"
        students={SAMPLE_STUDENTS}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledOnce();
  });
});
