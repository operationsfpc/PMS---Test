// @vitest-environment jsdom

import { AppShell } from "@components/app-shell";
import type { AppRole } from "@domain/types";
import { SrfVerificationQueue } from "@features/cpc/srf-verification-queue";
import { PifApprovalQueue } from "@features/delivery-head/pif-approval-queue";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../app";
import { AuthContext, type AuthState } from "./auth/require-auth";

const signedIn = (role: AppRole): AuthState => ({
  status: "signed-in",
  role,
  email: "test@example.com",
  campuses: [],
});

const routed = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("AppShell", () => {
  it("shows the FACE Prep Campus logo", () => {
    routed(<AppShell>content</AppShell>);
    expect(screen.getByAltText(/face prep campus/i)).toBeDefined();
  });

  /**
   * Since 2026-08-17 the sidebar collapses every group but the one in use, and
   * these render at "/" which is inside none of them. The group is opened
   * first so the test still asks its own question - which role's links are
   * offered - rather than accidentally testing the collapse.
   */
  const openGroup = async (name: RegExp) => userEvent.click(screen.getByRole("button", { name }));

  it("switches navigation when previewing a different role", async () => {
    routed(<AppShell>content</AppShell>);
    await openGroup(/^home$/i);
    expect(screen.getByRole("link", { name: /my dashboard/i })).toBeDefined();

    await userEvent.selectOptions(
      screen.getByLabelText(/preview as/i),
      screen.getByRole("option", { name: /delivery head/i }),
    );

    await openGroup(/^drive approval$/i);
    expect(screen.getByRole("link", { name: /pif approvals/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /my dashboard/i })).toBeNull();
  });
});

/**
 * The two StudentDashboard tests that lived here asserted on the visual mock
 * ('1 of 3' absences, the Dream-category sentence) with no data behind them.
 * Both behaviours are now asserted against real data in
 * student-dashboard.test.tsx - the ladder explanation and the absence count
 * against ABSENCE_LIMIT - so they are not lost, only moved.
 */

describe("SrfVerificationQueue", () => {
  /**
   * Now data-driven, so these supply a repository instead of reading fixtures.
   *
   * The marksheet assertion changed shape: the mock rendered one "View 3 files"
   * link per student, which named a count rather than a document. Real data
   * gives one named link per marksheet, so a coordinator can tell which
   * document they are opening. Intent (PRD 4.2 - link the evidence beside the
   * figure) is unchanged.
   */
  const stub = {
    pending: async () => [
      {
        id: "s1",
        fullName: "Asha Ramanathan",
        rollNumber: "TEC001",
        overallCgpa: 8.2,
        currentArrears: 0,
        historyOfArrears: 1,
        tenthPercentage: 91.4,
        twelfthPercentage: 88,
        submittedAt: "2026-08-01T10:00:00Z",
        documents: [{ kind: "tenth_marksheet", label: "10th marksheet", url: "https://signed/10" }],
        // Each declared semester beside the marksheet that evidences it - the
        // uploads used to be discarded, so this column had nothing in it.
        // 0039: approving the form confirms these too, so they are shown
        // beside their documents before the button that commits to them.
        certificates: [
          {
            id: "c1",
            name: "AWS Cloud Practitioner",
            url: "https://signed/aws",
            status: "pending" as const,
          },
        ],
        semesters: [
          {
            semesterNumber: 1,
            cgpa: 8.1,
            currentArrears: 0,
            historyOfArrears: 0,
            status: "pending",
            marksheetUrl: "https://signed/sem1",
          },
        ],
      },
    ],
    decide: async () => undefined,
  };

  it("separates standing arrears from arrear history", async () => {
    // Drives filter on each independently (decision Q6).
    routed(<SrfVerificationQueue repository={stub} />);
    expect(await screen.findByRole("columnheader", { name: /standing arrears/i })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: /arrear history/i })).toBeDefined();
  });

  it("links the marksheets that justify the figures", async () => {
    routed(<SrfVerificationQueue repository={stub} />);
    expect(await screen.findByRole("link", { name: /10th marksheet/i })).toBeDefined();
  });
});

