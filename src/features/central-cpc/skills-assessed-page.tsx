import { Button, Card, PageHeader } from "@components/ui";
import { canRemoveSkillArea, validateSkillAreaName } from "@domain/skills";
import { useCallback, useEffect, useState } from "react";
import type { SkillAreaUsage, SkillsView } from "./skills-page";

/**
 * Skills assessed (2026-08-24, answers 1a/2a/3a).
 *
 * The master list of core skills students are trained and evaluated on. One
 * list, three consumers: the score-upload template's columns, the upload's
 * validation, and the AE's mandatory-skills picker on the PIF. Managing it on
 * its own page keeps "what we assess" a deliberate decision rather than a
 * side effect of scoring.
 *
 * 1a: rename freely — scores follow the skill. Remove only while no scores
 * exist (the FK refuses otherwise, 0059). 2a: Central CPC manages it — the
 * view refuses everyone else and RLS refuses regardless.
 */
export function SkillsAssessedPage({ view }: { view: SkillsView }) {
  const [skills, setSkills] = useState<readonly SkillAreaUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSkills(await view.areasWithUsage());
      setError(null);
    } catch {
      setError("Could not load the skills. Please try again.");
      setSkills(null);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  function complain(message: string) {
    setError(message);
    setStatus(null);
  }

  function say(message: string) {
    setStatus(message);
    setError(null);
  }

  async function add() {
    if (skills === null) return;
    const problem = validateSkillAreaName(
      newName,
      skills.map((s) => s.name),
    );
    if (problem !== null) {
      complain(problem);
      return;
    }
    setBusy(true);
    try {
      const created = await view.addArea(newName.trim().replace(/\s+/g, " "));
      setSkills(
        [...skills, { ...created, scoreCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewName("");
      say(`Added "${created.name}". It is now a template column and a PIF option.`);
    } catch (caught) {
      complain(caught instanceof Error ? caught.message : "Could not add the skill.");
    } finally {
      setBusy(false);
    }
  }

  async function rename(skill: SkillAreaUsage) {
    if (skills === null) return;
    const problem = validateSkillAreaName(
      renameDraft,
      skills.filter((s) => s.id !== skill.id).map((s) => s.name),
    );
    if (problem !== null) {
      complain(problem);
      return;
    }
    setBusy(true);
    try {
      const cleaned = renameDraft.trim().replace(/\s+/g, " ");
      await view.renameArea(skill.id, cleaned);
      setSkills(
        skills
          .map((s) => (s.id === skill.id ? { ...s, name: cleaned } : s))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setRenamingId(null);
      say(`Renamed to "${cleaned}". The scores under it follow the skill.`);
    } catch (caught) {
      complain(caught instanceof Error ? caught.message : "Could not rename the skill.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(skill: SkillAreaUsage) {
    if (skills === null) return;
    setBusy(true);
    try {
      await view.removeArea(skill.id);
      setSkills(skills.filter((s) => s.id !== skill.id));
      setConfirmingId(null);
      say(`Removed "${skill.name}".`);
    } catch (caught) {
      complain(caught instanceof Error ? caught.message : "Could not remove the skill.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Skills assessed"
        subtitle="The core skills students are trained and evaluated on."
      />

      <Card className="mb-4 p-4">
        <p className="text-sm text-ink-700">
          This list drives three things: the columns of the score <strong>upload template</strong>,
          the validation of every score upload, and the mandatory-skills options an Account
          Executive can pick on the <strong>position information form</strong>. Skills outside this
          list can be named on a PIF only as "other skills", and cannot be scored.
        </p>
      </Card>

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

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="new-skill" className="mb-1 block text-sm font-medium text-ink-700">
              New skill
            </label>
            <input
              id="new-skill"
              className="rounded-lg border border-neutral-300 bg-surface px-3 py-2 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button disabled={busy} onClick={() => void add()}>
            Add skill
          </Button>
        </div>
      </Card>

      {skills === null ? (
        error === null ? (
          <p role="status" className="p-6 text-sm text-neutral-500">
            Loading the skills…
          </p>
        ) : null
      ) : (
        <div className="flex flex-col gap-3">
          {skills.map((skill) => {
            const removal = canRemoveSkillArea(skill.scoreCount);

            return (
              <Card key={skill.id} className="p-4">
                {renamingId === skill.id ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label
                        htmlFor={`rename-${skill.id}`}
                        className="mb-1 block text-sm font-medium text-ink-700"
                      >
                        New name for {skill.name}
                      </label>
                      <input
                        id={`rename-${skill.id}`}
                        className="rounded-lg border border-neutral-300 bg-surface px-3 py-2 text-sm"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                      />
                    </div>
                    <Button disabled={busy} onClick={() => void rename(skill)}>
                      Save
                    </Button>
                    <Button variant="ghost" onClick={() => setRenamingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink-900">{skill.name}</p>
                      <p className="text-xs text-ink-500">
                        {skill.scoreCount === 0
                          ? "No scores recorded yet"
                          : `${skill.scoreCount} score${skill.scoreCount === 1 ? "" : "s"} recorded`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        aria-label={`Rename ${skill.name}`}
                        onClick={() => {
                          setRenamingId(skill.id);
                          setRenameDraft(skill.name);
                          setConfirmingId(null);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Remove ${skill.name}`}
                        disabled={!removal.allowed || busy}
                        onClick={() => setConfirmingId(skill.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                )}

                {!removal.allowed && renamingId !== skill.id && (
                  <p className="mt-2 text-xs text-ink-500">{removal.reason}</p>
                )}

                {confirmingId === skill.id && removal.allowed && (
                  <div className="mt-3 rounded-lg border border-gold-300 bg-gold-50 p-3">
                    <p className="text-sm text-ink-900">
                      Remove "{skill.name}"? It disappears from the upload template and the PIF's
                      options.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button disabled={busy} onClick={() => void remove(skill)}>
                        Yes, remove
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
