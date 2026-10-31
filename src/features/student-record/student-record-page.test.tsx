// @vitest-environment jsdom
import type { StatusEvent } from "@domain/status-changes";
import type { AppRole } from "@domain/types";
import type { Hold, HoldsView } from "@lib/holds-view";
import type { StatusChangesView } from "@lib/status-changes-view";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  type StudentRecord,
  type StudentRecordApplication,
  StudentRecordPage,
  type StudentRecordView,
} from "./student-record-page";

/**
 * G7 (UAT 2026-08-20, Q7 answer b): the canonical student record —
 * `/students/:studentId`, N1's second canonical page. The directory's
 * numbers were dead ends; every count now opens the person behind it.
 *
 * Read-only except for the one verb 0125 gives a Campus Manager: lifting a
 * hold their college placed. Verification and editing still live elsewhere.
 */
const PRIYA: StudentRecord = {
  studentId: "s1",
  fullName: "Priya Ramesh",
  rollNumber: "21CSE1042",
  email: "priya@example.com",
  mobile: "9876543210",
  whatsapp: null,
  alternateContact: null,
  campusName: "SDNB Vaishnav College",
  degree: "B.Sc CS / CT",
  branch: "CS with AI",
  passingYear: 2027,
  srfStatus: "srf_approved",
  participationStatus: "active",
  tenthPercentage: 92.4,
  tenthInstitution: "St. Joseph's Convent",
  tenthBoard: "state_board",
  twelfthPercentage: 88,
  twelfthInstitution: "Kendriya Vidyalaya",
  twelfthBoard: "cbse",
  diplomaInstitution: null,
  diplomaMarks: null,
  overallCgpa: 8.4,
  currentArrears: 0,
  historyOfArrears: 0,
  semesters: [
    { semesterNumber: 1, cgpa: 8.2, verified: true },
    { semesterNumber: 2, cgpa: 8.6, verified: false },
  ],
  skills: [
    { skill: "Java", score: 4 },
    { skill: "SQL", score: 3 },
  ],
  rolePreferences: ["software_technical", "sales"],
  driveTypePreferences: ["placement", "internship"],
  technicalSkills: "React, Node.js, Python, PostgreSQL",
  areasOfInterest: "Full-Stack Development, Cloud Computing",
  areasOfExpertise: null,
  projects: "Hospital Management System using React and Spring Boot",
  certifications: "AWS Certified Cloud Practitioner",
  achievements: "First place in College Hackathon 2025",
  linkedinUrl: "https://linkedin.com/in/priya-ramesh",
  githubUrl: "https://github.com/priya-ramesh",
  leetcodeUrl: "https://leetcode.com/u/priya-ramesh",
  hackerrankUrl: "https://hackerrank.com/priya_ramesh",
  resumes: [
    {
      id: "res1",
      roleCategory: "software_technical",
      storagePath: "s1/profile-software_technical-resume.pdf",
      fileName: "priya_swe_resume.pdf",
      sizeBytes: 154200,
      uploadedAt: "2026-08-01T10:00:00Z",
      downloadUrl: "https://storage.test/res1.pdf",
    },
  ],
  applications: [
    {
      applicationId: "a1",
      driveId: "d1",
      companyName: "Zoho",
      roleTitle: "MTS",
      appliedAt: "2026-08-10T10:00:00Z",
      shortlisted: true,
      hasOffer: false,
    },
  ],
  offers: [],
  placement: null,
};

const view = (record: StudentRecord | null = PRIYA): StudentRecordView => ({
  record: async () => record,
});

/** As expressions: biome reads a literal role="…" prop as an ARIA role. */
const COORDINATOR = "campus_placement_coordinator" as const;
const MANAGER = "campus_manager" as const;
const DELIVERY_HEAD = "delivery_head" as const;
const ACCOUNT_EXECUTIVE = "account_executive" as const;

const show = (v: StudentRecordView = view()) =>
  render(
    <MemoryRouter>
      <StudentRecordPage studentId="s1" view={v} role={COORDINATOR} />
    </MemoryRouter>,
  );

