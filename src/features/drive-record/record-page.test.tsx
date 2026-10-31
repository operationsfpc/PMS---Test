// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { DriveRecordPage } from "./record-page";
import type { DriveRecord, DriveRecordView } from "./record-view";

/**
 * N1 — the canonical drive page. One page per drive, every role, one section
 * after another with nothing folded behind a click, and role-gated SECTIONS:
 * the recruiter's contact belongs to the AE alone, the applicant list and
 * provenance to staff, and the snapshot is the apply-time profile.
 */
const RECORD: DriveRecord = {
  id: "d1",
  companyDriveId: null,
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
  siblingRoles: [],
};

const view = (record: DriveRecord | null = RECORD): DriveRecordView => ({
  record: async () => record,
});

/** As expressions: biome reads a literal role="…" prop as an ARIA role. */
const CENTRAL = "central_placement_coordinator" as const;
const AE = "account_executive" as const;
const STUDENT = "student" as const;

describe("DriveRecordPage", () => {
  it("shows the whole record to a staff reader, every section on the page at once", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: /Accenture — Jr. Software Engineer/ }),
    ).toBeDefined();
    for (const title of [
      "Job description",
      "Eligibility as published",
      "Selection process",
      "Compensation",
      "Where and when",
      "Provenance",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeDefined();
    }
    // The tab bar used to hide five of these nine sections behind a click, and
    // the sidebar column they gated went `hidden` while the main column kept
    // its `lg:col-span-2` — a third of the page empty on those tabs.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();

    expect(screen.getByText(/Aptitude Test/)).toBeDefined();
    expect(screen.getByText(/Raised by/)).toBeDefined();
    expect(screen.getByText("≥ 7.5 CGPA")).toBeDefined();
    expect(screen.getByText("30000 + 5000")).toBeDefined();
    expect(screen.getByRole<HTMLAnchorElement>("link", { name: "Accenture-JD.pdf" }).href).toBe(
      "https://signed.example/jd.pdf",
    );
    // One Compensation section, and it does not repeat the tile above it.
    expect(screen.getAllByText("₹4–6 LPA")).toHaveLength(1);
  });

  it("hides the recruiter contact from everyone but the AE", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /accenture/i });
    expect(screen.queryByRole("heading", { name: /Recruiter contacts/ })).toBeNull();
    expect(screen.queryByText("testabcd@example.com")).toBeNull();
    unmount();

    render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={AE} driveId="d1" />
      </MemoryRouter>,
    );
    // Nothing to open: the AE's own section is on the page as soon as it loads.
    expect(await screen.findByText("testabcd@example.com")).toBeDefined();
    expect(screen.getByRole("heading", { name: /visible to you alone/i })).toBeDefined();
  });

  /**
   * A drive with no rows in `drive_target_campuses` is open to EVERY college,
   * and `Fact` hides an empty value — so the audience line simply vanished and
   * "open to all" was indistinguishable from "the targeting was lost". The other
   * four screens that show a drive already say it in words (UAT 2026-10-23).
   */
  it("says which colleges a drive reaches, and says so when it reaches all of them", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Open to: KGiSL")).toBeDefined();
    unmount();

    render(
      <MemoryRouter>
        <DriveRecordPage
          view={view({ ...RECORD, eligibility: { ...RECORD.eligibility, campuses: [] } })}
          role={CENTRAL}
          driveId="d1"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Open to every campus")).toBeDefined();
  });

  it("hides the campuses list from a student reader", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={STUDENT} driveId="d1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("≥ 7.5 CGPA")).toBeDefined();
    expect(screen.queryByText(/campuses/i)).toBeNull();
    expect(screen.queryByText("Open to: KGiSL")).toBeNull();
    unmount();

    render(
      <MemoryRouter>
        <DriveRecordPage
          view={view({ ...RECORD, eligibility: { ...RECORD.eligibility, campuses: [] } })}
          role={STUDENT}
          driveId="d1"
        />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /accenture/i });
    expect(screen.queryByText("Open to every campus")).toBeNull();
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

    expect(await screen.findByText(/central placement coordinator/i)).toBeDefined();
  });

  it("hides applicants and provenance from a student — the page is still theirs to read", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view()} role={STUDENT} driveId="d1" />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /accenture/i });
    // A student gets neither section, at all, anywhere on the page.
    expect(screen.queryByRole("heading", { name: /applicants/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /provenance/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Recruiter contacts/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Where and when" })).toBeDefined();
    // The package is stated once, on its tile — Compensation no longer repeats it.
    expect(screen.getAllByText("₹4–6 LPA")).toHaveLength(1);
    expect(screen.queryByText("Thanush Krishna")).toBeNull();
    expect(screen.queryByText(/Raised by/)).toBeNull();
    expect(screen.queryByText("testabcd@example.com")).toBeNull();
  });

  it("renders long text fields without crashing and keeps full text content", async () => {
    const longRecord: DriveRecord = {
      ...RECORD,
      locations: "Bengaluru, Chennai, Hyderabad, Coimbatore, Pune, Mumbai, Gurugram, Noida",
      eligibility: {
        ...RECORD.eligibility,
        mandatorySkills:
          "React, Next.js, TypeScript, PostgreSQL, Docker, Kubernetes, Microservices",
        degrees: [
          "B.E Computer Science",
          "B.Tech Information Technology",
          "B.Sc Artificial Intelligence",
        ],
        branches: [
          "Computer Science and Engineering",
          "Information Technology",
          "Artificial Intelligence and Data Science",
        ],
      },
      rounds: [
        {
          sequence: 1,
          name: "Online Cognitive, Verbal Ability and Technical Coding Assessment on HackerRank Platform",
        },
      ],
    };

    render(
      <MemoryRouter>
        <DriveRecordPage view={view(longRecord)} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );

    expect(
      await screen.findAllByText(
        /Bengaluru, Chennai, Hyderabad, Coimbatore, Pune, Mumbai, Gurugram, Noida/,
      ),
    ).toHaveLength(2);
    expect(
      screen.getByText(/Online Cognitive, Verbal Ability and Technical Coding Assessment/),
    ).toBeDefined();
    expect(screen.getByText(/React, Next\.js, TypeScript, PostgreSQL/)).toBeDefined();
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

/**
 * UAT 2026-08-27 — `docs/inbox/WhatsApp Image 2026-08-27 at 17.40.11.jpeg`.
 *
 * "XYZ — Jr. Software engineer" carried three badges: "Approved — not yet
 * published", "Internship", and "internship". The second is the offer
 * category, the third is the drive type printed as a raw enum value. The same
 * word, twice, one of them in the wrong case.
 */
describe("the badge row", () => {
  const withType = (driveType: string, offerCategory: DriveRecord["offerCategory"]) =>
    view({ ...RECORD, status: "approved", driveType, offerCategory });

  it("names an internship once, in the domain's words", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={withType("internship", "internship")} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );

    await screen.findByText("Approved — not yet published");
    expect(screen.getAllByText("Internship")).toHaveLength(1);
    expect(screen.queryByText("internship")).toBeNull();
  });

  it("keeps the rung, which the type never states", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={withType("placement", "super_dream")} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );

    await screen.findByText("Approved — not yet published");
    expect(screen.getByText("Super Dream")).toBeDefined();
    expect(screen.getByText("Full time")).toBeDefined();
  });

  /** "internship convertible" was never a phrase anyone chose. */
  it("never prints an underscore-stripped enum value", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage
          view={withType("internship_convertible", "dream")}
          role={CENTRAL}
          driveId="d1"
        />
      </MemoryRouter>,
    );

    await screen.findByText("Approved — not yet published");
    expect(screen.getByText("Internship → Full time")).toBeDefined();
    expect(screen.queryByText("internship convertible")).toBeNull();
  });

  it("says nothing at all about a type the drive never declared", async () => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={withType("", "regular")} role={CENTRAL} driveId="d1" />
      </MemoryRouter>,
    );

    await screen.findByText("Approved — not yet published");
    expect(screen.getByText("Regular")).toBeDefined();
    expect(screen.queryByText("Type not set")).toBeNull();
  });
});

