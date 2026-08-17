import { campusScopeFor } from "@domain/staff";
import type { AppRole } from "@domain/types";
import { useAuth, useAuthActions } from "@lib/auth-context";
import { type ReactNode, useState } from "react";
import { NavLink } from "react-router";

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

export const ROLE_NAVS: Readonly<Record<AppRole, readonly NavGroup[]>> = {
  student: [
    { heading: "Home", items: [{ to: "/student", label: "My dashboard" }] },
    { heading: "Drives", items: [{ to: "/student/drives", label: "Open drives" }] },
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
    {
      heading: "Verification",
      items: [
        { to: "/cpc/verification", label: "Student verification" },
        { to: "/cpc/certificates", label: "Certificate verification" },
      ],
    },
    {
      heading: "Drives in progress",
      items: [
        // D10: shortlist, every round, the offer — read-only, campus-scoped.
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
    { heading: "Overview", items: [{ to: "/dashboard", label: "Campus overview" }] },
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
    {
      heading: "Drive initiation",
      items: [{ to: "/ae/pif", label: "Position information form" }],
    },
    {
      heading: "My drives",
      items: [{ to: "/my-drives", label: "My drives" }],
    },
  ],
  campus_manager: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Campus overview" }] },
  ],
  key_account_manager: [
    { heading: "Overview", items: [{ to: "/dashboard", label: "Account overview" }] },
  ],
  enterprise_relations: [{ heading: "Overview", items: [{ to: "/dashboard", label: "Overview" }] }],
  er_head: [{ heading: "Overview", items: [{ to: "/dashboard", label: "Overview" }] }],
  ceo: [{ heading: "Overview", items: [{ to: "/dashboard", label: "Executive overview" }] }],
  // Approving a PIF used to be the end of the Delivery Head's visibility.
  delivery_head: [
    {
      heading: "Drive approval",
      items: [{ to: "/delivery-head/pif-approvals", label: "PIF approvals" }],
    },
    {
      heading: "Drives",
      items: [
        { to: "/my-drives", label: "My drives" },
        { to: "/central/drives", label: "Drive cockpit" },
      ],
    },
    { heading: "Overview", items: [{ to: "/dashboard", label: "Placement overview" }] },
  ],
  central_placement_coordinator: [
    // D2: approval stays with the Delivery Head; the Central CPC sees what is
    // waiting to be published and what already is, separately. The old
    // cockpit is absorbed into those two views.
    {
      heading: "Drives",
      items: [
        { to: "/central/drives/yet-to-publish", label: "Yet to publish" },
        { to: "/central/drives/published", label: "Published" },
        // F15: the AE's drive module, with shortlisting access.
        { to: "/my-drives", label: "All drives" },
      ],
    },
    {
      heading: "Publish a drive",
      items: [
        { to: "/central/publish", label: "Publish and target" },
        // PRD §5: view-only reference while publishing; feeds R11.
        { to: "/central/skills", label: "Skill repository" },
      ],
    },
    {
      heading: "Drives in progress",
      items: [
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
    { heading: "Overview", items: [{ to: "/dashboard", label: "Placement overview" }] },
  ],
  admin: [
    {
      heading: "Organisation",
      items: [
        { to: "/admin/campuses", label: "Campuses" },
        { to: "/admin/staff", label: "Staff" },
        // F6: degrees and branches belong to a college, under Campuses.
        { to: "/admin/roster", label: "Import roster" },
      ],
    },
    { heading: "Overview", items: [{ to: "/dashboard", label: "Placement overview" }] },
  ],
};

/** Every route a role's sidebar links to, group structure flattened away. */
export function navItemsFor(role: AppRole): readonly NavItem[] {
  return (ROLE_NAVS[role] ?? []).flatMap((group) => group.items);
}

/** Labels for the development-only preview switcher. */
const PREVIEW_ROLES: readonly AppRole[] = [
  "student",
  "campus_placement_coordinator",
  "account_executive",
  "delivery_head",
  "central_placement_coordinator",
];

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
  const auth = useAuth();
  const { signOut } = useAuthActions();
  const signedInRole = auth.status === "signed-in" ? auth.role : "student";
  const signedInEmail = auth.status === "signed-in" ? auth.email : "";
  const campuses = auth.status === "signed-in" ? auth.campuses : [];

  // Development only: lets screens be reviewed without a database. Never
  // shipped - see app-shell.test.tsx.
  const previewable = import.meta.env.DEV;
  const [preview, setPreview] = useState<AppRole | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const role = previewable && preview !== null ? preview : signedInRole;
  const groups = ROLE_NAVS[role] ?? [];

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
                <select
                  id="role-switch"
                  className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700 focus:border-brand-500 focus:outline-none"
                  value={preview ?? signedInRole}
                  onChange={(e) => setPreview(e.target.value as AppRole)}
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
            (campuses.length > 0 ? (
              <p className="px-3 text-sm font-medium text-ink-700">{campuses.join(" · ")}</p>
            ) : (
              <p className="px-3 text-sm font-medium text-destructive">
                No campus mapped — ask an Admin
              </p>
            ))}
          <div className="mb-2" />
          {groups.map((group) => (
            <section key={group.heading} className="mb-4">
              <h2 className="px-3 pb-1 font-heading text-[11px] font-semibold uppercase tracking-widest text-accent">
                {group.heading}
              </h2>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} className={linkClass} onClick={() => setMenuOpen(false)}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <main className={`min-w-0 flex-1 ${menuOpen ? "hidden lg:block" : "block"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
