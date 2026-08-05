// @vitest-environment jsdom
import type { AppRole } from "@domain/types";
import { AuthContext, type AuthState } from "@features/auth/require-auth";
import { AuthActionsContext } from "@lib/auth-context";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

/**
 * Navigation must follow the SIGNED-IN role, not a preview control.
 *
 * The role switcher is a development convenience for reviewing screens without
 * a database. Shipping it would let any signed-in user navigate into another
 * role's screens: RLS would return nothing, but offering the route at all is
 * misleading and invites support tickets about "broken" pages.
 */
function shellFor(auth: AuthState, signOut: () => Promise<void> = async () => {}) {
  return render(
    <AuthActionsContext.Provider value={{ signOut }}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <AppShell>content</AppShell>
        </MemoryRouter>
      </AuthContext.Provider>
    </AuthActionsContext.Provider>,
  );
}

const signedIn = (role: AppRole, campuses: readonly string[] = []): AuthState => ({
  status: "signed-in",
  role,
  email: "x@example.com",
  campuses,
});

afterEach(() => vi.unstubAllEnvs());

/**
 * Signing out.
 *
 * There was no way to do it at all: the only route out of a session was
 * clearing site data by hand. On a shared campus machine that is a real
 * exposure - the next person to open the browser is signed in as the last.
 */
describe("signing out", () => {
  it("offers every signed-in role a way out", () => {
    for (const role of ["student", "admin", "account_executive"] as const) {
      const { unmount } = shellFor(signedIn(role));
      expect(screen.getByRole("button", { name: /sign out/i })).toBeDefined();
      unmount();
    }
  });

  it("ends the session when used", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    shellFor(signedIn("admin"), signOut);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

/**
 * Requested 2026-08-04: the drive cockpit is not the Central CPC's alone.
 *
 * The Delivery Head approves PIFs and then had nowhere to see what became of
 * them, and the AE who raised a drive could not follow it either. RLS already
 * decides what each of them actually gets back - the Delivery Head reads every
 * drive, the AE only their own - so this is a navigation gap, not a new
 * permission.
 */
describe("the drive cockpit", () => {
  it("is offered to the Delivery Head, who approves the drives", () => {
    shellFor(signedIn("delivery_head"));
    expect(screen.getByRole("link", { name: /drive cockpit/i })).toBeDefined();
  });

  it("is offered to the Account Executive, who raises them", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.getByRole("link", { name: /drive cockpit/i })).toBeDefined();
  });

  it("is still not offered to a student", () => {
    shellFor(signedIn("student"));
    expect(screen.queryByRole("link", { name: /drive cockpit/i })).toBeNull();
  });
});

/**
 * Requested 2026-08-04: the Delivery Head and the AE should see "all drives
 * they have raised/approved, applicants to the drive, the progress of the
 * drives". The cockpit shows every drive; this is theirs.
 */
/**
 * Requested 2026-08-05: dashboards "for all relevant stakeholders".
 *
 * The coordinators who do the work had no overview at all - they could see
 * their own queues and nothing about how the cohort was doing. RLS decides
 * what each of them gets back, so the Campus CPC sees their campus and the
 * Central CPC sees the organisation.
 *
 * The AE is deliberately excluded: they have no read policy on students, so a
 * placement overview would render zeroes and look broken. Their drives are
 * their view.
 */
describe("the placement overview", () => {
  it.each([
    ["campus_placement_coordinator"],
    ["central_placement_coordinator"],
    ["admin"],
    ["campus_manager"],
    ["key_account_manager"],
    ["ceo"],
  ] as const)("is offered to %s", (role) => {
    shellFor(signedIn(role));
    expect(screen.getByRole("link", { name: /overview/i })).toBeDefined();
  });

  it("is not offered to an Account Executive, who cannot read students", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.queryByRole("link", { name: /overview/i })).toBeNull();
  });

  it("is not offered to a student", () => {
    shellFor(signedIn("student"));
    expect(screen.queryByRole("link", { name: /overview/i })).toBeNull();
  });
});

describe("the drive portfolio", () => {
  it("is offered to the Delivery Head", () => {
    shellFor(signedIn("delivery_head"));
    expect(screen.getByRole("link", { name: /my drives/i })).toBeDefined();
  });

  it("is offered to the Account Executive", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.getByRole("link", { name: /my drives/i })).toBeDefined();
  });

  it("is not offered to a student, who raises nothing", () => {
    shellFor(signedIn("student"));
    expect(screen.queryByRole("link", { name: /my drives/i })).toBeNull();
  });
});

