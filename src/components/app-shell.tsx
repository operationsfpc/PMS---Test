import type { AppRole } from "@domain/types";
import { useAuth } from "@lib/auth-context";
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

export interface RoleNav {
  readonly role: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const ROLE_NAVS: Readonly<Record<AppRole, readonly NavItem[]>> = {
  student: [
    { to: "/student", label: "My dashboard" },
    { to: "/student/drives", label: "Open drives" },
    { to: "/srf", label: "My registration form" },
  ],
  campus_placement_coordinator: [
    { to: "/cpc/verification", label: "Verification queue" },
    { to: "/cpc/attendance", label: "Attendance" },
  ],
  account_executive: [{ to: "/ae/pif", label: "Position information form" }],
  delivery_head: [{ to: "/delivery-head/pif-approvals", label: "PIF approvals" }],
  central_placement_coordinator: [
    { to: "/central/drives", label: "Drive cockpit" },
    { to: "/central/publish", label: "Publish and target" },
    { to: "/central/shortlisting", label: "Shortlisting" },
    { to: "/cpc/attendance", label: "Attendance" },
  ],
  admin: [
    { to: "/admin/campuses", label: "Campuses" },
    { to: "/admin/roster", label: "Import roster" },
  ],
  // No screens yet. An empty list is honest; borrowing another role's nav is not.
  campus_manager: [],
  key_account_manager: [],
  enterprise_relations: [],
  er_head: [],
  ceo: [],
};

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

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const signedInRole = auth.status === "signed-in" ? auth.role : "student";

  // Development only: lets screens be reviewed without a database. Never
  // shipped - see app-shell.test.tsx.
  const previewable = import.meta.env.DEV;
  const [preview, setPreview] = useState<AppRole | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const role = previewable && preview !== null ? preview : signedInRole;
  const items = ROLE_NAVS[role] ?? [];

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
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
              PR
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <nav
          aria-label="Main"
          className={`${menuOpen ? "block" : "hidden"} w-full shrink-0 lg:block lg:w-60`}
        >
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-ink-300">
            {role.replaceAll("_", " ")}
          </p>
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={linkClass} onClick={() => setMenuOpen(false)}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className={`min-w-0 flex-1 ${menuOpen ? "hidden lg:block" : "block"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
