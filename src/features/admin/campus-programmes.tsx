import { Button, Card } from "@components/ui";
import { programmeLabel, validateProgramme } from "@domain/programmes";
import { useAsyncAction } from "@lib/use-async-action";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface ProgrammeRow {
  readonly id: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
}

/** The catalogue an Admin picks from: a degree, and the branches it has. */
export interface DegreeOption {
  readonly degree: string;
  readonly branches: readonly string[];
}

export interface NewProgramme {
  readonly campusId: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
}

export interface CampusProgrammesView {
  programmes(campusId: string): Promise<readonly ProgrammeRow[]>;
  options(): Promise<readonly DegreeOption[]>;
  add(programme: NewProgramme): Promise<void>;
  remove(programmeId: string): Promise<void>;
}

/**
 * What one college runs, and for whom. F6 (UAT 2026-08-06).
 *
 * "A separate page for degree and branches is not required for the admin. This
 * is always mapped to colleges for a particular year of Passing. Degree+Branch
 * is one field."
 *
 * It is one field to the STUDENT because there is only ever one thing to pick.
 * The Admin still chooses the two halves, because a branch belongs to a degree
 * and pairing them freely is how "B.E — Finance" ends up on a record.
 *
 * Grouped by passing year: that is how the question is asked ("what are we
 * running for the 2027 batch?"), and a flat list of thirty rows is not an
 * answer to it.
 */
export function CampusProgrammes({
  campusId,
  campusName,
  view,
}: {
  campusId: string;
  campusName: string;
  view: CampusProgrammesView;
}) {
  const [rows, setRows] = useState<readonly ProgrammeRow[] | null>(null);
  const [options, setOptions] = useState<readonly DegreeOption[]>([]);
  const [degree, setDegree] = useState("");
  const [branch, setBranch] = useState("");
  const [year, setYear] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // Keyed per row: thirty programmes are listed and removing one is a decision
  // about that one row, so its spinner must not answer for the others.
  const actions = useAsyncAction();

  const refresh = useCallback(async () => {
    try {
      setRows(await view.programmes(campusId));
      setProblem(null);
    } catch (cause) {
      // `void refresh()` had no catch: a refused read left the list empty,
      // which reads as "this campus runs no programmes".
      setProblem(
        cause instanceof Error ? cause.message : "Could not load the programmes of this campus.",
      );
    }
  }, [view, campusId]);

  useEffect(() => {
    void refresh();
    view
      .options()
      .then(setOptions)
      .catch(() => setProblem("Could not load the degrees and branches to choose from."));
  }, [refresh, view]);

  /** Only this degree's branches — matched loosely, since the field is typed. */
  const branchSuggestions =
    options.find((o) => o.degree.toLowerCase() === degree.trim().toLowerCase())?.branches ?? [];

  const byYear = useMemo(() => {
    const groups = new Map<number, ProgrammeRow[]>();
    for (const row of rows ?? []) {
      groups.set(row.passingYear, [...(groups.get(row.passingYear) ?? []), row]);
    }
    return (
      [...groups.entries()]
        // Newest cohort first: it is the one being recruited for.
        .sort((a, b) => b[0] - a[0])
        .map(([passingYear, programmes]) => ({
          passingYear,
          programmes: programmes.sort(
            (a, b) => a.degree.localeCompare(b.degree) || a.branch.localeCompare(b.branch),
          ),
        }))
    );
  }, [rows]);

  // The write itself is handed to `useAsyncAction`: a second click on "Add
  // programme" while the first is still out inserts the same degree and branch
  // twice, and the student then sees one programme listed under two ids.
  async function add() {
    const programme: NewProgramme = {
      campusId,
      degree: degree.trim(),
      branch: branch.trim(),
      passingYear: Number(year),
    };

    // The rule is the domain's, so this screen and the database refuse for the
    // same reason and say the same thing. Validation stays here because it is
    // shown under the form, not as the failure alert.
    const problems = validateProgramme(programme);
    if (problems.length > 0) {
      setProblem(problems.join(" "));
      return;
    }

    setProblem(null);
    await view.add(programme);
    setBranch("");
    await refresh();
  }

  async function remove(id: string) {
    await view.remove(id);
    await refresh();
  }

  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold text-ink-900">Programmes at {campusName}</h3>
      <p className="mt-1 text-sm text-ink-500">
        What this college runs, per year of passing. Students choose one of these on their
        registration form.
      </p>

      {actions.error !== null && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {actions.error}
        </p>
      )}

      {rows === null ? (
        <p role="status" className="mt-3 text-sm text-ink-500">
          Loading programmes…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-700">
          No programmes yet. A roster cannot be imported for this college until it runs at least
          one.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {byYear.map((group) => (
            <div
              key={group.passingYear}
              className="rounded-lg border border-line bg-surface p-3.5 shadow-xs"
            >
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-line">
                <span className="font-semibold text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-200">
                  Cohort
                </span>
                <h4 className="text-sm font-bold text-ink-900">{group.passingYear}</h4>
              </div>
              <ul className="divide-y divide-line/60">
                {group.programmes.map((row) => {
                  const label = programmeLabel(row.degree, row.branch);
                  return (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 py-2 px-1 hover:bg-surface-muted/40 rounded transition-colors"
                    >
                      <span className="text-sm font-medium text-ink-800">
                        {label}
                        <span className="ml-2 text-xs text-ink-500">{row.passingYear}</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${label} for ${row.passingYear}`}
                        isLoading={actions.isPending(`remove:${row.id}`)}
                        onClick={() => void actions.run(() => remove(row.id), `remove:${row.id}`)}
                      >
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 rounded-lg border border-line bg-surface-muted/20 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-600 mb-3">
          Add new programme mapping
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label
              htmlFor={`degree-${campusId}`}
              className="mb-1 block text-xs font-medium text-ink-700"
            >
              Degree
            </label>
            <input
              id={`degree-${campusId}`}
              list={`degree-options-${campusId}`}
              value={degree}
              onChange={(e) => {
                setDegree(e.target.value);
                setBranch("");
              }}
              placeholder="Pick or type a new one"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-hidden"
            />
            <datalist id={`degree-options-${campusId}`}>
              {options.map((option) => (
                <option key={option.degree} value={option.degree} />
              ))}
            </datalist>
          </div>

          <div>
            <label
              htmlFor={`branch-${campusId}`}
              className="mb-1 block text-xs font-medium text-ink-700"
            >
              Branch
            </label>
            <input
              id={`branch-${campusId}`}
              list={`branch-options-${campusId}`}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="No branch, or pick / type one"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-hidden"
            />
            <datalist id={`branch-options-${campusId}`}>
              {branchSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div>
            <label
              htmlFor={`year-${campusId}`}
              className="mb-1 block text-xs font-medium text-ink-700"
            >
              Year of passing
            </label>
            <input
              id={`year-${campusId}`}
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2027"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-hidden"
            />
          </div>

          <div className="flex items-end">
            <Button
              variant="secondary"
              isLoading={actions.isPending("add")}
              onClick={() => void actions.run(add, "add")}
              className="w-full sm:w-auto"
            >
              Add programme
            </Button>
          </div>
        </div>
      </div>

      {problem !== null && <p className="mt-2 text-sm text-destructive">{problem}</p>}
    </Card>
  );
}