describe("PifApprovalQueue", () => {
  /**
   * Data-driven now, so these supply a repository. The assertions are
   * unchanged: banding comes from the real domain rule, and both irreversible
   * consequences must be stated before the click.
   */
  const stub = {
    pending: async () => [
      {
        id: "p3",
        companyName: "Goldman Sachs",
        roleTitle: "Analyst",
        ctcMinLpa: 18,
        ctcMaxLpa: 22,
        driveType: "placement",
        onHold: true,
        createdAt: "2026-08-01T09:00:00Z",
      },
      {
        id: "p1",
        companyName: "Zoho",
        roleTitle: "MTS",
        ctcMinLpa: 6.5,
        ctcMaxLpa: 9,
        driveType: "placement",
        onHold: false,
        createdAt: "2026-08-01T10:00:00Z",
      },
    ],
    decide: async () => undefined,
  };

  it("suggests an offer category using the real domain rule", async () => {
    routed(<PifApprovalQueue repository={stub} />);
    // Goldman Sachs is INR 18-22 LPA -> Super Dream via classifyOfferCategory.
    const select = (await screen.findByLabelText(/offer category/i, {
      selector: "#cat-p3",
    })) as HTMLSelectElement;
    expect(select.value).toBe("super_dream");
  });

  it("bands a 6.5-9 LPA drive as Dream", async () => {
    routed(<PifApprovalQueue repository={stub} />);
    const select = (await screen.findByLabelText(/offer category/i, {
      selector: "#cat-p1",
    })) as HTMLSelectElement;
    expect(select.value).toBe("dream");
  });

  it("warns that rejection is permanent before the click", async () => {
    routed(<PifApprovalQueue repository={stub} />);
    expect((await screen.findAllByText(/rejection is final/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /reject permanently/i }).length).toBeGreaterThan(
      0,
    );
  });

  it("marks the classification as final", async () => {
    routed(<PifApprovalQueue repository={stub} />);
    expect((await screen.findAllByText(/cannot be changed later/i)).length).toBeGreaterThan(0);
  });

  it("surfaces an on-hold PIF", async () => {
    routed(<PifApprovalQueue repository={stub} />);
    expect((await screen.findAllByText(/on hold/i)).length).toBeGreaterThan(0);
  });

  /**
   * 2026-08-17 (Karthik): the Delivery Head classifies every drive and §3.3
   * makes it immutable, so the bands have to be readable at the click.
   *
   * SPEC CHANGE, same day: "5.00 is dream and 10.00 is super dream." The
   * banner must state the edge as a FLOOR, because the previous wording ("up
   * to ₹5 LPA" for Regular) is now the wrong answer.
   */
  it("states the CTC bands where the category is chosen", async () => {
    routed(<PifApprovalQueue repository={stub} />);
    const note = await screen.findByRole("note", { name: /ctc bands/i });

    expect(within(note).getByText("Regular")).toBeDefined();
    expect(within(note).getByText("Dream")).toBeDefined();
    expect(within(note).getByText("Super Dream")).toBeDefined();
    expect(note.textContent).toMatch(/below ₹5 LPA/i);
    expect(note.textContent).toMatch(/₹5 LPA and above, below ₹10 LPA/i);
    expect(note.textContent).toMatch(/₹10 LPA and above/i);
  });

  /** The edge itself is the thing people get wrong, so it is spelled out. */
  it("spells out which band owns the boundary", async () => {
    routed(<PifApprovalQueue repository={stub} />);
    const note = await screen.findByRole("note", { name: /ctc bands/i });
    expect(note.textContent).toMatch(/₹5 LPA is Dream/i);
    expect(note.textContent).toMatch(/₹10 LPA is Super Dream/i);
    expect(note.textContent).not.toMatch(/₹5 LPA is Regular/i);
  });

  /**
   * Guidance, not a lock. Q1 gives the Delivery Head the final call, and a
   * banner that read as a rule would make an override feel like a violation.
   */
  it("presents the bands as guidance the Delivery Head may override", async () => {
    routed(<PifApprovalQueue repository={stub} />);
    const note = await screen.findByRole("note", { name: /ctc bands/i });
    expect(note.textContent).toMatch(/guidance|yours|override/i);
  });

  /** One banner for the screen, not one per card: the bands do not vary by PIF. */
  it("states the bands once, however many PIFs are queued", async () => {
    routed(<PifApprovalQueue repository={stub} />);
    await screen.findByRole("note", { name: /ctc bands/i });
    expect(screen.getAllByRole("note", { name: /ctc bands/i })).toHaveLength(1);
  });
});

