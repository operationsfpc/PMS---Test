// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
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
  venue: null,
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
  recruiters: [
    {
      name: "TESTABCD",
      designation: "Recruitment Head",
      email: "testabcd@example.com",
      phone: "9876543218",
    },
  ],
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
      studentId: "s1",
      fullName: "Thanush Krishna",
      rollNumber: "21CSE1042",
      campus: "KGiSL",
      appliedAt: "2026-08-12T09:00:00Z",
      // ⚠️ Corrected 2026-08-24: the REAL envelope nests under `profile`
      // (buildApplicationSnapshot) — the old fixture's invented flat shape let
      // fromSnapshot read one level too shallow and show "—" for real rows.
      snapshot: {
        profile: { academics: { overallCgpa: 7.5, tenthPercentage: 88, degree: "B.E" } },
        resumeId: null,
      },
      shortlisted: true,
      hasOffer: false,
      rounds: [],
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
    render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );

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
    const { unmount } = render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );
    await screen.findByText("₹4–6 LPA");
    expect(screen.queryByText("testabcd@example.com")).toBeNull();
    unmount();

    render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={AE} driveId="d1" />
      </MemoryRouter>,
    );
    expect(await screen.findByText("testabcd@example.com")).toBeDefined();
    expect(screen.getByText(/visible to you alone/i)).toBeDefined();
  });

  /** A4/A5 (UAT 2026-08-19): several contacts, or an honest "none". */
  it("lists every contact the drive carries, for the AE", async () => {
    const two = {
      ...RECORD,
      recruiters: [
        { name: "First Contact", designation: "HR", email: "one@x.com", phone: "1" },
        { name: "Second Contact", designation: "Lead", email: "two@x.com", phone: "2" },
      ],
    };
    render(
      <MemoryRouter>
        <DriveRecordPage view={view(two)} role={AE} driveId="d1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("First Contact")).toBeDefined();
    expect(screen.getByText("Second Contact")).toBeDefined();
  });

  it("says the Central CPC is the point of contact when the drive has none (A5)", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view({ ...RECORD, recruiters: [] })} role={AE} driveId="d1" />
      </MemoryRouter>,
    );

    await screen.findByText("₹4–6 LPA");
    expect(screen.getByText(/central placement coordinator/i)).toBeDefined();
  });

  it("hides applicants and provenance from a student — the page is still theirs to read", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={STUDENT} driveId="d1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("₹4–6 LPA")).toBeDefined();
    expect(screen.queryByText("Thanush Krishna")).toBeNull();
    expect(screen.queryByText(/Raised by/)).toBeNull();
    expect(screen.queryByText("testabcd@example.com")).toBeNull();
  });

  it("opens the APPLY-TIME snapshot, saying that is what it is", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );
    await screen.findByText("Thanush Krishna");

    await user.click(screen.getByRole("button", { name: "View snapshot" }));

    const region = screen.getByRole("region", { name: "Snapshot of Thanush Krishna" });
    expect(within(region).getByText(/AT APPLY TIME/)).toBeDefined();
    expect(within(region).getByText("7.5")).toBeDefined();
  });

  it("says so when the drive cannot be seen", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view(null)} role={STUDENT} driveId="dX" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("does not exist"),
    );
  });
});

/**
 * C8 (2026-08-21, answer 5b): a funnel number on the Live card links here
 * with `?stage=` — the page opens on exactly the applicants that number
 * counted, each name linking to the canonical student page.
 */
describe("the stage drill-through", () => {
  const TWO: DriveRecord = {
    ...RECORD,
    applicants: [
      ...RECORD.applicants,
      {
        applicationId: "a2",
        studentId: "s2",
        fullName: "Divya S",
        rollNumber: "21ECE1019",
        campus: "SDNB",
        appliedAt: "2026-08-12T10:00:00Z",
        snapshot: {},
        shortlisted: false,
        hasOffer: false,
        rounds: [],
      },
    ],
  };

  it("opens on the stage the link named, listing only its applicants", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view(TWO)} role={CENTRAL} driveId="d1" stage="shortlisted" />
      </MemoryRouter>,
    );

    const region = await screen.findByRole("region", { name: /stage/i });
    expect(within(region).getByText(/shortlisted \(1\)/i)).toBeDefined();
    expect(within(region).getByText("Thanush Krishna")).toBeDefined();
    expect(within(region).queryByText("Divya S")).toBeNull();
  });

  it("links each name to the canonical student page", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view(TWO)} role={CENTRAL} driveId="d1" stage="applied" />
      </MemoryRouter>,
    );

    const region = await screen.findByRole("region", { name: /stage/i });
    expect(
      within(region)
        .getByRole("link", { name: /thanush krishna/i })
        .getAttribute("href"),
    ).toBe("/students/s1");
  });

  it("offers the other stages as tabs with their counts", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view(TWO)} role={CENTRAL} driveId="d1" stage="shortlisted" />
      </MemoryRouter>,
    );

    const region = await screen.findByRole("region", { name: /stage/i });
    expect(
      within(region)
        .getByRole("link", { name: /applied \(2\)/i })
        .getAttribute("href"),
    ).toBe("/drives/d1?stage=applied");
  });

  it("shows no stage section without a stage in the URL — the page stays as it was", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view(TWO)} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /accenture/i });
    expect(screen.queryByRole("region", { name: /stage/i })).toBeNull();
  });

  it("hides the stage list from a student — the counts are staff's", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view(TWO)} role={STUDENT} driveId="d1" stage="applied" />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /accenture/i });
    expect(screen.queryByRole("region", { name: /stage/i })).toBeNull();
  });
});

describe("the stage drill-through — edges", () => {
  it("admits an empty stage rather than a silent blank", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage
          view={view({ ...RECORD, applicants: [] })}
          role={CENTRAL}
          driveId="d1"
          stage="offers"
        />
      </MemoryRouter>,
    );

    const region = await screen.findByRole("region", { name: /stage/i });
    expect(within(region).getByText(/nobody is at/i)).toBeDefined();
  });

  it("ignores a stage the URL made up", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={CENTRAL} driveId="d1" stage="hogwarts" />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /accenture/i });
    expect(screen.queryByRole("region", { name: /stage/i })).toBeNull();
  });
});