describe("StudentRecordPage", () => {
  it("names the student, their roll number and their campus", async () => {
    show();

    expect(await screen.findByRole("heading", { name: /priya ramesh/i })).toBeDefined();
    expect(screen.getByText(/21CSE1042/)).toBeDefined();
    expect(screen.getByText(/SDNB Vaishnav College/)).toBeDefined();
    expect(screen.getByText(/B\.Sc CS \/ CT/)).toBeDefined();
  });

  it("shows the school marks and each semester with its verification state", async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("tab", { name: /academics/i }));

    const academics = await screen.findByRole("region", { name: /academics/i });
    expect(within(academics).getByText(/92\.4/)).toBeDefined();
    expect(within(academics).getByText(/88/)).toBeDefined();
    expect(within(academics).getByText(/semester 1/i)).toBeDefined();
    expect(within(academics).getByText(/8\.2/)).toBeDefined();
    expect(within(academics).getByText(/verified/i)).toBeDefined();
    expect(within(academics).getByText(/pending/i)).toBeDefined();
  });

  it("shows the skill scores out of 5, and the role preferences", async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("tab", { name: /preferences/i }));

    const skills = await screen.findByRole("region", { name: /skills/i });
    expect(within(skills).getByText(/java 4\/5/i)).toBeDefined();
    expect(within(skills).getByText(/sql 3\/5/i)).toBeDefined();
    expect(screen.getByText(/software \/ technical/i)).toBeDefined();
  });

  it("is honest when no skill scores are recorded", async () => {
    const user = userEvent.setup();
    show(view({ ...PRIYA, skills: [] }));

    await user.click(await screen.findByRole("tab", { name: /preferences/i }));

    const skills = await screen.findByRole("region", { name: /skills/i });
    expect(within(skills).getByText(/no skill scores recorded/i)).toBeDefined();
  });

  it("opens on Overview and filters the record through the section tabs", async () => {
    const user = userEvent.setup();
    show();

    const overviewTab = await screen.findByRole("tab", { name: /overview/i });
    expect(overviewTab.getAttribute("aria-selected")).toBe("true");
    expect(overviewTab.getAttribute("aria-controls")).toBe("student-record-panels");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "student-record-tab-overview",
    );
    expect(screen.getByRole("region", { name: /identity/i })).toBeDefined();

    await user.click(screen.getByRole("tab", { name: /portfolio/i }));

    expect(screen.queryByRole("region", { name: /academics/i })).toBeNull();
    expect(screen.getByRole("region", { name: /portfolio/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /portfolio/i }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "student-record-tab-portfolio",
    );
  });

  it("lists every application, each opening its drive", async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("tab", { name: /placements/i }));

    const applications = await screen.findByRole("region", { name: /applications/i });
    const link = within(applications).getByRole("link", { name: /zoho/i });
    expect(link.getAttribute("href")).toBe("/drives/d1");
    expect(within(applications).getByText(/shortlisted/i)).toBeDefined();
  });

  it("says plainly when the student has not applied anywhere", async () => {
    const user = userEvent.setup();
    show(view({ ...PRIYA, applications: [] }));

    await user.click(await screen.findByRole("tab", { name: /placements/i }));

    const applications = await screen.findByRole("region", { name: /applications/i });
    expect(within(applications).getByText(/no applications yet/i)).toBeDefined();
  });

  it("keeps two roles of one company visit in one block", async () => {
    const user = userEvent.setup();
    const role = (
      applicationId: string,
      driveId: string,
      roleTitle: string,
    ): StudentRecordApplication => ({
      applicationId,
      driveId,
      companyName: "Zoho",
      roleTitle,
      companyDriveId: "e1",
      tentativeDate: "2026-09-01",
      appliedAt: "2026-08-10T10:00:00Z",
      shortlisted: false,
      hasOffer: false,
    });
    show(
      view({
        ...PRIYA,
        applications: [role("a1", "d1", "MTS"), role("a2", "d2", "QA")],
      }),
    );

    await user.click(await screen.findByRole("tab", { name: /placements/i }));

    const applications = await screen.findByRole("region", { name: /applications/i });
    expect(within(applications).getAllByText("Zoho")).toHaveLength(1);
    expect(within(applications).getByText("2 roles")).toBeDefined();
    expect(within(applications).getByRole("link", { name: "MTS" }).getAttribute("href")).toBe(
      "/drives/d1",
    );
    expect(within(applications).getByRole("link", { name: "QA" }).getAttribute("href")).toBe(
      "/drives/d2",
    );
  });

  it("shows the placement when there is one — with its source", async () => {
    const user = userEvent.setup();
    show(
      view({
        ...PRIYA,
        placement: {
          companyName: "Freshworks",
          roleTitle: "SDE",
          ctcLpa: 6,
          offerCategory: "dream",
          source: "self_placed",
        },
      }),
    );

    await user.click(await screen.findByRole("tab", { name: /placements/i }));

    const placement = await screen.findByRole("region", { name: /placement/i });
    expect(within(placement).getByText(/freshworks/i)).toBeDefined();
    expect(within(placement).getByText(/self-placed/i)).toBeDefined();
  });

  it("says Not placed as a fact, not a blank", async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("tab", { name: /placements/i }));

    const placement = await screen.findByRole("region", { name: /placement/i });
    expect(within(placement).getByText(/not placed/i)).toBeDefined();
  });

  it("says so when the record cannot be read", async () => {
    show(view(null));

    expect(
      await screen.findByText(/this student record does not exist, or you cannot read it/i),
    ).toBeDefined();
  });

  /**
   * The view now raises rather than handing back a record quietly missing a
   * section. Unhandled, that rejection left this page on "Loading…" forever —
   * which reads as a slow database, not as a failure anyone can act on.
   */
  it("says the read failed instead of loading forever", async () => {
    show({
      record: async () => {
        throw new Error("Could not read this student's full record. Please try again.");
      },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not load this student record/i);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("link", { name: /overview/i })).toBeDefined();
  });

  /**
   * 2026-10-18 (UAT): "there is no way to go back" from a student record.
   * Press-shaped, like every other control — and honest about what it can do:
   * a record loaded cold has no in-app history to step into, so it offers the
   * reader's own overview rather than a button that would do nothing.
   */
  it("hands the reader back to the list they came from", async () => {
    render(
      <MemoryRouter initialEntries={["/central/students", "/students/s1"]} initialIndex={1}>
        <StudentRecordPage studentId="s1" view={view()} role={COORDINATOR} />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: /priya ramesh/i });

    expect(screen.getByRole("button", { name: /^back$/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /overview/i })).toBeNull();
  });

  it("opens its own overview when there is nothing behind it", async () => {
    show();
    await screen.findByRole("heading", { name: /priya ramesh/i });

    const wayOut = screen.getByRole("link", { name: /overview/i });
    expect(wayOut.getAttribute("href")).toBe("/");
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
  });

  it("does not leave the unreadable record a dead end", async () => {
    show(view(null));
    await screen.findByText(/cannot read it/i);

    expect(screen.getByRole("link", { name: /overview/i })).toBeDefined();
  });
});

