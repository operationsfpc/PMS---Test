import { Button, Card } from "@components/ui";
import {
  addableSemesters,
  canAddLaterSemester,
  nextSemesterFor,
  type ProgrammeLevel,
} from "@domain/academics";
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
 * Adding semesters that finished after registration. F13 (UAT 2026-08-06),
 * extended 2026-08-06 to several at a time.
 *
 * "students might get subsequent semester results after they have registered
 * to placements. So they must be able to submit marks of subsequent semesters.
 * But this should be visible only after approval from Campus PC."
 *
 * "while adding additional semester marks, have option to upload for multiple
 * additional semesters. up to total of 10 for UG and up to total of 4 for PG."
 *
 * The form itself is locked once verified, and stays locked — §7.2 judges
 * eligibility on VERIFIED data, so editing a checked figure silently
 * invalidates every shortlist the record has already been measured for. This
 * is the narrower permission: ADD the semesters that have since finished, each
 * with its own marksheet, and they count for nothing until a coordinator has
 * compared the two.
 *
 * How many may be added at all is `addableSemesters`' decision, and the cap it
 * applies is a TOTAL: what is already on the record counts against it.
 */

/** One semester being declared. Held as typed, so nothing is coerced early. */
interface DraftRow {
  readonly semesterNumber: number;
  readonly marks: string;
  readonly standing: string;
  readonly history: string;
  readonly marksheet: File | null;
}

const blank = (semesterNumber: number): DraftRow => ({
  semesterNumber,
  marks: "",
  standing: "",
  history: "",
  marksheet: null,
});

