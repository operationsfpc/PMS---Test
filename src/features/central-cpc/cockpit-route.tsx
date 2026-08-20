import { createSupabaseApprovalRepository } from "@lib/approval-repository";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { type CockpitFilter, CockpitPage } from "./cockpit-page";
import { createSupabaseCockpitView } from "./cockpit-view";

/** Route wrapper: builds the live cockpit view. */
export function CockpitRoute({ filter }: { filter?: CockpitFilter } = {}) {
  const auth = useAuth();
  const [view] = useState(() => createSupabaseCockpitView(supabase()));
  const [approvals] = useState(() => createSupabaseApprovalRepository(supabase()));
  // Signed-out never reaches here (RequireAuth), but the fallback is the
  // least-privileged role rather than the most convenient one.
  const role = auth.status === "signed-in" ? auth.role : "student";

  /**
   * G1c (UAT 2026-08-20): approve/reject from the list — the Delivery Head's
   * verb alone, so nobody else is handed the capability. RLS refuses anyone
   * else regardless (0047); this is the near side of that pair.
   */
  const decide =
    role === "delivery_head"
      ? (
          driveId: string,
          current: Parameters<typeof approvals.decide>[1],
          decision: Parameters<typeof approvals.decide>[2],
        ) => approvals.decide(driveId, current, decision)
      : undefined;

  return (
    <CockpitPage
      view={view}
      filter={filter}
      role={role}
      {...(decide === undefined ? {} : { decide })}
    />
  );
}