/**
 * 0125's hold, on the record the college reads when a student stops appearing
 * in every drive list. A review date far enough from today that no test can
 * age into the wrong standing.
 */
const LIVE: Hold = {
  id: "h1",
  studentId: "s1",
  kind: "fees",
  reason: "Two semesters of fees unpaid.",
  startsAt: "2026-10-29",
  endsAt: "2099-01-09",
  heldAt: "2026-10-29T06:30:00Z",
  heldBy: "Karthik Subramanian",
  confirmedAt: "2026-10-29T06:30:00Z",
  releasedAt: null,
  releasedBy: null,
  releaseNote: null,
  documentPath: null,
  declarationPath: null,
};

const EARLIER: Hold = {
  ...LIVE,
  id: "h0",
  kind: "idle",
  reason: "Applied to nothing in September.",
  endsAt: "2026-09-30",
  releasedAt: "2026-09-30T10:00:00Z",
  releasedBy: "Meena Krishnan",
  releaseNote: "Cleared on request — they were mid-project.",
};

const PENDING: Hold = {
  ...LIVE,
  id: "h2",
  kind: "self_placed",
  reason: "Self-placed at Freshworks (SDE).",
  endsAt: "2099-03-01",
  heldBy: null,
  confirmedAt: null,
  documentPath: "s1/1730000000000-offer.pdf",
  declarationPath: "s1/1730000000001-declaration.jpg",
};

const holdsView = (overrides: Partial<HoldsView> = {}): HoldsView => ({
  live: async () => LIVE,
  pendingFor: async () => null,
  pendingIds: async () => [],
  history: async () => [LIVE, EARLIER],
  place: async () => "h1",
  confirm: async () => {},
  release: async () => {},
  extend: async () => {},
  orderUrl: async () => null,
  evidenceUrl: async () => null,
  ...overrides,
});

const showHold = (
  holds: HoldsView,
  release?: (holdId: string, note: string | null) => Promise<void>,
  record: StudentRecord = { ...PRIYA, participationStatus: "on_hold" },
) =>
  render(
    <MemoryRouter>
      <StudentRecordPage
        studentId="s1"
        view={view(record)}
        role={MANAGER}
        holds={holds}
        {...(release === undefined ? {} : { release })}
      />
    </MemoryRouter>,
  );

const block = () => screen.findByRole("region", { name: /placement hold/i });

