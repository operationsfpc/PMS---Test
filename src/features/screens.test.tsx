// @vitest-environment jsdom

import { AppShell } from "@components/app-shell";
import type { AppRole } from "@domain/types";
import { SrfVerificationQueue } from "@features/cpc/srf-verification-queue";
import { PifApprovalQueue } from "@features/delivery-head/pif-approval-queue";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("switches navigation when previewing a different role", async () => {
    routed(<AppShell>content</AppShell>);
    expect(screen.getByRole("link", { name: /my dashboard/i })).toBeDefined();

    await userEvent.selectOptions(
      screen.getByLabelText(/preview as/i),
      screen.getByRole("option", { name: /delivery head/i }),
    );

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
    await userEvent.click(screen.getByRole("link", { name: /my dashboard/i }));
    expect(screen.getByRole("button", { name: /open navigation/i })).toBeDefined();
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
