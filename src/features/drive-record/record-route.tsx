import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { DriveRecordPage } from "./record-page";
import { createSupabaseDriveRecordView, type DriveRecordView } from "./record-view";

/**
 * N1 — `/drives/:driveId`, the one canonical page, for every signed-in role.
 * RLS decides whether the drive comes back at all; the page decides which
 * SECTIONS this role is shown.
 */
export function DriveRecordRoute({ view }: { view?: DriveRecordView }) {
  const { driveId } = useParams();
  // C8: the funnel number that linked here, e.g. `?stage=shortlisted`.
  const [params] = useSearchParams();
  const auth = useAuth();
  const [resolved] = useState<DriveRecordView>(
    () => view ?? createSupabaseDriveRecordView(supabase()),
  );

  if (driveId === undefined || auth.status !== "signed-in") return null;

  return (
    <DriveRecordPage
      view={resolved}
      role={auth.role}
      driveId={driveId}
      stage={params.get("stage") ?? undefined}
    />
  );
}