describe("StudentRecordPage hold", () => {
  it("shows the live hold with its reason, window and author", async () => {
    showHold(holdsView());

    const card = await block();
    expect(within(card).getByText(/on hold — fees/i)).toBeDefined();
    expect(within(card).getByText(/two semesters of fees unpaid\./i)).toBeDefined();
    expect(within(card).getByText(/in force/i)).toBeDefined();
    expect(within(card).getByText(/from 29 Oct 2026, review by 09 Jan 2099/i)).toBeDefined();
    expect(within(card).getByText(/placed by Karthik Subramanian/i)).toBeDefined();
  });

  /** A chip above a card that both say "on hold" is the same fact twice. */
  it("does not repeat the hold in the badge once the block says it", async () => {
    showHold(holdsView());
    await block();

    expect(screen.queryByText(/^on hold$/i)).toBeNull();
  });

  it("lists the holds that came before, each with who lifted it", async () => {
    showHold(holdsView());

    const card = await block();
    expect(within(card).getByText(/earlier holds/i)).toBeDefined();
    expect(within(card).getByText(/applied to nothing in september\./i)).toBeDefined();
    expect(within(card).getByText(/released 30 Sep/i)).toBeDefined();
    expect(within(card).getByText(/by Meena Krishnan/i)).toBeDefined();
  });

  /** 0126: the student is told on screen, and 0125 keeps the order for staff. */
  it("says the order is on file when it has no working link to it", async () => {
    const withPath = { ...LIVE, documentPath: "s1/1730000000000-fee-demand.pdf" };
    showHold(holdsView({ live: async () => withPath }));

    const card = await block();
    expect(within(card).getByText(/order on file: fee-demand\.pdf/i)).toBeDefined();
    expect(within(card).queryByRole("link")).toBeNull();
  });

  /**
   * 0051: a link only appears once it has actually signed. An unsigned one is
   * a promise that breaks on tapping, so the row stays plain text.
   */
  it("links the order only once the link signs", async () => {
    const withPath = { ...LIVE, documentPath: "s1/1730000000000-fee-demand.pdf" };
    showHold(
      holdsView({ live: async () => withPath, orderUrl: async () => "https://signed/order" }),
    );

    const card = await block();
    const anchor = within(card).getByRole("link", { name: /fee-demand\.pdf/i });
    expect(anchor.getAttribute("href")).toBe("https://signed/order");
    expect(within(card).queryByText(/order on file/i)).toBeNull();
  });

  /** The release is the Campus Manager's verb alone; everyone else reads it. */
  it("offers no release to a role the route did not hand the verb to", async () => {
    showHold(holdsView());

    const card = await block();
    expect(within(card).queryByRole("button", { name: /release hold/i })).toBeNull();
  });

  it("asks for the note before it lifts anything, and re-reads both halves", async () => {
    const user = userEvent.setup();
    const release = vi.fn(async () => {});
    let liveReads = 0;
    let recordReads = 0;

    render(
      <MemoryRouter>
        <StudentRecordPage
          studentId="s1"
          role={MANAGER}
          view={{
            record: async () => {
              recordReads += 1;
              return recordReads === 1 ? { ...PRIYA, participationStatus: "on_hold" } : PRIYA;
            },
          }}
          holds={holdsView({
            live: async () => {
              liveReads += 1;
              return liveReads === 1 ? LIVE : null;
            },
            history: async () => [],
          })}
          release={release}
        />
      </MemoryRouter>,
    );

    const card = await block();
    await user.click(within(card).getByRole("button", { name: /release hold/i }));
    // One press opens the form; the hold comes off on the second.
    expect(release).not.toHaveBeenCalled();

    await user.type(
      screen.getByRole("textbox", { name: /what cleared it/i }),
      "Cleared with accounts on 3 Nov.",
    );
    await user.click(within(card).getByRole("button", { name: /release hold/i }));

    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(release).toHaveBeenCalledWith("h1", "Cleared with accounts on 3 Nov.");
    expect(liveReads).toBe(2);
    expect(recordReads).toBe(2);

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /placement hold/i })).toBeNull(),
    );
    expect(await screen.findByRole("heading", { name: /priya ramesh/i })).toBeDefined();
  });

  it("lifts the hold with no note when the manager has nothing to add", async () => {
    const user = userEvent.setup();
    const release = vi.fn(async () => {});
    showHold(holdsView({ history: async () => [] }), release);

    const card = await block();
    await user.click(within(card).getByRole("button", { name: /release hold/i }));
    await user.click(within(card).getByRole("button", { name: /release hold/i }));

    await waitFor(() => expect(release).toHaveBeenCalledWith("h1", null));
  });

  /** 0125 raises a sentence; it is the only explanation the manager gets. */
  it("shows what the release failed on instead of leaving it quiet", async () => {
    const user = userEvent.setup();
    showHold(holdsView({ history: async () => [] }), async () => {
      throw new Error("This hold was already released on 12 Nov 2026.");
    });

    const card = await block();
    await user.click(within(card).getByRole("button", { name: /release hold/i }));
    await user.click(within(card).getByRole("button", { name: /release hold/i }));

    const alert = await within(card).findByRole("alert");
    expect(alert.textContent).toMatch(/already released on 12 Nov 2026/i);
    expect(within(card).getByText(/two semesters of fees unpaid\./i)).toBeDefined();
  });

  /** Extend shares Release's gate: it is the Campus Manager's verb alone. */
  it("offers no extend to a role the route did not hand the verb to", async () => {
    showHold(holdsView());

    const card = await block();
    expect(within(card).queryByRole("button", { name: /extend review date/i })).toBeNull();
  });

  /** 0131: the fee dispute outlived the date the hold guessed at. */
  it("extends the review only once a strictly later date is chosen, and re-reads both halves", async () => {
    const user = userEvent.setup();
    const extend = vi.fn(async () => {});
    let liveReads = 0;
    let recordReads = 0;

    render(
      <MemoryRouter>
        <StudentRecordPage
          studentId="s1"
          role={MANAGER}
          view={{
            record: async () => {
              recordReads += 1;
              return { ...PRIYA, participationStatus: "on_hold" };
            },
          }}
          holds={holdsView({
            live: async () => {
              liveReads += 1;
              return LIVE;
            },
            history: async () => [],
            extend,
          })}
          release={async () => {}}
        />
      </MemoryRouter>,
    );

    const card = await block();
    await user.click(within(card).getByRole("button", { name: /extend review date/i }));
    // One press opens the form; nothing is extended until a date is chosen.
    expect(extend).not.toHaveBeenCalled();

    const confirm = within(card).getByRole("button", {
      name: /extend review date/i,
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Extend the review to"), {
      target: { value: "2099-04-01" },
    });
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);

    await waitFor(() => expect(extend).toHaveBeenCalledTimes(1));
    expect(extend).toHaveBeenCalledWith("h1", "2099-04-01");
    expect(liveReads).toBe(2);
    expect(recordReads).toBe(2);

    await waitFor(() => expect(within(card).queryByLabelText(/extend the review to/i)).toBeNull());
  });

  /** The database is the one that knows the date went stale underneath. */
  it("shows what the extension failed on instead of leaving it quiet", async () => {
    const user = userEvent.setup();
    showHold(
      holdsView({
        history: async () => [],
        extend: async () => {
          throw new Error("The new review date must fall after the current one (2099-01-09).");
        },
      }),
      async () => {},
    );

    const card = await block();
    await user.click(within(card).getByRole("button", { name: /extend review date/i }));
    fireEvent.change(screen.getByLabelText("Extend the review to"), {
      target: { value: "2099-02-01" },
    });
    await user.click(within(card).getByRole("button", { name: /extend review date/i }));

    const alert = await within(card).findByRole("alert");
    expect(alert.textContent).toMatch(/must fall after the current one \(2099-01-09\)/i);
    expect(within(card).getByText(/two semesters of fees unpaid\./i)).toBeDefined();
  });

  /** A review date that has gone by is a reminder, not a release (0125). */
  it("marks a passed review date overdue and keeps the student held", async () => {
    showHold(holdsView({ live: async () => ({ ...LIVE, endsAt: "2020-01-09" }) }), undefined, {
      ...PRIYA,
      participationStatus: "on_hold",
    });

    const card = await block();
    expect(within(card).getByText(/review overdue/i)).toBeDefined();
    expect(within(card).getByText(/review was due 09 Jan 2020/i)).toBeDefined();
    expect(within(card).getByText(/on hold — fees/i)).toBeDefined();
  });

  it("says the hold read failed rather than showing a held student as clear", async () => {
    showHold(
      holdsView({
        live: async () => {
          throw new Error("Could not read whether this student is on a hold.");
        },
      }),
    );
    await screen.findByRole("heading", { name: /priya ramesh/i });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not read whether this student is on a hold/i);
    expect(screen.queryByRole("region", { name: /placement hold/i })).toBeNull();
  });

  /** A record page for a role 0125 does not admit asks the question not at all. */
  it("draws nothing when the page was never handed the hold read", async () => {
    show();
    await screen.findByRole("heading", { name: /priya ramesh/i });

    expect(screen.queryByRole("region", { name: /placement hold/i })).toBeNull();
  });
});

