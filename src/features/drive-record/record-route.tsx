import { Badge, Button } from "@components/ui";
import type { AppRole } from "@domain/types";
import { useAuth } from "@lib/auth-context";
import { supabase } from "@lib/supabase";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { DriveRecordPage } from "./record-page";
import { createSupabaseDriveRecordView, type DriveRecordView } from "./record-view";
import {
  Bar,
  StudentApplyModal,
  type StudentApplyView,
  useStudentApply,
} from "./student-apply-bar";

function StudentDriveRecord({
  driveId,
  stage,
  pageView,
  studentView,
  role,
}: {
  driveId: string;
  stage?: string | undefined;
  pageView: DriveRecordView;
  studentView: StudentApplyView;
  role: AppRole;
}) {
  const applyState = useStudentApply(driveId, studentView);
  const {
    card,
    error,
    confirming,
    resume,
    setResume,
    problem,
    busy,
    load,
    startApply,
    closeConfirm,
    confirm,
  } = applyState;

  const headerAction = (
    <span className="flex items-center gap-2">
      {card === undefined ? null : card === null ? (
        <Badge tone="neutral">Not open for your profile</Badge>
      ) : card.applied ? (
        <Badge tone="success">Application submitted</Badge>
      ) : card.canApply ? (
        <Button size="sm" onClick={startApply}>
          Apply
        </Button>
      ) : (
        <span title={card.refusal ?? undefined}>
          <Badge tone="neutral">{card.refusal ?? "Not open to apply"}</Badge>
        </span>
      )}
    </span>
  );

  return (
    <>
      <DriveRecordPage
        view={pageView}
        role={role}
        driveId={driveId}
        stage={stage}
        headerAction={headerAction}
      />
      {card !== undefined && card !== null && (
        <Bar>
          {card.applied ? (
            <Badge tone="success">Application submitted</Badge>
          ) : card.canApply ? (
            <Button
              aria-label={`Apply to ${card.companyName} — ${card.roleTitle}`}
              onClick={startApply}
            >
              Apply
            </Button>
          ) : (
            <p className="max-w-md text-center text-sm font-medium text-danger-700 break-words">
              {card.refusal}
            </p>
          )}
        </Bar>
      )}
      {card === undefined && error !== null && (
        <Bar>
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </Bar>
      )}
      <StudentApplyModal
        card={card}
        confirming={confirming}
        resume={resume}
        setResume={setResume}
        problem={problem}
        error={error}
        busy={busy}
        closeConfirm={closeConfirm}
        confirm={confirm}
      />
    </>
  );
}

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

  if (auth.role === "student") {
    return (
      <StudentDriveRecord
        driveId={driveId}
        stage={params.get("stage") ?? undefined}
        pageView={resolved}
        studentView={studentView}
        role={auth.role}
      />
    );
  }

  return (
    <DriveRecordPage
      view={resolved}
      role={auth.role}
      driveId={driveId}
      stage={params.get("stage") ?? undefined}
    />
  );
}
