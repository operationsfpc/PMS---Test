import { Button, Card } from "@components/ui";
import { programmeLabel, validateProgramme } from "@domain/programmes";
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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRows(await view.programmes(campusId));
  }, [view, campusId]);

  useEffect(() => {
    void refresh();
    void view.options().then(setOptions);
  }, [refresh, view]);

  /** Only this degree's branches: the pair has to be one that exists. */
  const branches = options.find((o) => o.degree === degree)?.branches ?? [];

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

  async function add() {
    const programme: NewProgramme = {
      campusId,
      degree,
      branch,
      passingYear: Number(year),
    };

    // The rule is the domain's, so this screen and the database refuse for the
    // same reason and say the same thing.
    const problems = validateProgramme(programme);
    if (problems.length > 0) {
      setProblem(problems.join(" "));
      return;
    }

    setProblem(null);
    setError(null);
    try {
      await view.add(programme);
      setBranch("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add that programme.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await view.remove(id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove that programme.");
    }
  }

  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold text-ink-900">Programmes at {campusName}</h3>
      <p className="mt-1 text-sm text-ink-500">
        What this college runs, per year of passing. Students choose one of these on their
        registration form.
      </p>

      {error !== null && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
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
            <div key={group.passingYear}>
              <h4 className="text-sm font-semibold text-ink-700">{group.passingYear}</h4>
              <ul className="mt-1 divide-y divide-neutral-200">
                {group.programmes.map((row) => {
                  const label = programmeLabel(row.degree, row.branch);
                  return (
                    <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-sm text-ink-800">
                        {label}
                        <span className="ml-2 text-xs text-ink-500">{row.passingYear}</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${label} for ${row.passingYear}`}
                        onClick={() => void remove(row.id)}
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

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <div>
          <label
            htmlFor={`degree-${campusId}`}
            className="mb-1 block text-sm font-medium text-ink-700"
          >
            Degree
          </label>
          <select
            id={`degree-${campusId}`}
            value={degree}
            onChange={(e) => {
              setDegree(e.target.value);
              // A branch from the previous degree would pair two things that
              // never went together.
              setBranch("");
            }}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="">Select…</option>
            {options.map((option) => (
              <option key={option.degree} value={option.degree}>
                {option.degree}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={`branch-${campusId}`}
            className="mb-1 block text-sm font-medium text-ink-700"
          >
            Branch
          </label>
          <select
            id={`branch-${campusId}`}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            {/* An MBA genuinely has none, so "no branch" is a real answer. */}
            <option value="">No branch</option>
            {branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={`year-${campusId}`}
            className="mb-1 block text-sm font-medium text-ink-700"
          >
            Year of passing
          </label>
          <input
            id={`year-${campusId}`}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-end">
          <Button variant="secondary" onClick={() => void add()}>
            Add programme
          </Button>
        </div>
      </div>

      {problem !== null && <p className="mt-2 text-sm text-destructive">{problem}</p>}
    </Card>
  );
}
