import { canShortlistFromPortfolio } from "@domain/drive-portfolio";
import { canMarkAttendance } from "@domain/rounds";
import { isScopedByCampusMapping } from "@domain/staff";
import type { AppRole } from "@domain/types";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useMemo, useState } from "react";
import { type DriveProgressOnward, DriveProgressPage } from "./drive-progress-page";
import { createSupabaseDriveProgressView } from "./drive-progress-view";

/**
 * Which onward screens this account may open, asked once from the domain.
 *
 * Attendance's predicate is per-student (`isScheduled`), and the only part
 * wanted here is the role's own, so it is asked about a student who IS
 * scheduled — the answer then carries no invented fact about anyone.
 */
function onwardFor(role: AppRole | null): DriveProgressOnward {
  if (role === null) return { shortlist: false, attendance: false };
  return {
    shortlist: canShortlistFromPortfolio(role),
    attendance: canMarkAttendance(role, true).allowed,
  };
}

/**
 * Route wrapper: the campus coordinator's full-cycle view (D10).
 *
 * The role and the campus mapping come down from the auth state because both
 * change what this screen is allowed to say: the pane offers only the onward
 * screens this account can open, and an empty list is a broken mapping rather
 * than a quiet week when the account is scoped to no campus at all.
 */
export function DriveProgressRoute() {
  const auth = useAuth();
  const [view] = useState(() => createSupabaseDriveProgressView(supabase()));

  const role = auth.status === "signed-in" ? auth.role : null;
  const campuses = auth.status === "signed-in" ? auth.campuses : null;

  const onward = useMemo(() => onwardFor(role), [role]);
  const campusUnmapped =
    role !== null && isScopedByCampusMapping(role) && campuses !== null && campuses.length === 0;

  return <DriveProgressPage view={view} onward={onward} campusUnmapped={campusUnmapped} />;
}