/**
 * 0130: the student files a self-placed request with two documents; the Campus
 * Manager is the one who turns it into a hold, or declines it.
 */
describe("StudentRecordPage — a student's self-placed request", () => {
  const requested = (overrides: Partial<HoldsView> = {}) =>
    holdsView({
      live: async () => null,
      pendingFor: async () => PENDING,
      history: async () => [],
      ...overrides,
    });

  it("shows the request, its window and both documents as a request", async () => {
    showHold(requested(), undefined, PRIYA);

    const card = await block();
    expect(within(card).getByText(/requested — self-placed/i)).toBeDefined();
    expect(within(card).getByText(/self-placed at freshworks \(sde\)\./i)).toBeDefined();
    expect(within(card).getByText(/awaiting confirmation/i)).toBeDefined();
    expect(within(card).getByText(/offer letter on file: offer\.pdf/i)).toBeDefined();
    expect(within(card).getByText(/declaration on file: declaration\.jpg/i)).toBeDefined();
    // The student's drives are still open, and the card says so.
    expect(within(card).getByText(/drives stay open until you confirm/i)).toBeDefined();
    // A request is not a hold: no "in force" badge and no release.
    expect(within(card).queryByText(/in force/i)).toBeNull();
    expect(within(card).queryByRole("button", { name: /release hold/i })).toBeNull();
  });

  it("links both documents only once they sign", async () => {
    showHold(
      requested({
        evidenceUrl: async (bucket) =>
          bucket === "offer-letters" ? "https://signed/offer" : "https://signed/declaration",
      }),
      undefined,
      PRIYA,
    );

    const card = await block();
    const offerLink = await within(card).findByRole("link", { name: /open the offer letter/i });
    expect(offerLink.getAttribute("href")).toBe("https://signed/offer");
    expect(
      within(card)
        .getByRole("link", { name: /open the signed declaration/i })
        .getAttribute("href"),
    ).toBe("https://signed/declaration");
  });

  it("confirms the request and re-reads, so the card cannot lie", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(async () => {});
    let pendingReads = 0;

    showHold(
      requested({
        confirm,
        pendingFor: async () => {
          pendingReads += 1;
          return pendingReads === 1 ? PENDING : null;
        },
      }),
      async () => {},
      PRIYA,
    );

    const card = await block();
    await user.click(within(card).getByRole("button", { name: /confirm hold/i }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("h2"));
    expect(pendingReads).toBe(2);
  });

  it("declines with a reason, through the release the manager already has", async () => {
    const user = userEvent.setup();
    const release = vi.fn(async () => {});
    showHold(requested(), release, PRIYA);

    const card = await block();
    // One press opens the note form; the request is declined on the second.
    await user.click(within(card).getByRole("button", { name: /decline request/i }));
    expect(release).not.toHaveBeenCalled();

    await user.type(
      within(card).getByRole("textbox", { name: /why are you declining/i }),
      "The letter names another student.",
    );
    await user.click(within(card).getByRole("button", { name: /decline request/i }));

    await waitFor(() =>
      expect(release).toHaveBeenCalledWith("h2", "The letter names another student."),
    );
  });

  /** Only the Campus Manager decides; an org reader sees the request as fact. */
  it("offers no confirm or decline to a reader who was not handed the verb", async () => {
    showHold(requested(), undefined, PRIYA);

    const card = await block();
    expect(within(card).getByText(/requested — self-placed/i)).toBeDefined();
    expect(within(card).queryByRole("button", { name: /confirm hold/i })).toBeNull();
    expect(within(card).queryByRole("button", { name: /decline request/i })).toBeNull();
  });

  /** 0130 raises a sentence ("This request was already declined on ..."). */
  it("shows what the confirmation failed on", async () => {
    const user = userEvent.setup();
    showHold(
      requested({
        confirm: async () => {
          throw new Error("This request was already declined on 2026-11-01.");
        },
      }),
      async () => {},
      PRIYA,
    );

    const card = await block();
    await user.click(within(card).getByRole("button", { name: /confirm hold/i }));

    const alert = await within(card).findByRole("alert");
    expect(alert.textContent).toMatch(/already declined on 2026-11-01/i);
  });

  describe("Enriched student profile & staff management", () => {
    it("displays CGPA, arrears, school institutions and boards", async () => {
      const user = userEvent.setup();
      show();

      expect(await screen.findByText("8.4 CGPA")).toBeDefined();

      await user.click(screen.getByRole("tab", { name: /academics/i }));
      expect(screen.getByText(/St\. Joseph's Convent/)).toBeDefined();
      expect(screen.getByText(/Kendriya Vidyalaya/)).toBeDefined();

      await user.click(screen.getByRole("tab", { name: /portfolio/i }));
      expect(screen.getByText("AWS Certified Cloud Practitioner")).toBeDefined();
      expect(screen.getByText(/Hospital Management System/)).toBeDefined();
    });

    it("displays multiple offers and internships with stipends and letter downloads", async () => {
      const user = userEvent.setup();
      const studentWithOffers: StudentRecord = {
        ...PRIYA,
        offers: [
          {
            id: "o1",
            driveId: "d1",
            companyName: "Zoho",
            roleTitle: "MTS",
            driveType: "placement",
            offerCategory: "dream",
            ctcLpa: 8.5,
            stipendMonthly: null,
            declaredAt: "2026-09-01T10:00:00Z",
            source: "on_campus",
            letterUrl: "https://storage.test/zoho-offer.pdf",
            letterFileName: "zoho-offer.pdf",
          },
          {
            id: "o2",
            driveId: "d2",
            companyName: "NxtMeal",
            roleTitle: "BTL Marketing Intern",
            driveType: "internship",
            offerCategory: null,
            ctcLpa: null,
            stipendMonthly: 15000,
            declaredAt: "2026-10-05T10:00:00Z",
            source: "on_campus",
            letterUrl: null,
            letterFileName: null,
          },
        ],
      };

      show(view(studentWithOffers));

      await user.click(await screen.findByRole("tab", { name: /placements/i }));

      const placementRegion = await screen.findByRole("region", { name: /placement/i });
      expect(within(placementRegion).getByText("Zoho")).toBeDefined();
      expect(within(placementRegion).getByText("₹8.5 LPA")).toBeDefined();
      expect(within(placementRegion).getByText("NxtMeal")).toBeDefined();
      expect(within(placementRegion).getByText(/₹15,000 \/ month/i)).toBeDefined();
      const letterLink = within(placementRegion).getByRole("link", { name: /offer letter/i });
      expect(letterLink.getAttribute("href")).toBe("https://storage.test/zoho-offer.pdf");
    });

    it("displays category resumes and permits staff to edit preferences", async () => {
      const user = userEvent.setup();
      const updatePreferences = vi.fn(async () => {});
      const v: StudentRecordView = {
        record: async () => PRIYA,
        updatePreferences,
      };

      render(
        <MemoryRouter>
          <StudentRecordPage
            studentId="s1"
            view={v}
            role={COORDINATOR}
            canManagePreferences={true}
          />
        </MemoryRouter>,
      );

      // Verify resume
      await user.click(await screen.findByRole("tab", { name: /preferences/i }));
      const resumesRegion = await screen.findByRole("region", { name: /resumes/i });
      expect(within(resumesRegion).getByText("priya_swe_resume.pdf")).toBeDefined();
      const pdfLink = within(resumesRegion).getByRole("link", { name: /view pdf/i });
      expect(pdfLink.getAttribute("href")).toBe("https://storage.test/res1.pdf");

      // Open Edit Preferences Modal
      const [firstEditButton] = screen.getAllByRole("button", { name: /edit/i });
      if (!firstEditButton) throw new Error("Edit button not found");
      await user.click(firstEditButton);

      expect(await screen.findByRole("dialog", { name: /edit preferences/i })).toBeDefined();

      // Save preferences
      await user.click(screen.getByRole("button", { name: /save preferences/i }));
      expect(updatePreferences).toHaveBeenCalledWith(
        "s1",
        ["software_technical", "sales"],
        ["placement", "internship"],
      );
    });
  });
});

/**
 * 0133 and 0134 on the record: the two moves a person can make on this
 * student's standing, and the ledger that says who made them and why.
 *
 * The point these tests exist for is that the screen refuses the same people
 * the database does. A button that always fails is worse than no button — the
 * manager types a reason, presses it, and learns the rule only from the error.
 */
const CHANGE_EVENT: StatusEvent = {
  id: "change-c1",
  title: "Status changed",
  detail: "Opted out → In the pipeline",
  byName: "Karthik Subramanian",
  at: "2026-10-20T09:00:00Z",
  reason: "Opted out at counselling by mistake — confirmed with the student on 3 Nov.",
  tone: "neutral",
};

const WITHDRAWAL_EVENT: StatusEvent = {
  id: "withdrawal-w1",
  title: "Offer withdrawn",
  detail: "TCS · Software Engineer · ₹9 LPA · on campus",
  byName: "Meena Krishnan",
  at: "2026-10-25T09:00:00Z",
  reason: "Company retracted the joining — confirmed in writing.",
  tone: "warning",
};

const ledger = (overrides: Partial<StatusChangesView> = {}): StatusChangesView => ({
  historyFor: async () => [],
  restore: async () => {},
  withdraw: async () => {},
  ...overrides,
});

const showStatus = (record: StudentRecord, role: AppRole, changes: StatusChangesView = ledger()) =>
  render(
    <MemoryRouter>
      <StudentRecordPage studentId="s1" view={view(record)} role={role} statusChanges={changes} />
    </MemoryRouter>,
  );

const OPTED_OUT: StudentRecord = { ...PRIYA, participationStatus: "opted_out" };
const PLACED: StudentRecord = {
  ...PRIYA,
  participationStatus: "opted_out",
  offers: [
    {
      id: "o1",
      driveId: "d1",
      companyName: "Zoho",
      roleTitle: "MTS",
      driveType: "placement",
      offerCategory: "dream",
      ctcLpa: 8.5,
      stipendMonthly: null,
      declaredAt: "2026-09-01T10:00:00Z",
      source: "on_campus",
      letterUrl: "https://storage.test/zoho-offer.pdf",
      letterFileName: "zoho-offer.pdf",
    },
  ],
};

describe("StudentRecordPage status change", () => {
  it("offers the move to a coordinator while the student is opted out", async () => {
    showStatus(OPTED_OUT, COORDINATOR);

    expect(await screen.findByRole("button", { name: /change status/i })).toBeDefined();
  });

  /** A role that only reads still needs to know whose desk the request is on. */
  it("names the roles that may return the student when this one cannot", async () => {
    showStatus(OPTED_OUT, DELIVERY_HEAD);

    expect(screen.queryByRole("button", { name: /change status/i })).toBeNull();
    expect(await screen.findByText(/only a campus placement coordinator/i)).toBeDefined();
  });

  /** A held student has a way back, and it is not this button. */
  it("points a held student at the hold instead of the status change", async () => {
    showStatus({ ...PRIYA, participationStatus: "on_hold" }, MANAGER);

    expect(screen.queryByRole("button", { name: /change status/i })).toBeNull();
    expect(await screen.findByText(/hold is released by their campus manager/i)).toBeDefined();
  });

  it("says nothing to a disbarred student's reader that a status change will help", async () => {
    showStatus({ ...PRIYA, participationStatus: "disbarred" }, MANAGER);

    expect(screen.queryByRole("button", { name: /change status/i })).toBeNull();
    expect(await screen.findByText(/disbarment is central/i)).toBeDefined();
  });

  /** Already in the pipeline is the normal case, not a fact worth a sentence. */
  it("offers nothing for a student already in the pipeline", async () => {
    showStatus(PRIYA, MANAGER);

    await screen.findByRole("heading", { name: /priya ramesh/i });
    expect(screen.queryByRole("button", { name: /change status/i })).toBeNull();
    expect(screen.queryByText(/already in the pipeline/i)).toBeNull();
  });

  it("refuses an empty reason before it sends anything", async () => {
    const user = userEvent.setup();
    const restore = vi.fn(async () => {});
    showStatus(OPTED_OUT, COORDINATOR, ledger({ restore }));

    await user.click(await screen.findByRole("button", { name: /change status/i }));
    const dialog = await screen.findByRole("dialog", { name: /return priya ramesh/i });
    await user.click(within(dialog).getByRole("button", { name: /return to the pipeline/i }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/say why the student is coming back/i);
    expect(restore).not.toHaveBeenCalled();
  });

  it("sends the reason with the student's id and closes once it goes through", async () => {
    const user = userEvent.setup();
    const restore = vi.fn(async (_studentId: string, _reason: string) => {});
    showStatus(OPTED_OUT, COORDINATOR, ledger({ restore }));

    await user.click(await screen.findByRole("button", { name: /change status/i }));
    const dialog = await screen.findByRole("dialog", { name: /return priya ramesh/i });
    const reason = "Counselling mistake — confirmed with the student on 3 Nov.";
    await user.type(within(dialog).getByLabelText(/why are they coming back/i), reason);
    await user.click(within(dialog).getByRole("button", { name: /return to the pipeline/i }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith("s1", reason));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  /** The view throws its own sentence; the block is where the reader finds it. */
  it("says the student's standing aloud with who moved it and why", async () => {
    showStatus(
      PLACED,
      MANAGER,
      ledger({ historyFor: async () => [WITHDRAWAL_EVENT, CHANGE_EVENT] }),
    );

    const region = await screen.findByRole("region", { name: /status history/i });
    expect(within(region).getAllByRole("heading", { level: 3 })[0]?.textContent).toBe(
      "Offer withdrawn",
    );
    expect(within(region).getByText(/₹9 lpa · on campus/i)).toBeDefined();
    expect(within(region).getByText(/opted out → in the pipeline/i)).toBeDefined();
    expect(within(region).getByText(/by meena krishnan · 25 oct 2026/i)).toBeDefined();
    expect(within(region).getByText(/by karthik subramanian · 20 oct 2026/i)).toBeDefined();
    expect(within(region).getByText(/2 records/i)).toBeDefined();
    expect(within(region).getByText(/counselling by mistake/i)).toBeDefined();
  });

  it("says when the ledger cannot be read instead of showing nothing", async () => {
    showStatus(
      OPTED_OUT,
      COORDINATOR,
      ledger({
        historyFor: async () => {
          throw new Error("Could not read this student's status history. (permission denied)");
        },
      }),
    );

    const region = await screen.findByRole("region", { name: /status history/i });
    const alert = within(region).getByRole("alert");
    expect(alert.textContent).toMatch(/permission denied/i);
  });

  /**
   * Which roles may read the ledger is the route's question — it hands the
   * view only to those canReadStatusHistory admits, and
   * domain/status-changes.test.ts proves account_executive is not one of them.
   * This is the page's half: handed nothing, it draws no history and offers no
   * move, the same silence the hold block keeps.
   */
  it("draws no history and offers no move when the ledger was never handed over", async () => {
    render(
      <MemoryRouter>
        <StudentRecordPage studentId="s1" view={view(OPTED_OUT)} role={ACCOUNT_EXECUTIVE} />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /priya ramesh/i });
    expect(screen.queryByRole("region", { name: /status history/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /change status/i })).toBeNull();
  });
});

describe("StudentRecordPage offer withdrawal", () => {
  it("offers the move on each offer row for a role 0134 admits", async () => {
    const user = userEvent.setup();
    showStatus(PLACED, MANAGER);

    await user.click(await screen.findByRole("tab", { name: /placements/i }));

    expect(await screen.findByRole("button", { name: /withdraw the zoho offer/i })).toBeDefined();
  });

  it("keeps it from a role that may not delete an offer", async () => {
    const user = userEvent.setup();
    showStatus(PLACED, DELIVERY_HEAD);

    await screen.findByRole("heading", { name: /priya ramesh/i });
    await user.click(screen.getByRole("tab", { name: /placements/i }));
    expect(screen.queryByRole("button", { name: /withdraw the zoho offer/i })).toBeNull();
  });

  it("asks for the reason before it takes an offer back", async () => {
    const user = userEvent.setup();
    const withdraw = vi.fn(async (_offerId: string, _reason: string) => {});
    showStatus(PLACED, COORDINATOR, ledger({ withdraw }));

    await user.click(await screen.findByRole("tab", { name: /placements/i }));
    await user.click(await screen.findByRole("button", { name: /withdraw the zoho offer/i }));
    const dialog = await screen.findByRole("dialog", { name: /withdraw the zoho offer/i });
    await user.click(within(dialog).getByRole("button", { name: /withdraw offer$/i }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/say why the offer is being withdrawn/i);
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("sends the offer id with the reason and closes once it goes through", async () => {
    const user = userEvent.setup();
    const withdraw = vi.fn(async (_offerId: string, _reason: string) => {});
    showStatus(PLACED, COORDINATOR, ledger({ withdraw }));

    await user.click(await screen.findByRole("tab", { name: /placements/i }));
    await user.click(await screen.findByRole("button", { name: /withdraw the zoho offer/i }));
    const dialog = await screen.findByRole("dialog", { name: /withdraw the zoho offer/i });
    const reason = "Company retracted the joining — confirmed in writing.";
    await user.type(within(dialog).getByLabelText(/why is the offer being withdrawn/i), reason);
    await user.click(within(dialog).getByRole("button", { name: /withdraw offer$/i }));

    await waitFor(() => expect(withdraw).toHaveBeenCalledWith("o1", reason));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