describe("AppShell navigation", () => {
  it("shows a student their own links", () => {
    shellFor(signedIn("student"));

    expect(screen.getByRole("link", { name: /my registration form/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /drive cockpit/i })).toBeNull();
  });

  it("shows the central coordinator their own links, and not the student's", () => {
    shellFor(signedIn("central_placement_coordinator"));

    expect(screen.getByRole("link", { name: /drive cockpit/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /my registration form/i })).toBeNull();
  });

  it("offers the AE the PIF", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.getByRole("link", { name: /position information form/i })).toBeDefined();
  });

  it("gives a student the drives list, not just a dashboard", () => {
    shellFor(signedIn("student"));
    expect(screen.getByRole("link", { name: /open drives/i })).toBeDefined();
  });

  it("gives a CEO their read-only overview", () => {
    shellFor(signedIn("ceo"));
    expect(screen.getByRole("link", { name: /executive overview/i })).toBeDefined();
  });

  /** The reporting roles share one dashboard, labelled for each of them. */
  it("labels the shared dashboard for the role reading it", () => {
    shellFor(signedIn("campus_manager"));
    expect(screen.getByRole("link", { name: /campus overview/i })).toBeDefined();
  });
});

describe("the preview-as switcher", () => {
  it("is available in development, where there may be no database", () => {
    vi.stubEnv("DEV", true);
    shellFor(signedIn("student"));
    expect(screen.getByLabelText(/preview as/i)).toBeDefined();
  });

  it("is never shipped to production", () => {
    vi.stubEnv("DEV", false);
    shellFor(signedIn("student"));
    expect(screen.queryByLabelText(/preview as/i)).toBeNull();
  });
});

/**
 * The avatar was hardcoded to "PR", a leftover from the mock era. It told
 * every signed-in user they were someone else, which is a small lie the whole
 * session then rests on.
 */
describe("the account avatar", () => {
  it("shows the signed-in user's own initials", () => {
    shellFor({
      status: "signed-in",
      role: "admin",
      email: "karthikraja@faceprep.in",
      campuses: [],
    });
    expect(screen.getByTitle(/karthikraja@faceprep.in/i).textContent).toBe("KA");
  });

  it("does not show one fixed set of initials to everybody", () => {
    shellFor({ status: "signed-in", role: "student", email: "priya@gmail.com", campuses: [] });
    expect(screen.getByTitle(/priya@gmail.com/i).textContent).toBe("PR");

    shellFor({ status: "signed-in", role: "admin", email: "arjun@faceprep.in", campuses: [] });
    expect(screen.getByTitle(/arjun@faceprep.in/i).textContent).toBe("AR");
  });
});

/**
 * F2 (UAT 2026-08-06): "Keep these two as separate heads for student and
 * Central PC. nOW THEY ARE in one bucket in side bar." And F5's page: "Opt out
 * and Off campus offers should be different tabs."
 *
 * They are two unrelated decisions. Opting out is irreversible and removes the
 * student from everything; recording an off-campus offer changes nothing about
 * their eligibility. One nav item called "Opt-outs & offers" invited a student
 * to open the wrong one.
 */
describe("opting out and off-campus offers are separate heads", () => {
  it("gives the student one entry for each", () => {
    shellFor(signedIn("student"));

    expect(screen.getByRole("link", { name: /opting out/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /off-campus offer/i })).toBeDefined();
  });

  it("does not put them in one bucket for the student", () => {
    shellFor(signedIn("student"));

    expect(screen.queryByRole("link", { name: /opt-outs & offers/i })).toBeNull();
  });

  it("gives the Central Placement Coordinator one entry for each", () => {
    shellFor(signedIn("central_placement_coordinator"));

    expect(screen.getByRole("link", { name: /opt-out requests/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /off-campus offers/i })).toBeDefined();
  });

  it("gives the campus coordinator one entry for each too", () => {
    shellFor(signedIn("campus_placement_coordinator", ["Alliance"]));

    expect(screen.getByRole("link", { name: /opt-out requests/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /off-campus offers/i })).toBeDefined();
  });

  it("sends each entry to its own screen", () => {
    shellFor(signedIn("student"));

    expect(screen.getByRole("link", { name: /opting out/i }).getAttribute("href")).toBe(
      "/student/opt-out",
    );
    expect(screen.getByRole("link", { name: /off-campus offer/i }).getAttribute("href")).toBe(
      "/student/off-campus",
    );
  });
});

/**
 * F6 (UAT 2026-08-06): "A separate page for degree and branches is not
 * required for the admin. This is always mapped to colleges for a particular
 * year of Passing."
 */
describe("degrees and branches are not their own page", () => {
  it("is gone from the Admin's navigation", () => {
    shellFor(signedIn("admin"));

    expect(screen.queryByRole("link", { name: /degrees & branches/i })).toBeNull();
  });

  it("still offers the colleges they are now maintained under", () => {
    shellFor(signedIn("admin"));

    expect(screen.getByRole("link", { name: /campuses/i })).toBeDefined();
  });
});

/**
 * F15 (UAT 2026-08-06): "The drive module of view present for the account
 * executive must be the present for Central Placement Coordinator with
 * shortlisting access."
 */
describe("the Central Placement Coordinator's drive module", () => {
  it("offers the same drive cockpit the AE has", () => {
    shellFor(signedIn("central_placement_coordinator"));

    expect(screen.getByRole("link", { name: /drive cockpit/i })).toBeDefined();
  });

  it("keeps the shortlisting entry the AE does not have", () => {
    shellFor(signedIn("central_placement_coordinator"));

    expect(screen.getByRole("link", { name: /shortlisting/i })).toBeDefined();
  });
});
