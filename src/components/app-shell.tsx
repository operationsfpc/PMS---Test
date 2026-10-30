import { landingRouteForRole } from "@domain/auth-routing";
import { openGroupHeadings } from "@domain/navigation";
import { campusScopeFor } from "@domain/staff";
import { APP_ROLES, type AppRole } from "@domain/types";
import { useAuth, useAuthActions } from "@lib/auth-context";
import {
  Archive,
  Award,
  BadgeCheck,
  Bell,
  BookOpen,
  Briefcase,
  Building,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  CircleUser,
  ClipboardCheck,
  ClipboardList,
  Contact,
  FileCheck2,
  FileText,
  GraduationCap,
  House,
  Inbox,
  LayoutDashboard,
  LineChart,
  ListChecks,
  LogOut,
  type LucideIcon,
  Menu,
  Plane,
  Radio,
  Send,
  ShieldCheck,
  Star,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Upload,
  User,
  UserCog,
  Users,
  UserX,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { Button, Card } from "./ui";

/**
 * Application shell: brand header, role-scoped navigation.
 *
 * The role switcher exists ONLY in the mock, so the whole UI can be reviewed
 * without an auth backend. It is removed when real auth lands.
 *
 * Every entry carries an icon (#71, 2026-10-18: "all roles sidebar ui not nice?
 * make is shadcn ui components with icons? im mentioning menu bar"). The icon is
 * decoration, so each one is `aria-hidden`: the accessible name of a row stays
 * exactly its label, which is what the pinned navigation assertions match on.
 */
export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

/**
 * 2026-08-12: the sidebar is grouped into logical heads for EVERY role
 * (approved spec, docs/specs/2026-08-12-workflow-simplification.md). The
 * heading is rendered, so it is part of the screen's accessible structure.
 */
export interface NavGroup {
  readonly heading: string;
  readonly icon: LucideIcon;
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
 * The student is deliberately excluded — their Drives area is its own page.
 */
const DRIVES: NavGroup = {
  heading: "Drives",
  icon: Briefcase,
  items: [
    { to: "/central/drives/yet-to-publish", label: "Yet to publish", icon: Send },
    { to: "/central/drives/live", label: "Live", icon: Radio },
    { to: "/central/drives/completed", label: "Completed", icon: Archive },
  ],
};

/**
 * The roster and the skill reference, view-only. Every role that reaches it is
 * in `is_org_reader()` (0018) or scoped by campus, so the link is never a door
 * onto a page that then says it cannot read the rows.
 */
const STUDENT_DETAILS: NavGroup = {
  heading: "Student details",
  icon: Users,
  items: [
    { to: "/central/students", label: "All students", icon: Users },
    { to: "/central/skills", label: "Skill repository", icon: BookOpen },
  ],
};

export const ROLE_NAVS: Readonly<Record<AppRole, readonly NavGroup[]>> = {
  student: [
    {
      heading: "Home",
      icon: House,
      items: [
        { to: "/student", label: "My dashboard", icon: LayoutDashboard },
        // G3 (UAT 2026-08-20): the full, filterable log — reachable from the
        // sidebar, not only from the dashboard's "Read all" link.
        { to: "/student/notifications", label: "Notifications", icon: Bell },
      ],
    },
    // N7: one entry; the four lists are tabs inside it.
    {
      heading: "Drives",
      icon: Briefcase,
      items: [{ to: "/student/drives", label: "Drives", icon: CalendarDays }],
    },
    {
      heading: "My record",
      icon: Contact,
      items: [
        { to: "/srf", label: "My registration form", icon: FileText },
        { to: "/student/profile", label: "My profile", icon: User },
      ],
    },
    // F2 (UAT 2026-08-06): two unrelated decisions, two entries. Opting out is
    // irreversible; an off-campus offer is a record. One bucket called "My
    // participation" invited them into the wrong one.
    {
      heading: "Requests",
      icon: Inbox,
      items: [
        { to: "/student/opt-out", label: "Opting out", icon: UserX },
        { to: "/student/off-campus", label: "Off-campus offer", icon: Plane },
      ],
    },
  ],
  // D3 (2026-08-12): verification — the registration form AND certificates —
  // is the campus placement coordinator's alone. RLS scopes them to their
  // campus.
  campus_placement_coordinator: [
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/dashboard", label: "Campus overview", icon: LineChart }],
    },
    {
      heading: "Verification",
      icon: ShieldCheck,
      items: [
        { to: "/cpc/verification", label: "Student verification", icon: FileCheck2 },
        { to: "/cpc/certificates", label: "Certificate verification", icon: BadgeCheck },
        // 2026-08-24: semesters added after SRF approval, decided like
        // certificates — the queue Karthik reported missing.
        { to: "/cpc/semesters", label: "CGPA verification", icon: GraduationCap },
      ],
    },
    // 2026-08-24 (Karthik): their students' details, view only. RLS scopes
    // the rows to their campuses; the skills page hides its editors.
    {
      heading: "Student details",
      icon: Users,
      items: [
        { to: "/central/students", label: "All students", icon: Users },
        { to: "/central/skills", label: "Skill repository", icon: BookOpen },
      ],
    },
    DRIVES,
    {
      heading: "Drives in progress",
      icon: ListChecks,
      items: [
        // D10: shortlist, every round, the offer — read-only, campus-scoped.
        // It stays: it answers "how are MY students doing", which is a
        // different question from "what is happening to this drive".
        { to: "/cpc/drives", label: "Drive progress", icon: TrendingUp },
        // 0122: choosing which of their own students advance is theirs too,
        // so the screen they can now write from is reachable from here.
        { to: "/central/shortlisting", label: "Shortlisting", icon: Star },
        { to: "/cpc/attendance", label: "Attendance", icon: CalendarCheck },
      ],
    },
    {
      heading: "Requests",
      icon: Inbox,
      items: [
        { to: "/cpc/opt-outs", label: "Opt-out requests", icon: UserX },
        { to: "/cpc/off-campus", label: "Off-campus offers", icon: Plane },
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
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/ae/overview", label: "My overview", icon: LineChart }],
    },
    {
      heading: "Drive initiation",
      icon: ClipboardList,
      items: [{ to: "/ae/pif", label: "Position information form", icon: FileText }],
    },
    DRIVES,
  ],
  campus_manager: [
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/dashboard", label: "Campus overview", icon: LineChart }],
    },
    DRIVES,
    {
      heading: "Drives in progress",
      icon: ListChecks,
      items: [{ to: "/cpc/drives", label: "Drive progress", icon: TrendingUp }],
    },
    // 2026-08-24 (Karthik): view-only student details, campus-scoped by RLS.
    {
      heading: "Student details",
      icon: Users,
      items: [
        { to: "/central/students", label: "All students", icon: Users },
        { to: "/central/skills", label: "Skill repository", icon: BookOpen },
      ],
    },
  ],
  key_account_manager: [
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/dashboard", label: "Account overview", icon: LineChart }],
    },
    DRIVES,
    {
      heading: "Drives in progress",
      icon: ListChecks,
      items: [{ to: "/cpc/drives", label: "Drive progress", icon: TrendingUp }],
    },
    // 2026-08-24 (Karthik): view-only student details for their campuses.
    {
      heading: "Student details",
      icon: Users,
      items: [
        { to: "/central/students", label: "All students", icon: Users },
        { to: "/central/skills", label: "Skill repository", icon: BookOpen },
      ],
    },
  ],
  enterprise_relations: [
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/dashboard", label: "Overview", icon: LineChart }],
    },
    DRIVES,
    {
      heading: "Drives in progress",
      icon: ListChecks,
      items: [{ to: "/cpc/drives", label: "Drive progress", icon: TrendingUp }],
    },
    STUDENT_DETAILS,
  ],
  er_head: [
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/dashboard", label: "Overview", icon: LineChart }],
    },
    DRIVES,
    {
      heading: "Drives in progress",
      icon: ListChecks,
      items: [{ to: "/cpc/drives", label: "Drive progress", icon: TrendingUp }],
    },
    STUDENT_DETAILS,
  ],
  ceo: [
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/dashboard", label: "Executive overview", icon: LineChart }],
    },
    DRIVES,
    {
      heading: "Drives in progress",
      icon: ListChecks,
      items: [{ to: "/cpc/drives", label: "Drive progress", icon: TrendingUp }],
    },
    STUDENT_DETAILS,
  ],
  // Approving a PIF used to be the end of the Delivery Head's visibility.
  delivery_head: [
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/dashboard", label: "Placement overview", icon: LineChart }],
    },
    {
      heading: "Drive approval",
      icon: ClipboardCheck,
      items: [{ to: "/delivery-head/pif-approvals", label: "PIF approvals", icon: FileCheck2 }],
    },
    // 2026-08-24 (Karthik): view-only student details, org-wide (is_org_reader).
    {
      heading: "Student details",
      icon: Users,
      items: [
        { to: "/central/students", label: "All students", icon: Users },
        { to: "/central/skills", label: "Skill repository", icon: BookOpen },
      ],
    },
    DRIVES,
    {
      heading: "Drives in progress",
      icon: ListChecks,
      items: [{ to: "/cpc/drives", label: "Drive progress", icon: TrendingUp }],
    },
  ],
  central_placement_coordinator: [
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/dashboard", label: "Placement overview", icon: LineChart }],
    },
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
      icon: Users,
      items: [
        { to: "/central/students", label: "All students", icon: Users },
        // PRD §5: view-only reference; feeds the shortlisting rank.
        { to: "/central/skills", label: "Skill repository", icon: BookOpen },
        // 2026-08-24 (answers 1a/2a/3a): the master list of assessed skills —
        // template columns, upload validation and the PIF picker all read it.
        { to: "/central/skills-assessed", label: "Skills assessed", icon: ClipboardList },
      ],
    },
    {
      heading: "Drives in progress",
      icon: ListChecks,
      items: [
        { to: "/cpc/drives", label: "Drive progress", icon: TrendingUp },
        { to: "/central/shortlisting", label: "Shortlisting", icon: Star },
        { to: "/central/results", label: "Rounds & results", icon: Trophy },
        { to: "/cpc/attendance", label: "Attendance", icon: CalendarCheck },
        { to: "/central/offers", label: "Final selection", icon: Award },
      ],
    },
    // D3: no verification queues here — they are the campus CPC's alone.
    {
      heading: "Requests",
      icon: Inbox,
      items: [
        { to: "/cpc/opt-outs", label: "Opt-out requests", icon: UserX },
        { to: "/cpc/off-campus", label: "Off-campus offers", icon: Plane },
      ],
    },
  ],
  admin: [
    {
      heading: "Overview",
      icon: LayoutDashboard,
      items: [{ to: "/dashboard", label: "Placement overview", icon: LineChart }],
    },
    DRIVES,
    STUDENT_DETAILS,
    {
      heading: "Organisation",
      icon: Building2,
      items: [
        { to: "/admin/campuses", label: "Campuses", icon: Building },
        { to: "/admin/staff", label: "Staff", icon: UserCog },
        // F6: degrees and branches belong to a college, under Campuses.
        // Renamed 2026-08-17: the page is named for what it does, not for
        // the file it happens to eat.
        { to: "/admin/roster", label: "Add students", icon: Upload },
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

/**
 * Who this rail belongs to: the role, and the campuses it is scoped to.
 *
 * The campus sits under the role because for these roles it IS part of the
 * role: a coordinator verifies their own campus's students and nobody else's.
 * Mapped to nothing, every queue they open is empty - which reads as a quiet
 * week rather than a broken account, so it says so outright.
 */
function RoleScope({ role, campuses }: { role: AppRole; campuses: readonly string[] }) {
  const scoped = campusScopeFor(role) !== "none" && role !== "key_account_manager";
  const broken = scoped && campuses.length === 0;

  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2">
      <span className={broken ? "text-danger-700" : "text-brand-600"}>
        {broken ? (
          <TriangleAlert aria-hidden="true" className="size-4" />
        ) : (
          <CircleUser aria-hidden="true" className="size-4" />
        )}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          {role.replaceAll("_", " ")}
        </p>
        {scoped &&
          (campuses.length > 0 ? (
            <p className="truncate text-sm font-medium text-ink-700">{campuses.join(" · ")}</p>
          ) : (
            <p className="text-sm font-medium text-destructive">No campus mapped — ask an Admin</p>
          ))}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const auth = useAuth();
  const { signOut, setPreviewRole } = useAuthActions();
  const actualRole = auth.status === "signed-in" ? (auth.actualRole ?? auth.role) : "student";
  const signedInEmail = auth.status === "signed-in" ? auth.email : "";
  const campuses = auth.status === "signed-in" ? auth.campuses : [];

  // Role switcher is exclusively for local development testing, never shown in production
  const previewable = Boolean(import.meta.env.DEV);
  const [localPreview, setLocalPreview] = useState<AppRole | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Lock body scroll when mobile navigation drawer is open
  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen]);

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

  /**
   * One row shape for every destination: pressable, rounded, and current-page
   * carries a weight the hover state cannot borrow (#71, on the shadcn sidebar
   * rows). The active bar sits on the group's rule, so the eye reads which
   * heading the current page belongs to without the heading having to stay open
   * for the answer.
   */
  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `relative flex min-h-[38px] sm:min-h-[36px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
      isActive
        ? "bg-brand-50 font-semibold text-brand-700"
        : "font-medium text-ink-700 hover:bg-surface-muted hover:text-ink-900"
    }`;

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        {/* Brand gradient hairline — the logo's own palette, used sparingly. */}
        <div className="fpc-gradient h-1" aria-hidden="true" />
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          {/* The drawer slides over exactly this corner, so the header stands
              down while it is up: a buried second button named "Close
              navigation", still in the tab order behind the panel, is a control
              nobody can see answering the same question as the drawer's own X. */}
          {!menuOpen && (
            <button
              type="button"
              className="cursor-pointer rounded-lg p-1.5 text-ink-700 hover:bg-surface-muted lg:hidden"
              aria-label="Open navigation"
              aria-expanded={false}
              onClick={() => setMenuOpen(true)}
            >
              <Menu aria-hidden="true" className="size-5" />
            </button>
          )}

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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        {/*
         * ONE nav element, moved rather than duplicated. The mobile drawer used
         * to be the same <nav> swapped to `block`, which filled the whole row
         * and pushed the page below it; it is now an off-canvas panel over a
         * scrim. It stays one element because two copies of the same links
         * would be two landmarks with the same name and two answers to "which
         * page am I on".
         */}
        {menuOpen && (
          <div
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-30 bg-ink-900/40 backdrop-blur-xs lg:hidden"
          />
        )}
        <nav
          aria-label="Main"
          className={`${
            menuOpen
              ? "fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto bg-surface p-3 shadow-xl lg:static lg:z-auto lg:w-64 lg:overflow-visible lg:bg-transparent lg:p-0 lg:shadow-none"
              : "hidden lg:block lg:w-64"
          } shrink-0 self-start`}
        >
          {menuOpen && (
            <div className="mb-2.5 flex items-center justify-between border-b border-line px-1 pb-2.5 lg:hidden">
              <Logo />
              <button
                type="button"
                className="cursor-pointer rounded-lg p-1.5 text-ink-600 hover:bg-surface-muted"
                aria-label="Close navigation"
                onClick={() => setMenuOpen(false)}
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
          )}
          <div className="lg:sticky lg:top-[4.5rem]">
            <Card className="p-2">
              <RoleScope role={role} campuses={campuses} />

              {groups.map((group) => {
                const open = isOpen(group.heading);
                const GroupIcon = group.icon;
                return (
                  <section key={group.heading} className="mb-0.5">
                    {/*
                     * The heading is the control, and it stays BIGGER and darker
                     * than the links it governs (Karthik, 2026-08-17: "the size
                     * of heading is smaller than the lines below them. Headings
                     * are not prominent.").
                     */}
                    <h2 className="font-heading">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleGroup(group.heading)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-base font-bold text-ink-900 transition-colors hover:bg-brand-50 hover:text-brand-700"
                      >
                        <GroupIcon aria-hidden="true" className="size-4 shrink-0 text-brand-600" />
                        <span className="min-w-0 flex-1 truncate">{group.heading}</span>
                        <ChevronRight
                          aria-hidden="true"
                          className={`size-4 shrink-0 text-ink-400 transition-transform ${
                            open ? "rotate-90" : ""
                          }`}
                        />
                      </button>
                    </h2>

                    {open && (
                      <ul className="mb-2 ml-3 flex flex-col gap-0.5 border-l border-line pl-1.5">
                        {group.items.map((item) => {
                          const ItemIcon = item.icon;
                          return (
                            <li key={item.to}>
                              <NavLink
                                to={item.to}
                                className={linkClass}
                                onClick={() => setMenuOpen(false)}
                              >
                                {({ isActive }) => (
                                  <>
                                    {isActive && (
                                      <span
                                        aria-hidden="true"
                                        className="absolute -left-[7px] h-4 w-[3px] rounded-full bg-brand-500"
                                      />
                                    )}
                                    <ItemIcon
                                      aria-hidden="true"
                                      className={`size-4 shrink-0 ${
                                        isActive ? "text-brand-600" : "text-ink-400"
                                      }`}
                                    />
                                    <span className="min-w-0 truncate">{item.label}</span>
                                  </>
                                )}
                              </NavLink>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </Card>
          </div>
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
