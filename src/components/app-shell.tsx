import { landingRouteForRole } from "@domain/auth-routing";
import { openGroupHeadings } from "@domain/navigation";
import { campusScopeFor } from "@domain/staff";
import { APP_ROLES, type AppRole } from "@domain/types";
import { isTestPreviewAllowed, useAuth, useAuthActions } from "@lib/auth-context";
import { type ReactNode, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";

/**
 * Application shell: brand header, role-scoped navigation.
 *
 * The role switcher exists ONLY in the mock, so the whole UI can be reviewed
 * without an auth backend. It is removed when real auth lands.
 */

export interface NavItem {
  readonly to: string;
  readonly label: string;
}

/**
 * 2026-08-12: the sidebar is grouped into logical heads for EVERY role
 * (approved spec, docs/specs/2026-08-12-workflow-simplification.md). The
 * heading is rendered, so it is part of the screen's accessible structure.
 */
export interface NavGroup {
  readonly heading: string;
  readonly items: readonly NavItem[];
}

/**
 * ONE Drives group, for every role that is not a student (2026-08-18, Karthik):
 * "the side bar on drives should be similar for all people viewing it (other
 * than students). just the edit rights will be different. view on side bar
 * heading and subheading should be the same."
 *
 * The rights were never in this file. `canPublishDrive`,
 * `canShortlistFromPortfolio` and `canViewDriveApplicants` decide what each
 * role may do, and none of them moves. What goes is a set of labels that
 * implied a difference that did not exist: "My drives" and "Drives I approved"
 * were the same list, narrowed by RLS either way, and the cockpit was a third
 * name for a subset of it.
 *
 * The student is deliberately excluded - they get four lists of their own.
 */
const DRIVES: NavGroup = {
  heading: "Drives",
  items: [
    { to: "/central/drives/yet-to-publish", label: "Yet to publish" },
    { to: "/central/drives/live", label: "Live" },
    { to: "/central/drives/completed", label: "Completed" },
  ],
};

export const ROLE_NAVS: Readonly<Record<AppRole, readonly NavGroup[]>> = {
  student: [
    {
      heading: "Home",
      items: [
        { to: "/student", label: "My dashboard" },
        // G3 (UAT 2026-08-20): the full, filterable log — reachable from the
        // sidebar, not only from the dashboard's "Read all" link.
        { to: "/student/notifications", label: "Notifications" },
      ],
    },
    // N7: one entry; the four lists are tabs inside it.
    { heading: "Drives", items: [{ to: "/student/drives", label: "Drives" }] },
    {
      heading: "My record",
      items: [
        { to: "/srf", label: "My registration form" },
        { to: "/student/profile", label: "My profile" },
      ],
    },
    // F2 (UAT 2026-08-06): two unrelated decisions, two entries. Opting out is
    // irreversible; an off-campus offer is a record. One bucket called "My
    // participation" invited them into the wrong one.
    {
      heading: "Requests",
      items: [
        { to: "/student/opt-out", label: "Opting out" },
        { to: "/student/off-campus", label: "Off-campus offer" },
      ],
    },
  ],
  // D3 (2026-08-12): verification — the registration form AND certificates —
  // is the campus placement coordinator's alone. RLS scopes them to their
  // campus.
  campus_placement_coordinator: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Campus overview" }] },
    {
      heading: "Verification",
      items: [
        { to: "/cpc/verification", label: "Student verification" },
        { to: "/cpc/certificates", label: "Certificate verification" },
        // 2026-08-24: semesters added after SRF approval, decided like
        // certificates — the queue Karthik reported missing.
        { to: "/cpc/semesters", label: "CGPA verification" },
      ],
    },
    // 2026-08-24 (Karthik): their students' details, view only. RLS scopes
    // the rows to their campuses; the skills page hides its editors.
    {
      heading: "Student details",
      items: [
        { to: "/central/students", label: "All students" },
        { to: "/central/skills", label: "Skill repository" },
      ],
    },
    DRIVES,
    {
      heading: "Drives in progress",
      items: [
        // D10: shortlist, every round, the offer — read-only, campus-scoped.
        // It stays: it answers "how are MY students doing", which is a
        // different question from "what is happening to this drive".
        { to: "/cpc/drives", label: "Drive progress" },
        { to: "/cpc/attendance", label: "Attendance" },
      ],
    },
    {
      heading: "Requests",
      items: [
        { to: "/cpc/opt-outs", label: "Opt-out requests" },
        { to: "/cpc/off-campus", label: "Off-campus offers" },
      ],
    },
  ],
  /**
   * The AE raises drives and then watches them. 2026-08-17 (Karthik): "the AE
   * should only be able to view the students shortlisted or selected or their
   * drive status and results. They should not be able to publish drives or
   * shortlist students."
   *
   * The drive cockpit was removed from here: it is a work queue whose work is
   * publishing and shortlisting, so offering it offered both. `/my-drives`
   * answers every question the AE actually has - status, applicants, who was
   * shortlisted, who was selected - and answers it read-only.
   */
  account_executive: [
    /*
     * 2026-08-26 (Karthik): "AE GETS a landing page". Their own, not the
     * shared `/dashboard` — that screen is computed from the student roster,
     * which an AE cannot read (0018), so it would have greeted them with
     * "No students yet. Import a campus roster to begin."
     */
    { heading: "Overview", items: [{ to: "/ae/overview", label: "My overview" }] },
    {
      heading: "Drive initiation",
      items: [{ to: "/ae/pif", label: "Position information form" }],
    },
    DRIVES,
  ],
  campus_manager: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Campus overview" }] },
    DRIVES,
    {
      heading: "Drives in progress",
      items: [{ to: "/cpc/drives", label: "Drive progress" }],
    },
    // 2026-08-24 (Karthik): view-only student details, campus-scoped by RLS.
    {
      heading: "Student details",
      items: [
        { to: "/central/students", label: "All students" },
        { to: "/central/skills", label: "Skill repository" },
      ],
    },
  ],
  key_account_manager: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Account overview" }] },
    DRIVES,
    {
      heading: "Drives in progress",
      items: [{ to: "/cpc/drives", label: "Drive progress" }],
    },
    // 2026-08-24 (Karthik): view-only student details for their campuses.
    {
      heading: "Student details",
      items: [
        { to: "/central/students", label: "All students" },
        { to: "/central/skills", label: "Skill repository" },
      ],
    },
  ],
  enterprise_relations: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Overview" }] },
    DRIVES,
    {
      heading: "Drives in progress",
      items: [{ to: "/cpc/drives", label: "Drive progress" }],
    },
  ],
  er_head: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Overview" }] },
    DRIVES,
    {
      heading: "Drives in progress",
      items: [{ to: "/cpc/drives", label: "Drive progress" }],
    },
  ],
  ceo: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Executive overview" }] },
    DRIVES,
    {
      heading: "Drives in progress",
      items: [{ to: "/cpc/drives", label: "Drive progress" }],
    },
  ],
  // Approving a PIF used to be the end of the Delivery Head's visibility.
  delivery_head: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Placement overview" }] },
    {
      heading: "Drive approval",
      items: [{ to: "/delivery-head/pif-approvals", label: "PIF approvals" }],
    },
    // 2026-08-24 (Karthik): view-only student details, org-wide (is_org_reader).
    {
      heading: "Student details",
      items: [
        { to: "/central/students", label: "All students" },
        { to: "/central/skills", label: "Skill repository" },
      ],
    },
    DRIVES,
    {
      heading: "Drives in progress",
      items: [{ to: "/cpc/drives", label: "Drive progress" }],
    },
  ],
  central_placement_coordinator: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Placement overview" }] },
    // D2: approval stays with the Delivery Head; the Central CPC sees what is
    // waiting to be published and what already is, separately. The old
    // cockpit is absorbed into those two views.
    /**
     * Three tabs, 2026-08-18 (Karthik): "approved is yet to publish. these
     * should be in yet to publish … we can have a third box, there called
     * completed. This way we have three tabs — approved = yet to publish;
     * published - page name can be live; completed. drafts can be removed."
     *
     * "All drives" is gone: it was the same list a third time, and the design it
     * carried is now what Live and Completed are built from.
     */
    DRIVES,
    /**
     * 2026-08-17 (Karthik): "publish a drive heading and its subheading publish
     * and target is not required. We can instead create a heading student
     * details - under which we can have skill repository."
     *
     * "Publish and target" was a dead entry from here: the screen needs a
     * drive id, so opening it from the sidebar only ever said "choose a drive
     * from the drive cockpit". Publishing is reached from the drive itself,
     * under Yet to publish - which is where the coordinator already is when
     * they decide to publish it. The route still exists; only the bare link
     * has gone.
     */
    {
      heading: "Student details",
      items: [
        { to: "/central/students", label: "All students" },
        // PRD §5: view-only reference; feeds the shortlisting rank.
        { to: "/central/skills", label: "Skill repository" },
        // 2026-08-24 (answers 1a/2a/3a): the master list of assessed skills —
        // template columns, upload validation and the PIF picker all read it.
        { to: "/central/skills-assessed", label: "Skills assessed" },
      ],
    },
    {
      heading: "Drives in progress",
      items: [
        { to: "/cpc/drives", label: "Drive progress" },
        { to: "/central/shortlisting", label: "Shortlisting" },
        { to: "/central/results", label: "Rounds & results" },
        { to: "/cpc/attendance", label: "Attendance" },
        { to: "/central/offers", label: "Final selection" },
      ],
    },
    // D3: no verification queues here — they are the campus CPC's alone.
    {
      heading: "Requests",
      items: [
        { to: "/cpc/opt-outs", label: "Opt-out requests" },
        { to: "/cpc/off-campus", label: "Off-campus offers" },
      ],
    },
  ],
  admin: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Placement overview" }] },
    DRIVES,
    {
      heading: "Organisation",
      items: [
        { to: "/admin/campuses", label: "Campuses" },
        { to: "/admin/staff", label: "Staff" },
        // F6: degrees and branches belong to a college, under Campuses.
        // Renamed 2026-08-17: the page is named for what it does, not for
        // the file it happens to eat.
        { to: "/admin/roster", label: "Add students" },
      ],
    },
  ],
};

