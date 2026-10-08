// @vitest-environment jsdom
import { canPublishDrive, canShortlistFromPortfolio } from "@domain/drive-portfolio";
import type { AppRole } from "@domain/types";
import { AuthContext, type AuthState } from "@features/auth/require-auth";
import { AuthActionsContext } from "@lib/auth-context";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
/**
 * Renders the shell exactly as a user first sees it, with groups collapsed.
 * Used by the tests that are ABOUT collapsing.
 */
function shellCollapsed(
  auth: AuthState,
  signOut: () => Promise<void> = async () => {},
  path = "/dashboard",
) {
  return render(
    <AuthActionsContext.Provider value={{ signOut }}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <AppShell>content</AppShell>
        </MemoryRouter>
      </AuthContext.Provider>
    </AuthActionsContext.Provider>,
  );
}

/**
 * Renders the shell with every group opened.
 *
 * Since 2026-08-17 the sidebar collapses every group except the one in use, so
 * a link can now be missing for two very different reasons: the role does not
 * have it, or its heading is simply shut. Most tests here ask the FIRST
 * question - "is this destination offered to this role?" - and opening every
 * group is what keeps them asking it. The collapsing itself is pinned
 * separately, in "the sidebar groups collapse to the one in use".
 */
function shellFor(
  auth: AuthState,
  signOut: () => Promise<void> = async () => {},
  path = "/dashboard",
) {
  const result = shellCollapsed(auth, signOut, path);

  // Scoped to THIS render's container, not the document. The queries on a
  // render result are bound to document.body, and some tests render the shell
  // twice without unmounting - a document-wide query finds both navs and throws.
  const nav = within(result.container).queryByRole("navigation", { name: /main/i });
  if (nav !== null) {
    for (const button of within(nav).getAllByRole("button")) {
      if (button.getAttribute("aria-expanded") === "false") fireEvent.click(button);
    }
  }

  return result;
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
  /**
   * SPEC CHANGE 2026-08-18: the cockpit is no longer a named entry for anyone.
   * Every staff role reaches the same three lists, and "Yet to publish" IS the
   * cockpit - it keeps the publish action, which is gated by the domain rather
   * than by whose sidebar it appears in.
   */
  it("is reached by the Delivery Head through the shared Yet to publish list", () => {
    shellFor(signedIn("delivery_head"));
    expect(screen.getByRole("link", { name: /^yet to publish$/i }).getAttribute("href")).toBe(
      "/central/drives/yet-to-publish",
    );
  });

  /**
   * SPEC CHANGE 2026-08-17 (Karthik): "the AE should only be able to view the
   * students shortlisted or selected or their drive status and results. They
   * should not be able to publish drives or shortlist students."
   *
   * The cockpit is a work queue, and its work is publishing and shortlisting.
   * Offering it to the AE offered both. Their read-only view of the same
   * drives is the portfolio at /my-drives, which is still in their sidebar.
   */
  it("is no longer offered to the Account Executive, whose access is read-only", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.queryByRole("link", { name: /drive cockpit/i })).toBeNull();
  });

  it("leaves the Account Executive the same read-only lists as everyone else", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.getByRole("link", { name: /^live$/i })).toBeDefined();
  });

  /**
   * Nothing in the AE's sidebar may reach the publishing or shortlisting
   * SCREENS. Narrowed 2026-08-18 from a match on "publish" anywhere in the
   * href: the shared list at /central/drives/yet-to-publish contains that word
   * and is a read-only list - the publish action on it is gated by
   * `canPublishDrive`, which is false for an AE.
   */
  it("offers the Account Executive no route to publishing or shortlisting", () => {
    shellFor(signedIn("account_executive"));
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toMatch(/\/central\/publish|shortlist/i);
    }
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

  /**
   * 2026-08-26: the AE now HAS an overview — their own (`/ae/overview`), built
   * from their drives and the organisation's aggregate figures. What they
   * still must not be offered is THIS one, which is computed from the student
   * roster they cannot read.
   */
  it("does not offer the roster dashboard to an Account Executive", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).not.toContain(
      "/dashboard",
    );
  });

  it("is not offered to a student", () => {
    shellFor(signedIn("student"));
    expect(screen.queryByRole("link", { name: /overview/i })).toBeNull();
  });
});

describe("the drive portfolio", () => {
  /**
   * SPEC CHANGE 2026-08-18: "My drives" is gone as a label - it was the same
   * list RLS was already narrowing, and the heading claimed a distinction the
   * data did not have. Both roles still reach it, now called Live.
   */
  it("is offered to the Delivery Head", () => {
    shellFor(signedIn("delivery_head"));
    expect(screen.getByRole("link", { name: /^live$/i })).toBeDefined();
  });

  it("is offered to the Account Executive", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.getByRole("link", { name: /^live$/i })).toBeDefined();
  });

  it("is not offered to a student, who raises nothing", () => {
    shellFor(signedIn("student"));
    expect(screen.queryByRole("link", { name: /^live$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /my drives/i })).toBeNull();
  });
});