/** "5", "5 and 6", "5, 6 and 7" — read out the way a person would say it. */
function listOf(numbers: readonly number[]): string {
  if (numbers.length <= 1) return numbers.join("");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
}

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
  const [rows, setRows] = useState<readonly DraftRow[]>([]);
  const [problems, setProblems] = useState<readonly string[]>([]);
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

  /**
   * The semesters still to come, counted from what is on the record AND what
   * is open on screen. Without the second half, opening five rows would keep
   * offering an eleventh.
   */
  const remaining = addableSemesters({ programmeLevel, declaredSemesters: declared });
  const following = remaining.find((n) => !rows.some((r) => r.semesterNumber === n)) ?? null;

  const update = (semesterNumber: number, change: Partial<DraftRow>) =>
    setRows((current) =>
      current.map((r) => (r.semesterNumber === semesterNumber ? { ...r, ...change } : r)),
    );

  /**
   * Every problem at once, each naming its semester.
   *
   * Two rows on screen means "enter the marks" on its own no longer says
   * which marksheet the student is holding.
   */
  function problemsIn(candidates: readonly DraftRow[]): readonly string[] {
    const found: string[] = [];

    for (const row of candidates) {
      const value = Number(row.marks);
      const label = `Semester ${row.semesterNumber}`;

      if (!Number.isFinite(value) || row.marks.trim() === "") {
        found.push(`${label}: enter the marks for this semester.`);
      } else if (!isValidForScale(value, marksScale)) {
        // Judged on the scale the student's college reports on: 65 is a fine
        // percentage and a nonsense CGPA, and one ceiling could only say one.
        found.push(
          marksScale === "percentage"
            ? `${label}: a percentage is between 0 and 100.`
            : `${label}: a CGPA is on the 10-point scale.`,
        );
      }

      if (row.marksheet === null) {
        found.push(
          `${label}: upload the marksheet for this semester. Your coordinator verifies against it.`,
        );
      }

      const standing = Number(row.standing === "" ? 0 : row.standing);
      const history = Number(row.history === "" ? 0 : row.history);

      if (!Number.isInteger(standing) || standing < 0) {
        found.push(`${label}: standing arrears must be a non-negative whole number.`);
      }
      if (!Number.isInteger(history) || history < 0) {
        found.push(`${label}: arrear history must be a non-negative whole number.`);
      } else if (history < standing) {
        found.push(`${label}: arrear history cannot be less than standing arrears.`);
      }
    }

    return found;
  }

  async function submit() {
    const found = problemsIn(rows);
    setProblems(found);
    // Nothing is sent until every row is complete: sending the good ones and
    // reporting the bad one leaves the student guessing which half landed.
    if (found.length > 0) return;

    setError(null);
    setSending(true);

    const landed: number[] = [];
    try {
      for (const row of rows) {
        await view.add({
          semesterNumber: row.semesterNumber,
          marks: Number(row.marks),
          currentArrears: Number(row.standing === "" ? 0 : row.standing),
          historyOfArrears: Number(row.history === "" ? 0 : row.history),
          // Present: `problemsIn` refused the row otherwise.
          marksheet: row.marksheet as File,
        });
        landed.push(row.semesterNumber);
      }
      setRows([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this semester.");
      // Each semester is its own write, so the ones before the failure are
      // already stored. Keeping them on screen would invite a second copy.
      setRows((current) => current.filter((r) => !landed.includes(r.semesterNumber)));
    } finally {
      setAdded((current) => [...current, ...landed]);
      setSending(false);
    }
  }

  /**
   * Everything that has landed this visit, said whether the panel is open or
   * not. After a partial failure the student is looking at the row that did
   * NOT land, and the only way to know the earlier ones did is to be told.
   */
  const confirmed = added;

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

      {confirmed.length > 0 && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-ink-900"
        >
          {confirmed.length === 1 ? "Semester" : "Semesters"} {listOf(confirmed)}{" "}
          {confirmed.length === 1 ? "has" : "have"} been sent to your Campus Placement Coordinator.
          {confirmed.length === 1 ? " It counts" : " They count"} towards eligibility once they have
          verified {confirmed.length === 1 ? "it" : "them"} against your marksheet.
        </div>
      )}

      {/* Nothing to offer: unverified form, or a completed programme. */}
      {next !== null && gate.allowed && rows.length === 0 && (
        <Button variant="secondary" onClick={() => setRows([blank(next)])}>
          + Add semester {next}
        </Button>
      )}

      {rows.length > 0 && (
        <Card className="p-5">
          <p className="text-sm text-ink-700">
            These marks are <strong>not verified</strong> until your Campus Placement Coordinator
            has compared them to the marksheets you upload here. Until then they count towards
            nothing.
          </p>

          <div className="mt-4 flex flex-col gap-5">
            {rows.map((row, index) => (
              <fieldset
                key={row.semesterNumber}
                className="rounded-lg border border-neutral-300 p-4"
              >
                <legend className="px-1 text-base font-semibold text-ink-900">
                  Semester {row.semesterNumber}
                </legend>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label
                      htmlFor={`new-sem-${row.semesterNumber}-marks`}
                      className="mb-1 block text-sm font-medium text-ink-700"
                    >
                      Marks ({marksScale === "percentage" ? "percentage" : "CGPA"})
                    </label>
                    <input
                      id={`new-sem-${row.semesterNumber}-marks`}
                      inputMode="decimal"
                      value={row.marks}
                      onChange={(e) => update(row.semesterNumber, { marks: e.target.value })}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`new-sem-${row.semesterNumber}-standing`}
                      className="mb-1 block text-sm font-medium text-ink-700"
                    >
                      Standing arrears
                    </label>
                    <input
                      id={`new-sem-${row.semesterNumber}-standing`}
                      inputMode="numeric"
                      value={row.standing}
                      onChange={(e) => update(row.semesterNumber, { standing: e.target.value })}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`new-sem-${row.semesterNumber}-history`}
                      className="mb-1 block text-sm font-medium text-ink-700"
                    >
                      History of arrears
                    </label>
                    <input
                      id={`new-sem-${row.semesterNumber}-history`}
                      inputMode="numeric"
                      value={row.history}
                      onChange={(e) => update(row.semesterNumber, { history: e.target.value })}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label
                    htmlFor={`new-sem-${row.semesterNumber}-marksheet`}
                    className="mb-1 block text-sm font-medium text-ink-700"
                  >
                    Semester {row.semesterNumber} marksheet{" "}
                    <span className="text-destructive">*</span>
                  </label>
                  <input
                    id={`new-sem-${row.semesterNumber}-marksheet`}
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) =>
                      update(row.semesterNumber, { marksheet: e.target.files?.[0] ?? null })
                    }
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                  />
                </div>

                {/* Only the last row may be dropped: removing one from the
                middle would leave a gap in a record that reads forwards. */}
                {index === rows.length - 1 && rows.length > 1 && (
                  <div className="mt-3">
                    <Button
                      variant="ghost"
                      onClick={() => setRows((current) => current.slice(0, -1))}
                    >
                      Remove semester {row.semesterNumber}
                    </Button>
                  </div>
                )}
              </fieldset>
            ))}
          </div>

          {following !== null && (
            <div className="mt-4">
              <Button
                variant="secondary"
                onClick={() => setRows((current) => [...current, blank(following)])}
              >
                + Add semester {following}
              </Button>
            </div>
          )}

          {problems.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {problems.map((problem) => (
                <li key={problem} className="text-sm font-medium text-destructive">
                  {problem}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={sending} onClick={() => void submit()}>
              {sending ? "Sending…" : "Submit for verification"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRows([]);
                setProblems([]);
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
