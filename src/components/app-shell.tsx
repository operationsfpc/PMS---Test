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

export const ROLE_NAVS: readonly RoleNav[] = [
  {
    role: "student",
    label: "Student",
    items: [
      { to: "/student", label: "My dashboard" },
      { to: "/srf", label: "My registration form" },
    ],
  },
  {
    role: "cpc",
    label: "Campus Placement Coordinator",
    items: [
      { to: "/cpc/verification", label: "Verification queue" },
      { to: "/cpc/attendance", label: "Attendance" },
    ],
  },
  {
    role: "delivery_head",
    label: "Delivery Head",
    items: [{ to: "/delivery-head/pif-approvals", label: "PIF approvals" }],
  },
  {
    role: "central_cpc",
    label: "Central Placement Coordinator",
    items: [
      { to: "/central/drives", label: "Drive cockpit" },
      { to: "/central/shortlisting", label: "Shortlisting" },
      { to: "/cpc/attendance", label: "Attendance" },
    ],
  },
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
  const [roleIndex, setRoleIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const active = ROLE_NAVS[roleIndex] ?? ROLE_NAVS[0];
  if (active === undefined) throw new Error("ROLE_NAVS must not be empty");

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
            <label
              className="hidden text-xs font-medium text-ink-500 sm:block"
              htmlFor="role-switch"
            >
              Preview as
            </label>
            <select
              id="role-switch"
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700 focus:border-brand-500 focus:outline-none"
              value={roleIndex}
              onChange={(e) => setRoleIndex(Number(e.target.value))}
            >
              {ROLE_NAVS.map((r, i) => (
                <option key={r.role} value={i}>
                  {r.label}
                </option>
              ))}
            </select>
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
            {active.label}
          </p>
          <ul className="flex flex-col gap-1">
            {active.items.map((item) => (
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
