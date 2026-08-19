// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  StudentDashboard,
  type StudentDashboardSnapshot,
  type StudentDashboardView,
} from "./student-dashboard";

/**
 * The student's own dashboard — their landing route, and the first screen
 * every student sees.
 *
 * It shows one person's data and nothing else, so every assertion here is
 * about *their* record: their name, their form, their applications, their
 * offers. The judgements - where an application has got to, what they should
 * do next, whether their absences matter - all come from src/domain, so this
 * screen can never quietly disagree with the coordinator's cockpit.
 */

const SNAPSHOT: StudentDashboardSnapshot = {
  fullName: "Anjali Subramanian",
  rollNumber: "21CSE1042",
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  campus: "Alliance University",
  srfStatus: "srf_approved",
  participationStatus: "active",
  openDrives: 2,
  semesters: [
    { semesterNumber: 5, cgpa: 8.4, verified: true },
    { semesterNumber: 6, cgpa: 8.6, verified: false },
  ],
  applications: [
    {
      applicationId: "app-1",
      companyName: "Zoho Corporation",
      roleTitle: "Member Technical Staff",
      appliedAt: "2026-07-01T04:30:00.000Z",
      hasOffer: false,
      rounds: [
        {
          sequence: 1,
          name: "Online test",
          participating: true,
          attendance: "present",
          result: "selected",
        },
        {
          sequence: 2,
          name: "Technical interview",
          participating: true,
          attendance: "scheduled",
          result: null,
        },
        { sequence: 3, name: "HR interview", participating: false, attendance: null, result: null },
      ],
    },
    {
      applicationId: "app-2",
      companyName: "Accenture",
      roleTitle: "Associate Engineer",
      appliedAt: "2026-06-20T04:30:00.000Z",
      hasOffer: false,
      rounds: [],
    },
  ],
  offers: [],
  attendance: [],
};

const view = (
  overrides: Partial<StudentDashboardSnapshot> = {},
  extra: Partial<StudentDashboardView> = {},
): StudentDashboardView => ({
  snapshot: async () => ({ ...SNAPSHOT, ...overrides }),
  notifications: async () => [],
  markRead: async () => undefined,
  ...extra,
});

const show = (v: StudentDashboardView) =>
  render(
    <MemoryRouter>
      <StudentDashboard view={v} />
    </MemoryRouter>,
  );

