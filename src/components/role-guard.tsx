import type { AppRole } from "@domain/types";
import { isTestPreviewAllowed, useAuth } from "@lib/auth-context";
import type { ReactNode } from "react";
import { AccessDeniedPage } from "./access-denied-page";

/**
 * One guard for every role-restricted route.
 *
 * Replaces the seven inline guards that used to live in `app.tsx` — each was
 * the same twelve lines copy-pasted with a different role check and a
 * different refusal message. The duplication meant fixes (bypass logic,
 * styling, the refusal page) had to happen in seven places at once.
 *
 * `allow` accepts either a domain function `(role) => boolean` or a plain
 * array of roles. Use the function form when the domain already exports a
 * capability check (`canShortlistFromPortfolio`, `canRaiseDrive`, …). Use the
 * array form for simple membership tests that do not warrant a domain
 * function of their own.
 *
 * Test-preview bypass lives HERE — once. `isTestPreviewAllowed` checks the
 * email AND the hostname, so radhika@ and thanush@ on pms-test-gamma can see
 * every screen regardless of their signed-in role.
 */
export function RoleGuard({
  allow,
  reason,
  children,
}: {
  allow: ((role: AppRole) => boolean) | readonly AppRole[];
  reason: string;
  children: ReactNode;
}) {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : null;
  const email = auth.status === "signed-in" ? auth.email : undefined;
  const bypassed = isTestPreviewAllowed(email);

  const permitted =
    bypassed ||
    (role !== null && (typeof allow === "function" ? allow(role) : allow.includes(role)));

  if (!permitted) {
    return <AccessDeniedPage reason={reason} />;
  }

  return <>{children}</>;
}
