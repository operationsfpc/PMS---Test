import { Button, Card, PageHeader } from "@components/ui";
import { parseCsv } from "@domain/csv";
import {
  parseSkillScore,
  parseSkillSheet,
  type SkillSheetRejection,
  skillAreaKey,
  validateSkillAreaName,
} from "@domain/skills";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * PRD §5 — the Central Student Skill Repository.
 *
 * Institutional scores per student (aptitude, communication, programming, AI
 * capability, …), maintained by the Central CPC. Three ways in — one cell,
 * one score across selected students, a CSV of the whole cohort — and every
 * one of them runs the same domain validation, because these numbers later
 * feed shortlisting (R11).
 *
 * A missing score is shown as "—" and stored as NOTHING. It is never zero:
 * "unmeasured" must not read as "assessed and failed".
 */

export interface SkillArea {
  readonly id: string;
  readonly name: string;
}

export interface SkillStudentRow {
  readonly studentId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly campusName: string;
  /** Recorded scores by skill-area id. Absence means "not assessed". */
  readonly scores: Readonly<Record<string, number>>;
}

export interface ScoreChange {
  readonly studentId: string;
  readonly skillAreaId: string;
  /** null clears the score — "no longer assessed", never zero. */
  readonly score: number | null;
}

export interface SkillsView {
  areas(): Promise<readonly SkillArea[]>;
  students(): Promise<readonly SkillStudentRow[]>;
  addArea(name: string): Promise<SkillArea>;
  saveScores(changes: readonly ScoreChange[]): Promise<void>;
}

