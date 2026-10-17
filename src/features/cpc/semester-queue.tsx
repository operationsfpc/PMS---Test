import { StudentIdentity } from "@components/student-identity";
import { Button, Card, PageHeader } from "@components/ui";
import { supabase } from "@lib/supabase";
import { useCallback, useEffect, useState } from "react";
import {
  createSupabaseSemesterQueueRepository,
  type PendingSemester,
  SemesterQueueError,
  type SemesterQueueRepository,
} from "./semester-queue-repository";

/**
 * The coordinator's semester (CGPA) queue — 2026-08-24 UAT.
 *
 * "add request by students for cgpa which has to be approved by campus
 * placement coordinator is not showing up for approval. similar request for
 * certifications is showing up. but cgpa is not."
 *
 * Semesters declared on the registration form are decided wholesale by
 * approving the form (0031). This queue is for every semester added AFTER —
 * F13's later additions — which previously sat pending forever, silently
 * holding the student's judged CGPA at an older line or at zero.
 *
 * The declared figure sits beside its marksheet, exactly like the
 * certificate queue: verifying means opening the document and agreeing.
 */
export function SemesterQueue({ repository }: { repository?: SemesterQueueRepository }) {
  const [rows, setRows] = useState<readonly PendingSemester[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const [repo] = useState<SemesterQueueRepository>(
    () => repository ?? createSupabaseSemesterQueueRepository(supabase()),
  );

  const load = useCallback(async () => {
    try {
      setRows(await repo.pending());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof SemesterQueueError
          ? caught.message
          : "Could not load the CGPA verification queue.",
      );
      // Deliberately NOT []: an empty queue and a failed load mean opposite
      // things to a coordinator and must never look the same.
      setRows(null);
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(semester: PendingSemester, verify: boolean) {
    setBusyId(semester.id);
    setError(null);
    try {
      await repo.decide(
        semester.id,
        "pending",
        verify
          ? { decision: "verify" }
          : { decision: "reject", reason: reasons[semester.id] ?? "" },
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the decision. Please try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="CGPA verification"
        subtitle="Open each marksheet and check it against the marks the student declared."
      />

      {error !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {error}
          </p>
        </Card>
      )}

      {rows === null ? (
        error === null ? (
          <p role="status" className="p-6 text-sm text-neutral-500">
            Loading the CGPA verification queue…
          </p>
        ) : null
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">No declared semesters are waiting to be verified.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((semester) => (
            <li key={semester.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-[Raleway] text-base font-bold text-ink-900">
                      Semester {semester.semesterNumber} — CGPA {semester.cgpa}
                    </p>
                    {semester.declaredMarks !== null && semester.marksScale === "percentage" && (
                      <p className="text-xs text-ink-500">
                        Declared as {semester.declaredMarks}% by the student
                      </p>
                    )}
                    <div className="mt-1">
                      <StudentIdentity
                        name={semester.studentName}
                        rollNumber={semester.rollNumber}
                        college={semester.college}
                        studentId={semester.studentId}
                      >
                        <p className="text-xs text-ink-500">
                          {semester.currentArrears} standing, {semester.historyOfArrears} in history
                        </p>
                      </StudentIdentity>
                    </div>
                  </div>

                  {semester.url === null ? (
                    // Never a dead link: a coordinator must not believe they
                    // have checked something they could not open.
                    <p className="text-sm text-[#DD4820]">No marksheet available</p>
                  ) : (
                    <a
                      className="text-sm font-medium text-brand-600 underline"
                      href={semester.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open marksheet
                    </a>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`reason-${semester.id}`}
                      className="mb-1 block text-sm font-medium text-ink-900"
                    >
                      Reason (required to reject)
                    </label>
                    <input
                      id={`reason-${semester.id}`}
                      type="text"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                      placeholder="What the student needs to correct"
                      value={reasons[semester.id] ?? ""}
                      onChange={(e) => setReasons((r) => ({ ...r, [semester.id]: e.target.value }))}
                    />
                  </div>

                  <Button
                    size="sm"
                    disabled={busyId === semester.id}
                    onClick={() => void decide(semester, true)}
                  >
                    Verify
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busyId === semester.id}
                    onClick={() => void decide(semester, false)}
                  >
                    Reject
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