/**
 * 2026-08-12: the sidebar is grouped into logical heads for every role
 * (approved spec, docs/specs/2026-08-12-workflow-simplification.md).
 */
describe("the grouped sidebar", () => {
  it("groups the central coordinator's links under the approved heads", () => {
    shellFor(signedIn("central_placement_coordinator"));

    for (const heading of [
      /^drives$/i,
      // Renamed 2026-08-17: "Publish a drive" became "Student details".
      /student details/i,
      /drives in progress/i,
      /requests/i,
      /^overview$/i,
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeDefined();
    }
  });

  /**
   * SPEC CHANGE 2026-08-18: three tabs, not two. "approved is yet to publish …
   * we can have a third box, there called completed. This way we have three
   * tabs — approved = yet to publish; published - page name can be live;
   * completed. drafts can be removed."
   */
  it("gives the central coordinator exactly Yet to publish, Live and Completed", () => {
    shellFor(signedIn("central_placement_coordinator"));

    expect(screen.getByRole("link", { name: /yet to publish/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^live$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^completed$/i })).toBeDefined();
    // The cockpit is absorbed into those views, and "All drives" was the same
    // list a third time.
    expect(screen.queryByRole("link", { name: /drive cockpit/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^all drives$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^published$/i })).toBeNull();
  });

  it("gives the student a My profile entry — it was reachable only from the dashboard", () => {
    shellFor(signedIn("student"));
    expect(screen.getByRole("link", { name: /my profile/i })).toBeDefined();
  });

  it("calls the campus coordinator's queue Student verification", () => {
    shellFor(signedIn("campus_placement_coordinator"));
    expect(screen.getByRole("link", { name: /student verification/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /verification queue/i })).toBeNull();
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

    expect(screen.getByRole("link", { name: /yet to publish/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /my registration form/i })).toBeNull();
  });

  it("gives the campus coordinator the certificate queue", () => {
    shellFor(signedIn("campus_placement_coordinator"));
    expect(screen.getByRole("link", { name: /certificate verification/i })).toBeDefined();
  });

  /**
   * D3 (2026-08-12): verification belongs to the campus placement
   * coordinator ALONE. The Central CPC ran both queues while the seat was
   * empty; the seat is filled now and the client keeps it that way.
   */
  it("keeps BOTH verification queues out of the central coordinator's nav (D3)", () => {
    shellFor(signedIn("central_placement_coordinator"));
    expect(screen.queryByRole("link", { name: /certificate verification/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /student verification/i })).toBeNull();
  });

  it("keeps the certificate queue out of the student's nav", () => {
    shellFor(signedIn("student"));
    expect(screen.queryByRole("link", { name: /certificate verification/i })).toBeNull();
  });

  it("gives the central coordinator the skill repository, and nobody else's nav shows it", () => {
    shellFor(signedIn("central_placement_coordinator"));
    expect(screen.getByRole("link", { name: /skill repository/i })).toBeDefined();
  });

  it("keeps the skill repository out of the student's nav", () => {
    shellFor(signedIn("student"));
    expect(screen.queryByRole("link", { name: /skill repository/i })).toBeNull();
  });

  it("offers the AE the PIF", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.getByRole("link", { name: /position information form/i })).toBeDefined();
  });

  it("gives a student the drives area, not just a dashboard", () => {
    // N7 (2026-08-19): one entry named Drives; the four lists are its tabs.
    shellFor(signedIn("student"));
    expect(screen.getByRole("link", { name: /^drives$/i })).toBeDefined();
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
  /**
   * 2026-08-12 (approved assumption 3): the cockpit is absorbed into the two
   * pipeline views rather than kept as a third entry. The module is still
   * theirs — it is just split by what they were asked to see separately (D2).
   */
  it("offers the drive module as the three pipeline views", () => {
    shellFor(signedIn("central_placement_coordinator"));

    expect(screen.getByRole("link", { name: /yet to publish/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^live$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^completed$/i })).toBeDefined();
  });

  it("keeps the shortlisting entry the AE does not have", () => {
    shellFor(signedIn("central_placement_coordinator"));

    expect(screen.getByRole("link", { name: /shortlisting/i })).toBeDefined();
  });
});

/**
 * 2026-08-17 (Karthik), three asks about the sidebar:
 *
 *  1. "The size of heading is smaller than the lines below them. Headings are
 *     not prominent."
 *  2. "Collapse the sub headings that are not in use. Only the sub heading of
 *     the headings in use has to be expanded."
 *  3. "Overview can be the top item."
 *
 * The Central CPC saw eleven links under six headings, all open, with the
 * headings set smaller than the links they governed - so the one piece of
 * text that could have organised the list was the easiest to miss.
 */
describe("the sidebar groups collapse to the one in use", () => {
  /** The heading buttons, in the order they appear in the sidebar. */
  const groupHeadings = () =>
    within(screen.getByRole("navigation", { name: /main/i }))
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());

  it.each([
    ["central_placement_coordinator"],
    ["delivery_head"],
    ["admin"],
    ["campus_placement_coordinator"],
    ["ceo"],
  ] as const)("puts Overview first in the %s sidebar", (role) => {
    shellCollapsed(signedIn(role));
    expect(groupHeadings()[0]).toMatch(/overview/i);
  });

  /** The AE has no overview to promote, and must not grow one by accident. */
  it("gives the Account Executive no Overview group to put first", () => {
    shellCollapsed(signedIn("account_executive"), async () => {}, "/my-drives");
    expect(groupHeadings()).not.toContain("Overview");
  });

  /** The heading is a real control, so the reader can open a collapsed group. */
  it("makes each group heading a button that reports whether it is open", () => {
    shellCollapsed(signedIn("central_placement_coordinator"));
    expect(screen.getByRole("button", { name: /overview/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /overview/i }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("collapses the groups the reader is not in", () => {
    shellCollapsed(signedIn("central_placement_coordinator"));
    expect(
      screen.getByRole("button", { name: /student details/i }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByRole("link", { name: /skill repository/i })).toBeNull();
  });

  it("expands the group holding the current page instead", () => {
    shellCollapsed(signedIn("central_placement_coordinator"), async () => {}, "/central/skills");

    expect(
      screen.getByRole("button", { name: /student details/i }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByRole("link", { name: /skill repository/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^overview/i }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("opens a collapsed group when its heading is used", async () => {
    const user = userEvent.setup();
    shellCollapsed(signedIn("central_placement_coordinator"));

    expect(screen.queryByRole("link", { name: /skill repository/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /student details/i }));
    expect(screen.getByRole("link", { name: /skill repository/i })).toBeDefined();
  });

  /** Collapsing must never make a destination unreachable. */
  it("keeps every heading on screen even when its links are hidden", () => {
    shellCollapsed(signedIn("central_placement_coordinator"));
    // Exact names: "Drives" and "Drives in progress" are different headings,
    // and a loose match here would pass while the sidebar was wrong.
    for (const heading of [
      "Overview",
      "Drives",
      "Student details",
      "Drives in progress",
      "Requests",
    ]) {
      // A plain string is an exact match for an accessible name, so "Drives"
      // does not also match "Drives in progress".
      expect(screen.getByRole("button", { name: heading })).toBeDefined();
    }
  });
});

/**
 * 2026-08-17 (Karthik): "on the side bar, publish a drive heading and its
 * subheading publish and target is not required. We can instead create a
 * heading student details - under which we can have skill repository. Add one
 * more page to display details of all students part of the placement process."
 *
 * "Publish and target" was a dead entry: it needs a drive id, and opening it
 * from the sidebar only ever said "choose a drive from the drive cockpit".
 * Publishing is reached from the drive itself, under Yet to publish, which is
 * where a coordinator is already standing when they decide to publish.
 */
describe("Student details replaces Publish a drive", () => {
  it("no longer offers a bare Publish and target entry", () => {
    shellFor(signedIn("central_placement_coordinator"));
    expect(screen.queryByRole("link", { name: /publish and target/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish a drive" })).toBeNull();
  });

  it("groups the skill repository under Student details", () => {
    shellFor(signedIn("central_placement_coordinator"));
    expect(screen.getByRole("button", { name: "Student details" })).toBeDefined();
    expect(screen.getByRole("link", { name: /skill repository/i })).toBeDefined();
  });

  it("adds the all-students page under the same heading", () => {
    shellFor(signedIn("central_placement_coordinator"));
    const link = screen.getByRole("link", { name: /all students/i });
    expect(link.getAttribute("href")).toBe("/central/students");
  });

  /** Publishing must still be reachable — from the drive, not from a bare link. */
  it("keeps the yet-to-publish queue, which is how a drive gets published", () => {
    shellFor(signedIn("central_placement_coordinator"));
    expect(screen.getByRole("link", { name: /yet to publish/i })).toBeDefined();
  });

  it("does not offer the student directory to a role that cannot read students", () => {
    shellFor(signedIn("account_executive"), async () => {}, "/my-drives");
    expect(screen.queryByRole("link", { name: /all students/i })).toBeNull();
  });
});

/**
 * One Drives sidebar for everybody but the student (2026-08-18, Karthik):
 * "the side bar on drives should be similar for all people viewing it (other
 * than students). just the edit rights will be different. view on side bar
 * heading and subheading should be the same."
 *
 * The rights were never in the sidebar - `canPublishDrive`,
 * `canShortlistFromPortfolio` and `canViewDriveApplicants` decide those, and
 * none of them moves here. What changes is that the LABELS stop implying a
 * difference that does not exist: "My drives" and "Drives I approved" were the
 * same list, filtered by RLS either way.
 */
describe("the Drives group is the same for every staff role", () => {
  const STAFF_WITH_DRIVES: readonly AppRole[] = [
    "account_executive",
    "delivery_head",
    "central_placement_coordinator",
    "campus_placement_coordinator",
    "key_account_manager",
    "admin",
  ];

  it.each(STAFF_WITH_DRIVES)("gives %s exactly Yet to publish, Live and Completed", (role) => {
    shellFor(signedIn(role));

    expect(screen.getByRole("link", { name: /^yet to publish$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^live$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^completed$/i })).toBeDefined();
  });

  it.each(STAFF_WITH_DRIVES)("offers %s none of the old per-role drive labels", (role) => {
    shellFor(signedIn(role));

    expect(screen.queryByRole("link", { name: /^my drives$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /drives i approved/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /drive cockpit/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^all drives$/i })).toBeNull();
  });

  /** Explicitly NOT the student: they get four lists of their own (N7). */
  it("leaves the student's Drives heading alone", () => {
    shellFor(signedIn("student"));

    expect(screen.queryByRole("link", { name: /^yet to publish$/i })).toBeNull();
  });

  /**
   * The point of the parity: what each role may DO is unchanged, and that is
   * decided by the domain, not by which links they were shown.
   */
  it("does not hand anybody a right they did not have", () => {
    expect(canPublishDrive("account_executive")).toBe(false);
    expect(canPublishDrive("delivery_head")).toBe(false);
    expect(canPublishDrive("central_placement_coordinator")).toBe(true);
    expect(canShortlistFromPortfolio("account_executive")).toBe(false);
  });
});

/**
 * G3 (UAT 2026-08-20, Q6 answer a): the notifications page shipped on 19/08
 * but nothing in the sidebar reached it — a page nobody can navigate to may
 * as well not exist.
 */
describe("the student reaches their notifications from the sidebar", () => {
  it("offers the student a Notifications entry", () => {
    shellFor(signedIn("student"));
    expect(screen.getByRole("link", { name: /^notifications$/i }).getAttribute("href")).toBe(
      "/student/notifications",
    );
  });

  it("does not offer it to staff — the log is the student's own", () => {
    shellFor(signedIn("central_placement_coordinator"));
    expect(screen.queryByRole("link", { name: /^notifications$/i })).toBeNull();
  });
});

/**
 * 2026-08-26 (Karthik): "AE GETS a landing page". They opened on the Position
 * information form and had no overview at all — `/dashboard` is built on the
 * student roster, which an AE cannot read, so it would have greeted them with
 * "No students yet".
 */
describe("the Account Executive's landing page", () => {
  it("gives the AE an overview, first in their sidebar", () => {
    shellFor(signedIn("account_executive"));

    const overview = screen.getByRole("link", { name: /my overview/i });
    expect(overview.getAttribute("href")).toBe("/ae/overview");
  });

  it("does not send them to the roster-based dashboard", () => {
    shellFor(signedIn("account_executive"));

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toBe("/dashboard");
    }
  });

  it("gives it to nobody else", () => {
    for (const role of [
      "central_placement_coordinator",
      "delivery_head",
      "campus_placement_coordinator",
      "ceo",
    ] as const) {
      const { unmount } = shellFor(signedIn(role));
      expect(screen.queryByRole("link", { name: /my overview/i })).toBeNull();
      unmount();
    }
  });
});

describe("campus name display in sidebar", () => {
  it("shows the campus name for campus placement coordinator", () => {
    shellFor(signedIn("campus_placement_coordinator", ["Alliance University"]));
    expect(screen.getByText("Alliance University")).toBeDefined();
  });

  it("does not list the campus name below the role name for key account manager", () => {
    shellFor(signedIn("key_account_manager", ["Alliance University"]));
    expect(screen.queryByText("Alliance University")).toBeNull();
    expect(screen.queryByText(/no campus mapped/i)).toBeNull();
  });
});