/**
 * 2026-10-18 (UAT): the header's "+ Add another role" was offered on
 * drives nobody is hiring through any more. A new role attaches to the company
 * visit, so the visit decides — this role plus its siblings — in the same words
 * the AE's portfolio and the CPC's screens use.
 */
describe("what the visit decides about one more role", () => {
  const show = async (record: DriveRecord) => {
    render(
      <MemoryRouter>
        <DriveRecordPage view={view(record)} role={AE} driveId="d1" />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /accenture — jr\. software engineer/i });
  };

  const sibling = (status: DriveRecord["status"]): DriveRecord["siblingRoles"][number] => ({
    driveId: "d2",
    roleTitle: "Data Analyst",
    driveType: "placement",
    status,
    ctcLabel: "₹4–6 LPA",
    stipendLabel: null,
  });

  it("refuses the extra role on a closed drive and says why", async () => {
    await show({ ...RECORD, status: "completed" });

    expect(screen.queryByRole("link", { name: /add another role/i })).toBeNull();
    expect(screen.getByText(/record is closed/i)).toBeDefined();
    expect(screen.getByText(/no further roles can be raised/i)).toBeDefined();
  });

  it("still offers it while a role under the same visit is running", async () => {
    await show({ ...RECORD, status: "completed", siblingRoles: [sibling("in_rounds")] });

    expect(screen.getByRole("link", { name: /add another role/i })).toBeDefined();
    expect(screen.queryByText(/no further roles can be raised/i)).toBeNull();
  });

  it("refuses it when every role of the visit is closed", async () => {
    await show({ ...RECORD, status: "completed", siblingRoles: [sibling("completed")] });

    expect(screen.queryByRole("link", { name: /add another role/i })).toBeNull();
    expect(screen.getByText(/no further roles can be raised/i)).toBeDefined();
  });

  it("offers it on a visit that is merely not published yet", async () => {
    // §3.5: the roles are assembled BEFORE go live, so "draft" is not a reason
    // to refuse one more of them.
    await show({ ...RECORD, status: "draft" });

    expect(screen.getByRole("link", { name: /add another role/i })).toBeDefined();
  });
});