/**
 * 2026-08-17 (Karthik): "They should not be able to publish drives or
 * shortlist students."
 *
 * The sidebar no longer offers the AE either screen, but a bookmark from
 * before this change still resolves. Removing a link is not access control —
 * the door has to be shut too.
 */
describe("publishing and shortlisting refuse the Account Executive at the door", () => {
  const at = (path: string, role: AppRole) =>
    render(
      <AuthContext.Provider value={signedIn(role)}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );

  it("turns the AE away from shortlisting", async () => {
    at("/central/shortlisting?drive=d1", "account_executive");
    expect(await screen.findByText(/belongs to the placement coordinators/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /^shortlist/i })).toBeNull();
  });

  it("turns the AE away from publishing", async () => {
    at("/central/publish?drive=d1", "account_executive");
    expect(await screen.findByText(/belongs to the central placement coordinator/i)).toBeDefined();
  });

  /** The Delivery Head approves the commercials; announcing them is not theirs either. */
  it("turns the Delivery Head away from publishing", async () => {
    at("/central/publish?drive=d1", "delivery_head");
    expect(await screen.findByText(/belongs to the central placement coordinator/i)).toBeDefined();
  });

  it("still lets the Central Placement Coordinator through to shortlisting", async () => {
    at("/central/shortlisting?drive=d1", "central_placement_coordinator");
    expect(await screen.findByRole("heading", { name: /shortlisting/i })).toBeDefined();
    expect(screen.queryByText(/belongs to the placement coordinators/i)).toBeNull();
  });
});

/*
 * AttendancePage's tests now live in cpc/attendance-page.test.tsx.
 *
 * The screen became data-driven, so it needs a view injected. Every assertion
 * that was here is preserved there - select all / unselect all, marking, the
 * "N of 3" prior-absence count, and the "Triggers review" warning - plus new
 * ones for the empty and failure states.
 */

