// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DriveRecordPage } from "./record-page";
import type { DriveRecord, DriveRecordView } from "./record-view";

/**
 * N1 — the canonical drive page. One page per drive, every role, role-gated
 * SECTIONS: the recruiter's contact belongs to the AE alone, the applicant
 * list and provenance to staff, and the snapshot is the apply-time profile.
 */
const RECORD: DriveRecord = {
  id: "d1",
  companyName: "Accenture",
  industry: "Technology",
  companyWebsite: "https://accenture.com",
  roleTitle: "Jr. Software Engineer",
  additionalDesignations: ["Support Analyst"],
  roleCategory: "technical_support_it_ops",
  status: "live",
  driveType: "internship_convertible",
  driveMode: "on_campus",
  offerCategory: "dream",
  openings: 10,
  ctcLabel: "₹4–6 LPA",
  ctcBreakup: "30000 + 5000",
  bondDetails: "2 years",
  locations: "Bengaluru, Chennai, Hyderabad",
  applicationStart: "2026-08-11T10:17:00Z",
  applicationEnd: "2026-08-12T10:18:00Z",
  tentativeDate: "2026-08-15",
  shift: "Day",
  joining: "Later — September",
  jobDescription: "IT Coding",
  jobDescriptionUrl: "https://signed.example/jd.pdf",
  jobDescriptionName: "Accenture-JD.pdf",
  eligibility: {
    cgpaLabel: "≥ 7.5 CGPA",
    tenthLabel: "≥ 70%",
    twelfthLabel: "≥ 70%",
    arrearsLabel: "Flexible on arrears",
    passingYears: [2026, 2027],
    mandatorySkills: "Coding",
    degrees: ["B.E"],
    branches: ["CSE"],
    campuses: ["KGiSL"],
  },
  rounds: [
    { sequence: 1, name: "Aptitude Test" },
    { sequence: 2, name: "Technical Interview" },
  ],
  recruiter: {
    name: "TESTABCD",
    designation: "Recruitment Head",
    email: "testabcd@example.com",
    phone: "9876543218",
  },
  provenance: {
    raisedBy: "AE Test",
    raisedAt: "2026-08-11T10:16:00Z",
    approvedBy: "DH Test",
    approvedAt: "2026-08-11T10:18:00Z",
    publishedBy: "Radhika",
    publishedAt: "2026-08-11T10:18:16Z",
  },
  applicants: [
    {
      applicationId: "a1",
      fullName: "Thanush Krishna",
      rollNumber: "21CSE1042",
      campus: "KGiSL",
      appliedAt: "2026-08-12T09:00:00Z",
      snapshot: { academics: { overallCgpa: 7.5, tenthPercentage: 88, degree: "B.E" } },
    },
  ],
};

const view = (record: DriveRecord | null = RECORD): DriveRecordView => ({
  record: async () => record,
});

/** As expressions: biome reads a literal role="…" prop as an ARIA role. */
const CENTRAL = "central_placement_coordinator" as const;
const AE = "account_executive" as const;
const STUDENT = "student" as const;

describe("DriveRecordPage", () => {
  it("shows the whole record to a staff reader — compensation, window, eligibility, rounds", async () => {
    render(<DriveRecordPage view={view()} role={CENTRAL} driveId="d1" />);

    expect(
      await screen.findByRole("heading", { name: /Accenture — Jr. Software Engineer/ }),
    ).toBeDefined();
    expect(screen.getByText("₹4–6 LPA")).toBeDefined();
    expect(screen.getByText("≥ 7.5 CGPA")).toBeDefined();
    expect(screen.getByText(/Aptitude Test/)).toBeDefined();
    expect(screen.getByText(/Raised by/)).toBeDefined();
    expect(screen.getByRole<HTMLAnchorElement>("link", { name: "Accenture-JD.pdf" }).href).toBe(
      "https://signed.example/jd.pdf",
    );
  });

  it("hides the recruiter contact from everyone but the AE", async () => {
    const { unmount } = render(<DriveRecordPage view={view()} role={CENTRAL} driveId="d1" />);
    await screen.findByText("₹4–6 LPA");
    expect(screen.queryByText("testabcd@example.com")).toBeNull();
    unmount();

    render(<DriveRecordPage view={view()} role={AE} driveId="d1" />);
    expect(await screen.findByText("testabcd@example.com")).toBeDefined();
    expect(screen.getByText(/visible to you alone/i)).toBeDefined();
  });

  it("hides applicants and provenance from a student — the page is still theirs to read", async () => {
    render(<DriveRecordPage view={view()} role={STUDENT} driveId="d1" />);

    expect(await screen.findByText("₹4–6 LPA")).toBeDefined();
    expect(screen.queryByText("Thanush Krishna")).toBeNull();
    expect(screen.queryByText(/Raised by/)).toBeNull();
    expect(screen.queryByText("testabcd@example.com")).toBeNull();
  });

  it("opens the APPLY-TIME snapshot, saying that is what it is", async () => {
    const user = userEvent.setup();
    render(<DriveRecordPage view={view()} role={CENTRAL} driveId="d1" />);
    await screen.findByText("Thanush Krishna");

    await user.click(screen.getByRole("button", { name: "View snapshot" }));

    const region = screen.getByRole("region", { name: "Snapshot of Thanush Krishna" });
    expect(within(region).getByText(/AT APPLY TIME/)).toBeDefined();
    expect(within(region).getByText("7.5")).toBeDefined();
  });

  it("says so when the drive cannot be seen", async () => {
    render(<DriveRecordPage view={view(null)} role={STUDENT} driveId="dX" />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("does not exist"),
    );
  });
});
