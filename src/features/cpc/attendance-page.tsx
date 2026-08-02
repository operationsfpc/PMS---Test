import { Button, Card, PageHeader } from "@components/ui";
import { ABSENCE_LIMIT, needsDisbarmentReview } from "@domain/attendance";
import type { AttendanceStatus } from "@domain/types";
import { useCallback, useEffect, useState } from "react";

export interface ScheduledStudent {
  readonly applicationId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly status: AttendanceStatus;
  /** Absences already accrued across the whole tenure (R8). No reset. */
  readonly priorAbsences: number;
}

export interface AttendanceView {
  scheduled(roundId: string): Promise<readonly ScheduledStudent[]>;
  mark(roundId: string, applicationId: string, status: AttendanceStatus): Promise<void>;
}

/**
 * Attendance for one round.
 *
 * Only students the recruiter actually scheduled appear (Q9). That is not a
 * display choice - it is the safety boundary. Three absences trigger a
 * disbarment review (R8), so a student who applied but was never called must
 * never be markable.
 *
 * Select all / Unselect all is a confirmed requirement: with 200 students in a
 * hall, a coordinator marks the exceptions, not the rule.
 */
export function AttendancePage({ roundId, view }: { roundId: string; view: AttendanceView }) {
  const [rows, setRows] = useState<readonly ScheduledStudent[] | null>(null);
  const [present, setPresent] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await view.scheduled(roundId);
      setRows(list);
      setPresent(list.filter((s) => s.status === "present").map((s) => s.applicationId));
      setError(null);
    } catch {
      setError("Could not load the attendance list.");
      setRows(null);
    }
  }, [view, roundId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setPresent((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  async function save() {
    if (rows === null) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Everyone scheduled gets an explicit mark. Leaving someone unmarked
      // would be indistinguishable from "not yet taken".
      for (const student of rows) {
        await view.mark(
          roundId,
          student.applicationId,
          present.includes(student.applicationId) ? "present" : "absent",
        );
      }
      setSaved(true);
    } catch {
      setError("Could not save attendance. Nothing has been recorded — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Only students the recruiter scheduled for this round can be marked."
      />

      {error !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {error}
          </p>
        </Card>
      )}

      {saved && (
        <Card className="mb-4 border border-[#1EE0E1] bg-[#ECF1F0] p-4">
          <p role="status" className="text-sm text-ink-900">
            Attendance saved.
          </p>
        </Card>
      )}

      {rows === null ? (
        error === null ? (
          <p role="status" className="p-6 text-sm text-neutral-500">
            Loading the attendance list…
          </p>
        ) : null
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            Nobody is scheduled for this round yet. Participants appear once the recruiter's list
            has been uploaded.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-ink-700">
              {rows.length} scheduled · {present.length} present · {rows.length - present.length}{" "}
              absent
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPresent(rows.map((r) => r.applicationId))}
              >
                Select all
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPresent([])}>
                Unselect all
              </Button>
            </div>
          </Card>

          <Card className="p-2">
            <ul className="divide-y divide-neutral-200">
              {rows.map((student) => (
                <li key={student.applicationId} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    id={`att-${student.applicationId}`}
                    className="size-4 accent-[#3D3777]"
                    checked={present.includes(student.applicationId)}
                    onChange={() => toggle(student.applicationId)}
                  />
                  <label htmlFor={`att-${student.applicationId}`} className="text-sm">
                    <span className="font-medium">{student.studentName}</span>{" "}
                    <span className="text-ink-500">{student.rollNumber}</span>
                  </label>

                  <span className="ml-auto flex items-center gap-2 text-xs">
                    <span className={student.priorAbsences > 0 ? "text-[#FF7200]" : "text-ink-500"}>
                      {`${student.priorAbsences} of ${ABSENCE_LIMIT}`}
                    </span>
                    {/* Warn BEFORE the mark, not after: the coordinator is the
                        last person who can check this was really an absence. */}
                    {!present.includes(student.applicationId) &&
                      needsDisbarmentReview(student.priorAbsences + 1) && (
                        <span className="rounded bg-[#FFF0EC] px-2 py-0.5 font-semibold text-[#DD4820]">
                          Triggers review
                        </span>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="mt-4 flex flex-wrap items-center gap-3 pb-10">
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save attendance"}
            </Button>
            <p className="text-xs text-[#FF7200]">
              Anyone left unticked is recorded absent. Three absences trigger a disbarment review.
            </p>
          </div>
        </>
      )}
    </>
  );
}