describe("StudentDashboard", () => {
  it("greets the signed-in student by their own name and roll number", async () => {
    show(view());

    expect(
      await screen.findByRole("heading", { level: 1, name: /anjali subramanian/i }),
    ).toBeDefined();
    expect(screen.getByText(/21CSE1042/)).toBeDefined();
  });

  it("says what to do next, using the domain prompt rather than its own judgement", async () => {
    show(view({ srfStatus: "srf_submitted" }));

    const prompt = await screen.findByRole("region", { name: /what to do next/i });
    expect(within(prompt).getByText(/with your coordinator/i)).toBeDefined();
    // Nothing to click: verification is the coordinator's move, not theirs.
    expect(within(prompt).queryByRole("link")).toBeNull();
  });

  it("links an unregistered student straight to their registration form", async () => {
    show(view({ srfStatus: "invited", openDrives: 0 }));

    const prompt = await screen.findByRole("region", { name: /what to do next/i });
    expect(within(prompt).getByRole("link", { name: /registration form/i })).toBeDefined();
  });

  it("reports where each application has actually got to", async () => {
    show(view());

    const applications = await screen.findByRole("region", { name: /my applications/i });
    expect(within(applications).getByText("Round 2 of 3 — Technical interview")).toBeDefined();
    expect(within(applications).getByText(/awaiting shortlist/i)).toBeDefined();
  });

  it("names every round of a drive so the student can see what is left", async () => {
    show(view());

    const applications = await screen.findByRole("region", { name: /my applications/i });
    expect(within(applications).getByText("HR interview")).toBeDefined();
  });

  it("shows an offer with its company, category and CTC", async () => {
    show(
      view({
        offers: [
          {
            offerId: "o-1",
            companyName: "Freshworks",
            roleTitle: "Associate Software Engineer",
            ctcLpa: 7.5,
            offerCategory: "dream",
            declaredAt: "2026-06-12T04:30:00.000Z",
            source: "on_campus",
          },
        ],
      }),
    );

    const offers = await screen.findByRole("region", { name: /my offers/i });
    expect(within(offers).getByText(/freshworks/i)).toBeDefined();
    expect(within(offers).getByText(/7.5 LPA/)).toBeDefined();
    expect(within(offers).getByText(/dream/i)).toBeDefined();
  });

  it("explains the ladder to a placed student, because it changes what they will see", async () => {
    show(
      view({
        offers: [
          {
            offerId: "o-1",
            companyName: "Freshworks",
            roleTitle: null,
            ctcLpa: 7.5,
            offerCategory: "dream",
            declaredAt: "2026-06-12T04:30:00.000Z",
            source: "on_campus",
          },
        ],
      }),
    );

    const offers = await screen.findByRole("region", { name: /my offers/i });
    expect(within(offers).getByText(/above this category/i)).toBeDefined();
  });

  it("says plainly when there are no offers yet, instead of inventing one", async () => {
    show(view());

    const offers = await screen.findByRole("region", { name: /my offers/i });
    expect(within(offers).getByText(/no offers yet/i)).toBeDefined();
    expect(within(offers).queryByRole("button", { name: /download/i })).toBeNull();
  });

  it("shows the semester record, marking which lines a coordinator has verified", async () => {
    show(view());

    const academics = await screen.findByRole("region", { name: /my academic record/i });
    const semester6 = within(academics)
      .getByText(/semester 6/i)
      .closest("li");
    if (semester6 === null) throw new Error("row not found");
    expect(within(semester6).getByText(/awaiting verification/i)).toBeDefined();

    const semester5 = within(academics)
      .getByText(/semester 5/i)
      .closest("li");
    if (semester5 === null) throw new Error("row not found");
    expect(within(semester5).getByText(/verified/i)).toBeDefined();
  });

  it("tells a student with no semesters entered that eligibility needs them", async () => {
    show(view({ semesters: [] }));

    const academics = await screen.findByRole("region", { name: /my academic record/i });
    expect(within(academics).getByText(/have not entered any semester/i)).toBeDefined();
  });

  it("counts absences against the R8 limit, so three is never a surprise", async () => {
    show(
      view({
        attendance: [
          { driveId: "d1", roundId: "r1", status: "absent" },
          { driveId: "d1", roundId: "r2", status: "present" },
          { driveId: "d2", roundId: "r3", status: "absent" },
        ],
      }),
    );

    const summary = await screen.findByRole("region", { name: /summary/i });
    expect(within(summary).getByText("2 of 3")).toBeDefined();
  });

  it("warns a student who has reached the review threshold", async () => {
    show(
      view({
        attendance: [
          { driveId: "d1", roundId: "r1", status: "absent" },
          { driveId: "d1", roundId: "r2", status: "absent" },
          { driveId: "d2", roundId: "r3", status: "absent" },
        ],
      }),
    );

    expect(await screen.findByText(/under review/i)).toBeDefined();
  });

  it("does not count an unconfirmed QR check-in as an absence", async () => {
    show(
      view({
        attendance: [
          { driveId: "d1", roundId: "r1", status: "provisional" },
          { driveId: "d1", roundId: "r2", status: "scheduled" },
        ],
      }),
    );

    const summary = await screen.findByRole("region", { name: /summary/i });
    expect(within(summary).getByText("0 of 3")).toBeDefined();
  });

  it("says so when the student has not applied to anything yet", async () => {
    show(view({ applications: [] }));

    const applications = await screen.findByRole("region", { name: /my applications/i });
    expect(within(applications).getByText(/not applied to any drive yet/i)).toBeDefined();
  });

  it("announces that it is loading rather than flashing an empty dashboard", () => {
    show(view({}, { snapshot: () => new Promise(() => {}) }));

    expect(screen.getByRole("status")).toBeDefined();
  });

  it("says something useful when the record cannot be loaded", async () => {
    show(
      view(
        {},
        {
          snapshot: async () => {
            throw new Error("network");
          },
        },
      ),
    );

    expect(await screen.findByRole("alert")).toBeDefined();
  });
});

/**
 * D8/D9 (2026-08-12): the Central CPC's entries trigger in-app notifications
 * — shortlisted, round cleared, round not selected, offer. This panel is
 * where they land; email comes later (P1).
 */
