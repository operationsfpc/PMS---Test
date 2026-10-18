import { Badge, Button, ButtonLink, Card, PageHeader } from "@components/ui";
import { ABSENCE_LIMIT, needsDisbarmentReview } from "@domain/attendance";
import type { AttendanceStatus } from "@domain/types";
import { useCallback, useEffect, useState } from "react";

export interface ScheduledStudent {
  readonly applicationId: string;
  /** Null when the row's application could not be read — no record to open. */
  readonly studentId?: string | null;
  readonly studentName: string;
  readonly rollNumber: string;
  /** Whose college it is — a round runs across every campus the drive targets. */
  readonly college?: string | null;
  readonly status: AttendanceStatus;
  /** Absences already accrued across the whole tenure (R8). No reset. */
  readonly priorAbsences: number;
}

export interface AttendanceView {
  scheduled(roundId: string): Promise<readonly ScheduledStudent[]>;
  mark(roundId: string, applicationId: string, status: AttendanceStatus): Promise<void>;
  /** 0100: saves the whole round's attendance in one transaction. */
  markBatch(
    roundId: string,
    entries: readonly { applicationId: string; status: AttendanceStatus }[],
  ): Promise<void>;
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
      // 0100: one transaction for the whole round. A failure leaves the old
      // attendance intact rather than half-saved.
      await view.markBatch(
        roundId,
        rows.map((student) => ({
          applicationId: student.applicationId,
          status: present.includes(student.applicationId)
            ? ("present" as const)
            : ("absent" as const),
        })),
      );
      setSaved(true);
    } catch {
      setError("Could not save attendance. No entries were recorded — please try again.");
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
        <Card className="mb-4 border border-danger-500 bg-danger-50 p-4">
          <p role="alert" className="text-sm text-danger-500">
            {error}
          </p>
        </Card>
      )}

      {saved && (
        <Card className="mb-4 border border-cyan-400 bg-cyan-50 p-4">
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
              {rows.map((student) => {
                const isPresent = present.includes(student.applicationId);
                /** What the record already holds. A round nobody has taken yet
                 *  is `scheduled`, which is neither of the two marks. */
                const recorded =
                  student.status === "present" || student.status === "absent"
                    ? student.status
                    : null;
                return (
                  <li key={student.applicationId} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      id={`att-${student.applicationId}`}
                      className="size-4 accent-brand-500"
                      checked={isPresent}
                      onChange={() => toggle(student.applicationId)}
                    />
                    <label htmlFor={`att-${student.applicationId}`} className="text-sm">
                      <span className="font-medium">{student.studentName}</span>{" "}
                      <span className="text-ink-500">Roll {student.rollNumber}</span>
                      {student.college != null && student.college !== "" && (
                        <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
                          {student.college}
                        </span>
                      )}
                    </label>
                    {/* The name belongs to the checkbox — it is how the row is
                        ticked — so the record is reached from its own control,
                        named the same way every other card names its way in. */}
                    {student.studentId != null && (
                      <ButtonLink
                        size="sm"
                        variant="ghost"
                        to={`/students/${student.studentId}`}
                        aria-label={`View ${student.studentName}`}
                      >
                        View
                      </ButtonLink>
                    )}

                    <span className="ml-auto flex items-center gap-2 text-xs">
                      {/* The tick IS the mark, but a box alone reads as "nothing
                          decided yet" — and ticking a student changed nothing a
                          coordinator could see. Say the state the row holds, and
                          say which recorded state it would replace. */}
                      <Badge tone={isPresent ? "success" : "danger"}>
                        {isPresent ? "Present" : "Absent"}
                      </Badge>
                      {recorded !== null && isPresent !== (recorded === "present") && (
                        <span className="text-ink-500">was {recorded}</span>
                      )}
                      <span
                        className={student.priorAbsences > 0 ? "text-orange-500" : "text-ink-500"}
                      >
                        {`${student.priorAbsences} of ${ABSENCE_LIMIT}`}
                      </span>
                      {/* Warn BEFORE the mark, not after: the coordinator is the
                          last person who can check this was really an absence. */}
                      {!isPresent && needsDisbarmentReview(student.priorAbsences + 1) && (
                        <span className="rounded bg-danger-50 px-2 py-0.5 font-semibold text-danger-500">
                          Triggers review
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="mt-4 flex flex-wrap items-center gap-3 pb-10">
            <Button isLoading={busy} onClick={() => void save()}>
              Save attendance
            </Button>
            <p className="text-xs text-orange-500">
              Anyone left unticked is recorded absent. Three absences trigger a disbarment review.
            </p>
          </div>
        </>
      )}
    </>
  );
}
