import type { AppRole } from "@domain/types";
import { isTestPreviewAllowed, useAuth } from "@lib/auth-context";
import type { ReactNode } from "react";
import { Navigate } from "react-router";

/**
 * Guard for role-restricted routes.
 *
 * `allow` accepts either a domain function `(role) => boolean` or a plain
 * array of roles.
 *
 * When an unauthorized role accesses the route, renders the inline refusal
 * message instead of silently redirecting to home.
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

  if (auth.status !== "signed-in") return <Navigate to="/login" replace />;

  const permitted =
    isTestPreviewAllowed(auth.email) ||
    (typeof allow === "function" ? allow(auth.role) : allow.includes(auth.role));

  if (!permitted) {
    return <p className="p-8 text-sm text-ink-700">{reason}</p>;
  }

  return <>{children}</>;
}
