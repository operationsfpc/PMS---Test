import { Button, Card, PageHeader } from "@components/ui";
import { useCallback, useEffect, useState } from "react";
import type { DegreeItem, ProgrammesRepository } from "./programmes-repository";

/**
 * Degrees and branches.
 *
 * A roster import refuses an unknown degree, and an unknown non-blank branch
 * (A11), so this screen is what makes a college's roster importable. Nothing
 * is deleted: a branch that stops running is deactivated, because students
 * already reference it.
 */
export function ProgrammesPage({ repository }: { repository: ProgrammesRepository }) {
  const [degrees, setDegrees] = useState<readonly DegreeItem[] | null>(null);
  const [newDegree, setNewDegree] = useState("");
  const [newBranch, setNewBranch] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setDegrees(await repository.list());
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }

  async function addDegree() {
    if (newDegree.trim() === "") return;
    await run(async () => {
      await repository.addDegree(newDegree.trim());
      setNewDegree("");
    });
  }

  async function addBranch(degreeId: string) {
    const name = (newBranch[degreeId] ?? "").trim();
    if (name === "") return;
    await run(async () => {
      await repository.addBranch(degreeId, name);
      setNewBranch({ ...newBranch, [degreeId]: "" });
    });
  }

  return (
    <div>
      <PageHeader
        title="Degrees and branches"
        subtitle="A roster can only be imported for a degree and branch that exist here."
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <Card className="mb-6 p-6">
        <label htmlFor="new-degree" className="mb-1 block text-sm font-medium text-ink-700">
          New degree
        </label>
        <div className="flex flex-wrap gap-3">
          <input
            id="new-degree"
            value={newDegree}
            onChange={(e) => setNewDegree(e.target.value)}
            className="min-w-64 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <Button onClick={() => void addDegree()}>Add degree</Button>
        </div>
      </Card>

      {degrees === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading degrees…
        </p>
      ) : (
        <div className="space-y-4">
          {degrees.map((degree) => (
            <Card key={degree.id} className="p-5">
              <h2 className="text-lg text-ink-900">{degree.name}</h2>

              {degree.branches.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">No branches yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-neutral-200">
                  {degree.branches.map((branch) => (
                    <li key={branch.id} className="flex items-center justify-between gap-4 py-2">
                      <span className="text-sm text-ink-800">
                        {branch.name}
                        {branch.isActive ? "" : " · Inactive"}
                      </span>
                      {branch.isActive && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void run(() => repository.setBranchActive(branch.id, false))
                          }
                        >
                          Deactivate {branch.name}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="flex-1">
                  <label
                    htmlFor={`branch-${degree.id}`}
                    className="mb-1 block text-sm font-medium text-ink-700"
                  >
                    New branch for {degree.name}
                  </label>
                  <input
                    id={`branch-${degree.id}`}
                    value={newBranch[degree.id] ?? ""}
                    onChange={(e) => setNewBranch({ ...newBranch, [degree.id]: e.target.value })}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                  />
                </div>
                <Button variant="secondary" onClick={() => void addBranch(degree.id)}>
                  Add branch to {degree.name}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