describe("StudentDashboard — notifications", () => {
  const NOTES = [
    {
      id: "n2",
      kind: "round_cleared",
      title: "You cleared Round 1 of Zoho",
      body: "Well done — you advance from Round 1 of Zoho.",
      createdAt: "2026-08-12T10:00:00Z",
      read: false,
    },
    {
      id: "n1",
      kind: "shortlisted",
      title: "You are shortlisted for Zoho",
      body: "Round 1 is next.",
      createdAt: "2026-08-10T10:00:00Z",
      read: true,
    },
  ];

  it("shows them with an unread count", async () => {
    show(view({}, { notifications: async () => NOTES }));

    expect(await screen.findByText(/1 unread/i)).toBeDefined();
    expect(screen.getByText("You cleared Round 1 of Zoho")).toBeDefined();
    expect(screen.getByText("You are shortlisted for Zoho")).toBeDefined();
  });

  it("marks one read on request", async () => {
    const markRead = vi.fn();
    const user = userEvent.setup();
    show(view({}, { notifications: async () => NOTES, markRead }));

    await user.click(await screen.findByRole("button", { name: /mark read/i }));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith("n2"));
  });

  it("offers no mark-read on something already read", async () => {
    show(view({}, { notifications: async () => [NOTES[1] as (typeof NOTES)[1]] }));

    await screen.findByText("You are shortlisted for Zoho");
    expect(screen.queryByRole("button", { name: /mark read/i })).toBeNull();
  });

  it("stays out of the way when there are none", async () => {
    show(view());

    await screen.findByText(/21CSE1042/);
    expect(screen.queryByText(/unread/i)).toBeNull();
  });

  /**
   * E1/E2 (UAT 2026-08-19): the panel condenses to the top 3 and links to the
   * full alerts page; a read note sinks but never disappears.
   */
  const MANY = [
    {
      id: "m1",
      kind: "offer",
      title: "Offer from Zoho",
      body: "b",
      createdAt: "2026-08-19T05:00:00Z",
      read: false,
    },
    {
      id: "m2",
      kind: "round_cleared",
      title: "You cleared Round 2 of Zoho",
      body: "b",
      createdAt: "2026-08-19T04:00:00Z",
      read: false,
    },
    {
      id: "m3",
      kind: "round_cleared",
      title: "You cleared Round 1 of Zoho",
      body: "b",
      createdAt: "2026-08-19T03:00:00Z",
      read: true,
    },
    {
      id: "m4",
      kind: "shortlisted",
      title: "You are shortlisted for Zoho",
      body: "b",
      createdAt: "2026-08-19T02:00:00Z",
      read: true,
    },
    {
      id: "m5",
      kind: "shortlisted",
      title: "You are shortlisted for HCL",
      body: "b",
      createdAt: "2026-08-19T01:00:00Z",
      read: true,
    },
  ];

  it("shows only the top 3 and links to the rest (E1)", async () => {
    show(view({}, { notifications: async () => MANY }));

    expect(await screen.findByText("Offer from Zoho")).toBeDefined();
    expect(screen.getByText("You cleared Round 2 of Zoho")).toBeDefined();
    expect(screen.getByText("You cleared Round 1 of Zoho")).toBeDefined();
    expect(screen.queryByText("You are shortlisted for Zoho")).toBeNull();

    const readAll = screen.getByRole("link", { name: /all 5 notifications/i });
    expect(readAll.getAttribute("href")).toBe("/student/notifications");
  });

  it("puts unread above read even when the read note is newer (E2)", async () => {
    const notes = [
      {
        id: "r",
        kind: "offer",
        title: "Read but new",
        body: "b",
        createdAt: "2026-08-19T09:00:00Z",
        read: true,
      },
      {
        id: "u",
        kind: "offer",
        title: "Unread but old",
        body: "b",
        createdAt: "2026-08-01T09:00:00Z",
        read: false,
      },
    ];
    show(view({}, { notifications: async () => notes }));

    const titles = await screen.findAllByText(/read but new|unread but old/i);
    expect(titles[0]?.textContent).toMatch(/unread but old/i);
  });

  it("labels a read note as read rather than hiding it (E2)", async () => {
    show(view({}, { notifications: async () => [NOTES[1] as (typeof NOTES)[1]] }));

    await screen.findByText("You are shortlisted for Zoho");
    expect(screen.getByText(/✓ read/i)).toBeDefined();
  });
});
