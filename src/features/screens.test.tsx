// @vitest-environment jsdom

import { AppShell } from "@components/app-shell";
import type { AppRole } from "@domain/types";
import { ShortlistingWorkspace } from "@features/central-cpc/shortlisting-workspace";
import { SrfVerificationQueue } from "@features/cpc/srf-verification-queue";
import { PifApprovalQueue } from "@features/delivery-head/pif-approval-queue";
import { StudentDashboard } from "@features/student/student-dashboard";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../app";
import { AuthContext, type AuthState } from "./auth/require-auth";

const signedIn = (role: AppRole): AuthState => ({
  status: "signed-in",
  role,
  email: "test@example.com",
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

describe("StudentDashboard", () => {
  it("explains the category ladder to a placed student", () => {
    // PRD §7.5 is confusing if unexplained: a placed student suddenly sees
    // fewer drives. The UI must say why.
    const { container } = routed(<StudentDashboard />);
    // The sentence is broken up by <strong>, so match on normalised text content.
    const text = container.textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toMatch(/only see new drives above the Dream category/i);
  });

  it("shows the absence count against the limit", () => {
    routed(<StudentDashboard />);
    expect(screen.getByText("1 of 3")).toBeDefined();
  });
});

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

describe("ShortlistingWorkspace", () => {
  it("states that ranking and rationale are internal only (PRD §13.1)", () => {
    routed(<ShortlistingWorkspace />);
    const note = screen.getByRole("note");
    expect(within(note).getByText(/internal only/i)).toBeDefined();
    expect(note.textContent).toMatch(/never visible to students/i);
  });

  it("shows a rationale for every ranked candidate", () => {
    routed(<ShortlistingWorkspace />);
    const why = screen.getByRole("columnheader", { name: /why/i });
    expect(why).toBeDefined();
    expect(screen.getByText(/top coding score/i)).toBeDefined();
  });

  it("keeps the export count in step with the selection", async () => {
    routed(<ShortlistingWorkspace />);
    expect(screen.getByRole("button", { name: /export 2 to recruiter/i })).toBeDefined();

    await userEvent.click(
      screen.getByRole("checkbox", { name: /include vikram iyer in the recruiter export/i }),
    );
    expect(screen.getByRole("button", { name: /export 3 to recruiter/i })).toBeDefined();
  });

  it("offers the forward-all shortcut (PRD §13.1)", () => {
    routed(<ShortlistingWorkspace />);
    expect(screen.getByRole("button", { name: /forward all applicants/i })).toBeDefined();
  });
});

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

  it("lands a student on their dashboard, via the domain landing rule", () => {
    render(
      <AuthContext.Provider value={signedIn("student")}>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: /welcome back/i })).toBeDefined();
  });

  it("renders the SRF outside the app shell, with its own chrome", () => {
    render(
      <AuthContext.Provider value={signedIn("student")}>
        <MemoryRouter initialEntries={["/srf"]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: /student registration form/i }),
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