/** CSV-quotes a field only when it needs it. */
const csvField = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function SkillsPage({ view }: { view: SkillsView }) {
  const searchId = useId();
  const newAreaId = useId();
  const bulkAreaId = useId();
  const bulkScoreId = useId();
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [areas, setAreas] = useState<readonly SkillArea[] | null>(null);
  const [students, setStudents] = useState<readonly SkillStudentRow[] | null>(null);

  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newArea, setNewArea] = useState("");

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkArea, setBulkArea] = useState("");
  const [bulkScore, setBulkScore] = useState("");

  const [sheet, setSheet] = useState<{
    readonly changes: readonly ScoreChange[];
    readonly importable: number;
    readonly rejected: readonly SkillSheetRejection[];
  } | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([view.areas(), view.students()]).then(([a, s]) => {
      if (active) {
        setAreas(a);
        setStudents(s);
      }
    });
    return () => {
      active = false;
    };
  }, [view]);

  const visible = useMemo(() => {
    if (students === null) return [];
    const needle = search.trim().toLowerCase();
    if (needle === "") return students;
    return students.filter(
      (s) =>
        s.studentName.toLowerCase().includes(needle) || s.rollNumber.toLowerCase().includes(needle),
    );
  }, [students, search]);

  if (areas === null || students === null) {
    return (
      <p role="status" className="p-6 text-sm text-neutral-500">
        Loading the skill repository…
      </p>
    );
  }

  const say = (message: string) => {
    setStatus(message);
    setError(null);
  };
  const complain = (message: string) => {
    setError(message);
    setStatus(null);
  };

  async function commit(changes: readonly ScoreChange[], done: () => void) {
    setBusy(true);
    try {
      await view.saveScores(changes);
      const refreshed = await view.students();
      setStudents(refreshed);
      done();
      say(`Saved ${changes.length} score${changes.length === 1 ? "" : "s"}.`);
    } catch {
      complain("Could not save the scores. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(student: SkillStudentRow) {
    if (areas === null) return;
    setEditing(student.studentId);
    setDraft(
      Object.fromEntries(
        areas.map((a) => [
          a.id,
          student.scores[a.id] === undefined ? "" : String(student.scores[a.id]),
        ]),
      ),
    );
    setError(null);
    setStatus(null);
  }

  async function saveEdit(student: SkillStudentRow) {
    if (areas === null) return;
    const changes: ScoreChange[] = [];
    for (const area of areas) {
      const typed = (draft[area.id] ?? "").trim();
      const existing = student.scores[area.id];
      if (typed === "") {
        // Cleared: remove the score. Blank-and-was-blank is no change.
        if (existing !== undefined) {
          changes.push({ studentId: student.studentId, skillAreaId: area.id, score: null });
        }
        continue;
      }
      const parsed = parseSkillScore(typed);
      if (!parsed.ok) {
        complain(`${area.name}: ${parsed.reason}`);
        return;
      }
      if (parsed.score !== existing) {
        changes.push({ studentId: student.studentId, skillAreaId: area.id, score: parsed.score });
      }
    }
    if (changes.length === 0) {
      setEditing(null);
      return;
    }
    await commit(changes, () => setEditing(null));
  }

  async function addArea() {
    if (areas === null) return;
    const problem = validateSkillAreaName(
      newArea,
      areas.map((a) => a.name),
    );
    if (problem !== null) {
      complain(problem);
      return;
    }
    setBusy(true);
    try {
      const created = await view.addArea(newArea.trim().replace(/\s+/g, " "));
      setAreas([...areas, created]);
      setNewArea("");
      say(`Added "${created.name}".`);
    } catch {
      complain("Could not add the skill area. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function applyBulk() {
    const areaId = bulkArea !== "" ? bulkArea : (areas?.[0]?.id ?? "");
    if (areaId === "" || selected.size === 0) return;
    const parsed = parseSkillScore(bulkScore);
    if (!parsed.ok) {
      complain(parsed.reason);
      return;
    }
    const changes = (students ?? [])
      .filter((s) => selected.has(s.studentId))
      .map(
        (s): ScoreChange => ({ studentId: s.studentId, skillAreaId: areaId, score: parsed.score }),
      );
    await commit(changes, () => setSelected(new Set()));
  }

  async function onFile(file: File | undefined) {
    setSheet(null);
    setStatus(null);
    setError(null);
    if (file === undefined || areas === null || students === null) return;

    const parsed = parseSkillSheet(
      parseCsv(await file.text()),
      areas.map((a) => a.name),
    );
    if (parsed.fatal !== null) {
      complain(parsed.fatal);
      return;
    }

    const areaByKey = new Map(areas.map((a) => [skillAreaKey(a.name), a.id]));
    const studentByRoll = new Map(students.map((s) => [s.rollNumber, s.studentId]));

    const rejected: SkillSheetRejection[] = [...parsed.rejected];
    const changes: ScoreChange[] = [];
    let importable = 0;
    for (const row of parsed.accepted) {
      const studentId = studentByRoll.get(row.rollNumber);
      if (studentId === undefined) {
        rejected.push({
          row: row.row,
          reason: `Roll number "${row.rollNumber}" is not on the roster.`,
        });
        continue;
      }
      importable += 1;
      for (const score of row.scores) {
        const skillAreaId = areaByKey.get(skillAreaKey(score.area));
        if (skillAreaId === undefined) continue; // Unreachable: columns were checked.
        changes.push({ studentId, skillAreaId, score: score.score });
      }
    }
    rejected.sort((a, b) => a.row - b.row);
    setSheet({ changes, importable, rejected });
  }

  async function runImport() {
    if (sheet === null || sheet.changes.length === 0) return;
    await commit(sheet.changes, () => {
      setSheet(null);
      if (fileRef.current !== null) fileRef.current.value = "";
    });
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(
    [
      ["roll_number", ...areas.map((a) => a.name)].map(csvField).join(","),
      ...students.map((s) => csvField(s.rollNumber)),
      "",
    ].join("\n"),
  )}`;

  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.studentId));

  return (
    <>
      <PageHeader
        title="Skill repository"
        subtitle="Institutional scores per student — these feed shortlisting."
      />

      {error !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {error}
          </p>
        </Card>
      )}
      {status !== null && (
        <Card className="mb-4 border border-[#1EE0E1] bg-[#ECF1F0] p-4">
          <p role="status" className="text-sm text-ink-900">
            {status}
          </p>
        </Card>
      )}

      <Card className="mb-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={newAreaId} className="mb-1 block text-sm font-medium text-ink-900">
              New skill area
            </label>
            <div className="flex gap-2">
              <input
                id={newAreaId}
                type="text"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                placeholder="e.g. Cloud fundamentals"
                value={newArea}
                onChange={(e) => setNewArea(e.target.value)}
              />
              <Button disabled={busy} onClick={() => void addArea()}>
                Add skill area
              </Button>
            </div>
          </div>

          <div>
            <label htmlFor={fileId} className="mb-1 block text-sm font-medium text-ink-900">
              Scores file (CSV)
            </label>
            <input
              id={fileId}
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <p className="mt-1 text-xs text-ink-500">
              Columns: roll_number, then one column per skill area. Blank cells leave the existing
              score untouched.{" "}
              <a
                className="font-medium text-brand-600 underline"
                href={templateHref}
                download="skill-scores-template.csv"
              >
                Download template
              </a>
            </p>
          </div>
        </div>
      </Card>

      {sheet !== null && (
        <Card className="mb-4 p-5">
          <p className="text-sm font-semibold text-ink-900">
            {`${sheet.importable} row${sheet.importable === 1 ? "" : "s"} ready to import.`}
          </p>
          {sheet.rejected.length > 0 && (
            <>
              <p className="mt-1 text-sm text-[#DD4820]">
                {`${sheet.rejected.length} row${sheet.rejected.length === 1 ? "" : "s"} cannot be imported.`}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {sheet.rejected.map((r) => (
                  <li key={`${r.row}-${r.reason}`} className="text-sm text-ink-700">
                    <strong>Row {r.row}:</strong> {r.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          {sheet.importable > 0 && (
            <div className="mt-4">
              <Button disabled={busy} onClick={() => void runImport()}>
                {`Import ${sheet.importable} row${sheet.importable === 1 ? "" : "s"}`}
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor={searchId} className="mb-1 block text-sm font-medium text-ink-900">
              Search students
            </label>
            <input
              id={searchId}
              type="search"
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
              placeholder="Name or roll number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor={bulkAreaId} className="mb-1 block text-sm font-medium text-ink-900">
              Skill area
            </label>
            <select
              id={bulkAreaId}
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
              value={bulkArea !== "" ? bulkArea : (areas[0]?.id ?? "")}
              onChange={(e) => setBulkArea(e.target.value)}
            >
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={bulkScoreId} className="mb-1 block text-sm font-medium text-ink-900">
              Score
            </label>
            <input
              id={bulkScoreId}
              type="text"
              inputMode="decimal"
              className="w-28 rounded-lg border border-line bg-white px-3 py-2 text-sm"
              value={bulkScore}
              onChange={(e) => setBulkScore(e.target.value)}
            />
          </div>

          <Button disabled={busy || selected.size === 0} onClick={() => void applyBulk()}>
            {`Apply to ${selected.size} selected`}
          </Button>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        {visible.length === 0 ? (
          <p className="p-6 text-sm text-ink-700">
            {students.length === 0
              ? "No students on the roster yet."
              : "No students match the search."}
          </p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected(
                        allVisibleSelected ? new Set() : new Set(visible.map((s) => s.studentId)),
                      )
                    }
                  />
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-ink-900">
                  Student
                </th>
                {areas.map((a) => (
                  <th key={a.id} scope="col" className="px-4 py-3 font-semibold text-ink-900">
                    {a.name}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((student) => {
                const isEditing = editing === student.studentId;
                return (
                  <tr key={student.studentId} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        aria-label={`Select ${student.studentName}`}
                        checked={selected.has(student.studentId)}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(student.studentId)) next.delete(student.studentId);
                          else next.add(student.studentId);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-ink-900">{student.studentName}</p>
                      <p className="text-xs text-ink-500">
                        {student.rollNumber} · {student.campusName}
                      </p>
                    </td>
                    {areas.map((area) => (
                      <td key={area.id} className="px-4 py-3 align-top tabular-nums">
                        {isEditing ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={area.name}
                            className="w-20 rounded-lg border border-line bg-white px-2 py-1 text-sm"
                            value={draft[area.id] ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, [area.id]: e.target.value }))}
                          />
                        ) : (
                          (student.scores[area.id] ?? "—")
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3 align-top">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <Button disabled={busy} onClick={() => void saveEdit(student)}>
                            Save
                          </Button>
                          <button
                            type="button"
                            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-surface-muted"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-surface-muted"
                          aria-label={`Edit ${student.studentName}`}
                          onClick={() => startEdit(student)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
