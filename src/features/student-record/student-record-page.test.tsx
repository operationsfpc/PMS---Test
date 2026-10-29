// @vitest-environment jsdom
import type { Hold, HoldsView } from "@lib/holds-view";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  type StudentRecord,
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
  campusName: "SDNB Vaishnav College",
  degree: "B.Sc CS / CT",
  branch: "CS with AI",
  passingYear: 2027,
  srfStatus: "srf_approved",
  participationStatus: "active",
  tenthPercentage: 92.4,
  twelfthPercentage: 88,
  semesters: [
    { semesterNumber: 1, cgpa: 8.2, verified: true },
    { semesterNumber: 2, cgpa: 8.6, verified: false },
  ],
  skills: [
    { skill: "Java", score: 4 },
    { skill: "SQL", score: 3 },
  ],
  rolePreferences: ["software_technical", "sales"],
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
  placement: null,
};

const view = (record: StudentRecord | null = PRIYA): StudentRecordView => ({
  record: async () => record,
});

const show = (v: StudentRecordView = view()) =>
  render(
    <MemoryRouter>
      <StudentRecordPage studentId="s1" view={v} />
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
    show();

    const academics = await screen.findByRole("region", { name: /academics/i });
    expect(within(academics).getByText(/92\.4/)).toBeDefined();
    expect(within(academics).getByText(/88/)).toBeDefined();
    expect(within(academics).getByText(/semester 1/i)).toBeDefined();
    expect(within(academics).getByText(/8\.2/)).toBeDefined();
    expect(within(academics).getByText(/verified/i)).toBeDefined();
    expect(within(academics).getByText(/pending/i)).toBeDefined();
  });

  it("shows the skill scores out of 5, and the role preferences", async () => {
    show();

    const skills = await screen.findByRole("region", { name: /skills/i });
    expect(within(skills).getByText(/java 4\/5/i)).toBeDefined();
    expect(within(skills).getByText(/sql 3\/5/i)).toBeDefined();
    expect(screen.getByText(/software \/ technical/i)).toBeDefined();
  });

  it("is honest when no skill scores are recorded", async () => {
    show(view({ ...PRIYA, skills: [] }));

    const skills = await screen.findByRole("region", { name: /skills/i });
    expect(within(skills).getByText(/no skill scores recorded/i)).toBeDefined();
  });

  it("lists every application, each opening its drive", async () => {
    show();

    const applications = await screen.findByRole("region", { name: /applications/i });
    const link = within(applications).getByRole("link", { name: /zoho/i });
    expect(link.getAttribute("href")).toBe("/drives/d1");
    expect(within(applications).getByText(/shortlisted/i)).toBeDefined();
  });

  it("says plainly when the student has not applied anywhere", async () => {
    show(view({ ...PRIYA, applications: [] }));

    const applications = await screen.findByRole("region", { name: /applications/i });
    expect(within(applications).getByText(/no applications yet/i)).toBeDefined();
  });

  it("shows the placement when there is one — with its source", async () => {
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

    const placement = await screen.findByRole("region", { name: /placement/i });
    expect(within(placement).getByText(/freshworks/i)).toBeDefined();
    expect(within(placement).getByText(/self-placed/i)).toBeDefined();
  });

  it("says Not placed as a fact, not a blank", async () => {
    show();

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
        <StudentRecordPage studentId="s1" view={view()} />
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
  releasedAt: null,
  releasedBy: null,
  releaseNote: null,
  documentPath: null,
};

const EARLIER: Hold = {
  ...LIVE,
  id: "h0",
  kind: "idle",
  reason: "Applied to nothing in September.",
  endsAt: null,
  releasedAt: "2026-09-30T10:00:00Z",
  releasedBy: "Meena Krishnan",
  releaseNote: "Cleared on request — they were mid-project.",
};

const holdsView = (overrides: Partial<HoldsView> = {}): HoldsView => ({
  live: async () => LIVE,
  history: async () => [LIVE, EARLIER],
  place: async () => "h1",
  release: async () => {},
  orderUrl: async () => null,
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
