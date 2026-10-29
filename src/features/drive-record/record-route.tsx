import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { DriveRecordPage } from "./record-page";
import { createSupabaseDriveRecordView, type DriveRecordView } from "./record-view";
import { StudentApplyBar, type StudentApplyView } from "./student-apply-bar";

/**
 * N1 — `/drives/:driveId`, the one canonical page, for every signed-in role.
 * RLS decides whether the drive comes back at all; the page decides which
 * SECTIONS this role is shown.
 *
 * Students also get the Apply bar here (2026-10-29): a card's "View" led to a
 * page that named everything about the drive except the one thing it is for.
 *
 * The student gateway is handed in by the composition root: the student's
 * drives view lives in `features/student`, and a feature may not import a
 * sibling feature (`architecture.test.ts`).
 */
export function DriveRecordRoute({
  view,
  studentApplyView,
}: {
  view?: DriveRecordView;
  studentApplyView: () => StudentApplyView;
}) {
  const { driveId } = useParams();
  // C8: the funnel number that linked here, e.g. `?stage=shortlisted`.
  const [params] = useSearchParams();
  const auth = useAuth();
  const [resolved] = useState<DriveRecordView>(
    () => view ?? createSupabaseDriveRecordView(supabase()),
  );
  const [studentView] = useState<StudentApplyView>(studentApplyView);

  if (driveId === undefined || auth.status !== "signed-in") return null;

  return (
    <>
      <DriveRecordPage
        view={resolved}
        role={auth.role}
        driveId={driveId}
        stage={params.get("stage") ?? undefined}
      />
      {auth.role === "student" && <StudentApplyBar driveId={driveId} view={studentView} />}
    </>
  );
}