/** Every route a role's sidebar links to, group structure flattened away. */
export function navItemsFor(role: AppRole): readonly NavItem[] {
  return (ROLE_NAVS[role] ?? []).flatMap((group) => group.items);
}

/** Labels for the development-only preview switcher. */
const PREVIEW_ROLES: readonly AppRole[] = APP_ROLES;

function Logo() {
  return (
    <img
      src="/brand/faceprep-campus-dark.png"
      alt="FACE Prep Campus"
      className="h-7 w-auto sm:h-8"
    />
  );
}

/** Initials from the signed-in address: the account badge must not lie. */
function initialsOf(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const auth = useAuth();
  const { signOut, setPreviewRole } = useAuthActions();
  const signedInRole = auth.status === "signed-in" ? auth.role : "student";
  const actualRole = auth.status === "signed-in" ? (auth.actualRole ?? auth.role) : "student";
  const signedInEmail = auth.status === "signed-in" ? auth.email : "";
  const campuses = auth.status === "signed-in" ? auth.campuses : [];

  // Role switcher is enabled for local DEV or for test users specifically on pms-test-gamma.vercel.app
  const previewable = isTestPreviewAllowed(signedInEmail);
  const [localPreview, setLocalPreview] = useState<AppRole | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const role = auth.status === "signed-in" ? auth.role : (localPreview ?? "student");
  const groups = ROLE_NAVS[role] ?? [];

  /**
   * 2026-08-17 (Karthik): "Collapse the sub headings that are not in use. Only
   * the sub heading of the headings in use has to be expanded."
   *
   * Which group that is, is `openGroupHeadings`' decision.
   *
   * The reader's own clicks are held as OVERRIDES on top of that answer, not
   * as the state itself. State seeded once from the first path would freeze on
   * wherever they happened to land, and the open group has to follow them as
   * they navigate. Overrides are stamped with the path they were made on, so
   * navigating away drops them and the location decides again.
   *
   * Several groups may be open at once. This is not an accordion: shutting a
   * group the reader deliberately opened, because they opened another one, is
   * the sort of helpfulness that loses people their place.
   */
  const { pathname } = useLocation();
  const [overrides, setOverrides] = useState<{
    path: string;
    open: Record<string, boolean>;
  }>({ path: pathname, open: {} });

  const active = openGroupHeadings(groups, pathname);
  const effective = overrides.path === pathname ? overrides.open : {};
  const isOpen = (heading: string) => effective[heading] ?? active.includes(heading);
  const toggleGroup = (heading: string) =>
    setOverrides({ path: pathname, open: { ...effective, [heading]: !isOpen(heading) } });

  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? "bg-brand-500 text-white" : "text-ink-700 hover:bg-brand-50 hover:text-brand-600"
    }`;

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        {/* Brand gradient hairline — the logo's own palette, used sparingly. */}
        <div className="fpc-gradient h-1" aria-hidden="true" />
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <button
            type="button"
            className="rounded-lg p-1.5 text-ink-700 hover:bg-surface-muted lg:hidden"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span aria-hidden="true" className="block text-lg leading-none">
              {menuOpen ? "✕" : "☰"}
            </span>
          </button>

          <Logo />

          <div className="ml-auto flex items-center gap-3">
            {previewable && (
              <>
                <label
                  className="hidden text-xs font-medium text-ink-500 sm:block"
                  htmlFor="role-switch"
                >
                  Preview as
                </label>
                {/* Hidden on phones like its label: it made the DEV header
                    ~535px wide on a 412px viewport, so mobile Chrome zoomed
                    the whole app out to fit — which is what made every tap
                    near the fold flaky in the student journey (2026-08-19). */}
                <select
                  id="role-switch"
                  className="hidden rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700 focus:border-brand-500 focus:outline-none sm:block cursor-pointer"
                  value={role}
                  onChange={(e) => {
                    const next = e.target.value as AppRole;
                    setLocalPreview(next);
                    if (setPreviewRole) {
                      setPreviewRole(next === actualRole ? null : next);
                    }
                    navigate(landingRouteForRole(next));
                  }}
                >
                  {PREVIEW_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </>
            )}
            <span
              title={signedInEmail}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white"
            >
              {initialsOf(signedInEmail)}
            </span>

            {/* Campus machines are shared. Leaving no way out means the next
                person to open the browser is signed in as the last one. */}
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-muted"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <nav
          aria-label="Main"
          className={`${menuOpen ? "block" : "hidden"} w-full shrink-0 lg:block lg:w-60`}
        >
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-300">
            {role.replaceAll("_", " ")}
          </p>
          {/*
           * The campus sits under the role because for these roles it IS part
           * of the role: a coordinator verifies their own campus's students
           * and nobody else's. Mapped to nothing, every queue they open is
           * empty - which reads as a quiet week rather than a broken account,
           * so it says so outright.
           */}
          {campusScopeFor(role) !== "none" &&
            role !== "key_account_manager" &&
            (campuses.length > 0 ? (
              <p className="px-3 text-sm font-medium text-ink-700">{campuses.join(" · ")}</p>
            ) : (
              <p className="px-3 text-sm font-medium text-destructive">
                No campus mapped — ask an Admin
              </p>
            ))}
          <div className="mb-2" />
          {groups.map((group) => {
            const open = isOpen(group.heading);
            return (
              <section key={group.heading} className="mb-1">
                {/*
                 * The heading is now the control, and it is BIGGER and darker
                 * than the links it governs (Karthik, 2026-08-17: "the size of
                 * heading is smaller than the lines below them. Headings are
                 * not prominent."). It was 11px uppercase accent over 14px
                 * links - the one piece of text that organised the list was
                 * the easiest thing in it to miss.
                 */}
                <h2 className="font-heading">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleGroup(group.heading)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-base font-bold text-ink-900 transition-colors hover:bg-brand-50"
                  >
                    <span>{group.heading}</span>
                    <span
                      aria-hidden="true"
                      className={`text-xs text-ink-400 transition-transform ${open ? "rotate-90" : ""}`}
                    >
                      ›
                    </span>
                  </button>
                </h2>

                {open && (
                  <ul className="mb-3 flex flex-col gap-1 border-l-2 border-line pl-2">
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={linkClass}
                          onClick={() => setMenuOpen(false)}
                        >
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </nav>

        <main className={`min-w-0 flex-1 ${menuOpen ? "hidden lg:block" : "block"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
