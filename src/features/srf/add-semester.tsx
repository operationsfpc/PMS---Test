import { Button, Card } from "@components/ui";
import { canAddLaterSemester, nextSemesterFor, type ProgrammeLevel } from "@domain/academics";
import { isValidForScale, type MarksScale } from "@domain/marks";
import type { SrfStatus } from "@domain/types";
import { useState } from "react";

export interface NewSemester {
  readonly semesterNumber: number;
  /** On the student's own scale; normalised before it is stored. */
  readonly marks: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  /** Mandatory: it is what makes verification mean anything. */
  readonly marksheet: File;
}

export interface AddSemesterView {
  add(semester: NewSemester): Promise<void>;
}

/**
 * Adding a semester that finished after registration. F13 (UAT 2026-08-06).
 *
 * "students might get subsequent semester results after they have registered
 * to placements. So they must be able to submit marks of subsequent semesters.
 * But this should be visible only after approval from Campus PC."
 *
 * The form itself is locked once verified, and stays locked — §7.2 judges
 * eligibility on VERIFIED data, so editing a checked figure silently
 * invalidates every shortlist the record has already been measured for. This
 * is the narrower permission: ADD the next line, with its marksheet, and it
 * counts for nothing until a coordinator has compared the two.
 *
 * Whether it may be added at all is `canAddLaterSemester`'s decision.
 */
export function AddSemester({
  srfStatus,
  programmeLevel,
  declaredSemesters,
  marksScale,
  view,
}: {
  srfStatus: SrfStatus;
  programmeLevel: ProgrammeLevel;
  declaredSemesters: readonly number[];
  marksScale: MarksScale;
  view: AddSemesterView;
}) {
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState("");
  const [standing, setStanding] = useState("");
  const [history, setHistory] = useState("");
  const [marksheet, setMarksheet] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<readonly number[]>([]);
  const [sending, setSending] = useState(false);

  const declared = [...declaredSemesters, ...added];
  const next = nextSemesterFor({ programmeLevel, declaredSemesters: declared });

  const gate =
    next === null
      ? { allowed: false as const, reason: "" }
      : canAddLaterSemester({
          srfStatus,
          programmeLevel,
          declaredSemesters: declared,
          semesterNumber: next,
        });

  function reset() {
    setMarks("");
    setStanding("");
    setHistory("");
    setMarksheet(null);
    setProblem(null);
  }

  async function submit(semesterNumber: number) {
    const value = Number(marks);

    if (!Number.isFinite(value) || marks.trim() === "") {
      setProblem("Enter the marks for this semester.");
      return;
    }
    // Judged on the scale the student's college reports on: 65 is a fine
    // percentage and a nonsense CGPA, and one ceiling could only say one.
    if (!isValidForScale(value, marksScale)) {
      setProblem(
        marksScale === "percentage"
          ? "A percentage is between 0 and 100."
          : "A CGPA is on the 10-point scale.",
      );
      return;
    }
    if (marksheet === null) {
      setProblem("Upload the marksheet for this semester. Your coordinator verifies against it.");
      return;
    }

    setProblem(null);
    setError(null);
    setSending(true);
    try {
      await view.add({
        semesterNumber,
        marks: value,
        currentArrears: Number(standing === "" ? 0 : standing),
        historyOfArrears: Number(history === "" ? 0 : history),
        marksheet,
      });
      setAdded((current) => [...current, semesterNumber]);
      setOpen(false);
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this semester.");
    } finally {
      setSending(false);
    }
  }

  const justAdded = added.at(-1) ?? null;

  return (
    <div>
      {error !== null && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {justAdded !== null && !open && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-ink-900"
        >
          Semester {justAdded} has been sent to your Campus Placement Coordinator. It counts towards
          eligibility once they have verified it against your marksheet.
        </div>
      )}

      {/* Nothing to offer: unverified form, or a completed programme. */}
      {next !== null && gate.allowed && !open && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          + Add semester {next}
        </Button>
      )}

      {next !== null && open && (
        <Card className="p-5">
          <h4 className="text-base font-semibold text-ink-900">Semester {next}</h4>
          <p className="mt-1 text-sm text-ink-700">
            These marks are <strong>not verified</strong> until your Campus Placement Coordinator
            has compared them to the marksheet you upload here. Until then they count towards
            nothing.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="new-sem-marks"
                className="mb-1 block text-sm font-medium text-ink-700"
              >
                Marks ({marksScale === "percentage" ? "percentage" : "CGPA"})
              </label>
              <input
                id="new-sem-marks"
                inputMode="decimal"
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="new-sem-standing"
                className="mb-1 block text-sm font-medium text-ink-700"
              >
                Standing arrears
              </label>
              <input
                id="new-sem-standing"
                inputMode="numeric"
                value={standing}
                onChange={(e) => setStanding(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="new-sem-history"
                className="mb-1 block text-sm font-medium text-ink-700"
              >
                History of arrears
              </label>
              <input
                id="new-sem-history"
                inputMode="numeric"
                value={history}
                onChange={(e) => setHistory(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-4">
            <label
              htmlFor="new-sem-marksheet"
              className="mb-1 block text-sm font-medium text-ink-700"
            >
              Semester {next} marksheet <span className="text-destructive">*</span>
            </label>
            <input
              id="new-sem-marksheet"
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setMarksheet(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          {problem !== null && (
            <p className="mt-2 text-sm font-medium text-destructive">{problem}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={sending} onClick={() => void submit(next)}>
              {sending ? "Sending…" : "Submit for verification"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