describe("mobile navigation", () => {
  it("hides the nav behind a toggle and opens it on demand", async () => {
    routed(<AppShell>content</AppShell>);
    const toggle = screen.getByRole("button", { name: /open navigation/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(toggle);

    expect(screen.getByRole("button", { name: /close navigation/i })).toBeDefined();
  });

  it("closes the menu after a destination is chosen", async () => {
    routed(<AppShell>content</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    // The group has to be opened before there is a destination to choose.
    await userEvent.click(screen.getByRole("button", { name: /^home$/i }));
    await userEvent.click(screen.getByRole("link", { name: /my dashboard/i }));
    expect(screen.getByRole("button", { name: /open navigation/i })).toBeDefined();
  });
});

/**
 * D3 (2026-08-12): verification is the campus placement coordinator's alone.
 * The database refuses everyone else's decisions (0042); these tests pin the
 * screen saying so up front instead of rendering a queue whose buttons fail.
 */
describe("the verification queues refuse other roles at the door", () => {
  const at = (path: string, role: AppRole) =>
    render(
      <AuthContext.Provider value={signedIn(role)}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );

  it("tells the central coordinator the SRF queue is not theirs", async () => {
    at("/cpc/verification", "central_placement_coordinator");
    expect(await screen.findByText(/belongs to the campus placement coordinator/i)).toBeDefined();
    expect(screen.queryByRole("heading", { name: /verification queue/i })).toBeNull();
  });

  it("tells the central coordinator the certificate queue is not theirs", async () => {
    at("/cpc/certificates", "central_placement_coordinator");
    expect(await screen.findByText(/belongs to the campus placement coordinator/i)).toBeDefined();
  });
});

describe("App routing", () => {
  it("sends a signed-out visitor to the login screen instead of any dashboard", () => {
    render(
      <AuthContext.Provider value={{ status: "signed-out" }}>
        <MemoryRouter initialEntries={["/student"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeDefined();
    expect(screen.queryByRole("heading", { level: 1, name: /welcome back/i })).toBeNull();
  });

  /**
   * Without this route an admin cannot create a campus, and with no campus
   * there is no roster, no student and no drive. It is the first link in the
   * chain, so it is pinned.
   */
  it("gives an admin a screen on which to create the first campus", async () => {
    render(
      <AuthContext.Provider value={signedIn("admin")}>
        <MemoryRouter initialEntries={["/admin/campuses"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: /campuses/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /add campus/i })).toBeDefined();
  });

  /**
   * SPEC CHANGE 2026-08-06. A student's landing is no longer decided by their
   * role alone: one who has not registered goes straight to the form
   * (`studentLandingRoute`). So "/" now resolves their standing first, and
   * only then routes.
   *
   * Here the lookup cannot succeed - there is no configured backend - which
   * exercises the fallback that matters most: a student whose standing we
   * cannot read must still land somewhere useful, never on a form that may be
   * the wrong screen for them.
   */
  it("resolves a student's standing before landing them, and falls back safely", async () => {
    render(
      <AuthContext.Provider value={signedIn("student")}>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    // Never a blank screen straight after signing in.
    expect(screen.getByRole("status").textContent).toMatch(/signing you in/i);

    // The student dashboard - not another role's screen - is what it settles on.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/loading your dashboard/i),
    );
  });

  it("renders the SRF outside the app shell, with its own chrome", async () => {
    render(
      <AuthContext.Provider value={signedIn("student")}>
        <MemoryRouter initialEntries={["/srf"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    // The route loads the student's roster record first, so the form arrives
    // asynchronously - identity is prefilled, never typed.
    expect(
      await screen.findByRole("heading", { level: 1, name: /student registration form/i }),
    ).toBeDefined();
    // No role switcher: the SRF is a focused, full-bleed page.
    expect(screen.queryByLabelText(/preview as/i)).toBeNull();
  });

  it("routes to attendance, which asks which round when none is given", () => {
    render(
      <AuthContext.Provider value={signedIn("campus_placement_coordinator")}>
        <MemoryRouter initialEntries={["/cpc/attendance"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    // Attendance is per-round and arrives as ?round=. Defaulting to some round
    // would risk marking the wrong one, so the screen asks instead.
    expect(screen.getByText(/choose a round/i)).toBeDefined();
  });
});

/**
 * The drive portfolio, requested 2026-08-04 for the two roles that own a drive
 * but had nowhere to follow it: the AE who raised it and the Delivery Head who
 * approved it.
 */
describe("the drive portfolio route", () => {
  it("gives an Account Executive their own drives", () => {
    render(
      <AuthContext.Provider value={signedIn("account_executive")}>
        <MemoryRouter initialEntries={["/my-drives"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByRole("status").textContent).toMatch(/loading your drives/i);
  });

  it("labels the same screen for the Delivery Head who approved them", async () => {
    render(
      <AuthContext.Provider value={signedIn("delivery_head")}>
        <MemoryRouter initialEntries={["/my-drives"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByRole("status").textContent).toMatch(/loading your drives/i);
  });
});
