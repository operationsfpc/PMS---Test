import { Badge, Button, Card, PageHeader } from "@components/ui";
import { DEFAULT_RANKING_WEIGHTS, rankApplicants } from "@domain/ranking";
import type { RoleCategory } from "@domain/types";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface ShortlistApplicant {
  readonly applicationId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly overallCgpa: number;
  readonly currentArrears: number;
  readonly historyOfArrears: number;
  readonly skillScores: readonly { skill: string; score: number }[];
  readonly preferredRoleCategories: readonly RoleCategory[];
  readonly shortlisted: boolean;
  /** D7 (2026-08-12): opted out after applying — not shortlistable without an override. */
  readonly optedOut: boolean;
}

export interface ShortlistDrive {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly roleCategory: RoleCategory | null;
  readonly mandatorySkills: readonly string[];
}

/**
 * A decision plus the recommendation that preceded it.
 *
 * PRD 13.1 requires both to be stored: reviewing whether the ranking was any
 * good is impossible if only the coordinator's ticks survive.
 */
export interface ShortlistDecision {
  readonly applicationId: string;
  readonly included: boolean;
  readonly rank: number;
  readonly score: number;
  readonly rationale: string;
  /** D7: the Central CPC's explicit reason for shortlisting an opted-out student. */
  readonly optOutOverrideReason: string | null;
}

export interface ShortlistView {
  drive(driveId: string): Promise<ShortlistDrive>;
  applicants(driveId: string): Promise<readonly ShortlistApplicant[]>;
  saveShortlist(driveId: string, decisions: readonly ShortlistDecision[]): Promise<void>;
}

/**
 * Internal shortlisting.
 *
 * The ranking is R11's, and it is ADVISORY. What gets saved is the
 * coordinator's selection, so the pair (recommendation, decision) can be
 * compared later - which is the point of PRD 13.1's audit requirement.
 *
 * Nothing here is ever shown to a student.
 */
export function ShortlistPage({ driveId, view }: { driveId: string; view: ShortlistView }) {
  const [drive, setDrive] = useState<ShortlistDrive | null>(null);
  const [applicants, setApplicants] = useState<readonly ShortlistApplicant[] | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * F16 (UAT 2026-08-06): "After shortlisting the candidates, the screen stays
   * the same, this needs to be fixed." It saved, re-read, and came back pixel
   * for pixel identical — so a save that worked was indistinguishable from one
   * that silently did not, and the button got pressed again.
   */
  const [savedCount, setSavedCount] = useState<number | null>(null);
  /**
   * D7: an opted-out applicant is excluded until the coordinator overrides
   * with a reason. Keyed by application; the reason travels with the save.
   */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [overriding, setOverriding] = useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = useState("");

  const refresh = useCallback(async () => {
    const [loadedDrive, loadedApplicants] = await Promise.all([
      view.drive(driveId),
      view.applicants(driveId),
    ]);
    setDrive(loadedDrive);
    setApplicants(loadedApplicants);
    setSelected(loadedApplicants.filter((a) => a.shortlisted).map((a) => a.applicationId));
  }, [view, driveId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ranked = useMemo(() => {
    if (applicants === null || drive === null) return [];
    return rankApplicants(
      applicants.map((a) => ({
        applicationId: a.applicationId,
        studentName: a.studentName,
        overallCgpa: a.overallCgpa,
        currentArrears: a.currentArrears,
        historyOfArrears: a.historyOfArrears,
        skillScores: a.skillScores,
        preferredRoleCategories: a.preferredRoleCategories,
      })),
      { roleCategory: drive.roleCategory, mandatorySkills: drive.mandatorySkills },
      DEFAULT_RANKING_WEIGHTS,
    );
  }, [applicants, drive]);

  const byId = useMemo(
    () => new Map((applicants ?? []).map((a) => [a.applicationId, a])),
    [applicants],
  );

  function toggle(applicationId: string) {
    // Any change makes the confirmation stale: what is on screen is no longer
    // what was saved, and leaving it up would say otherwise.
    setSavedCount(null);
    setSelected((current) =>
      current.includes(applicationId)
        ? current.filter((id) => id !== applicationId)
        : [...current, applicationId],
    );
  }

  async function save() {
    setError(null);
    setSavedCount(null);
    setSaving(true);
    try {
      await view.saveShortlist(
        driveId,
        ranked.map((candidate, index) => ({
          applicationId: candidate.applicationId,
          included: selected.includes(candidate.applicationId),
          rank: index + 1,
          score: candidate.score,
          rationale: candidate.reasons.join(" "),
          optOutOverrideReason: overrides[candidate.applicationId] ?? null,
        })),
      );
      // Counted from what was SENT, not from what comes back: a view that
      // returns stale rows must not be able to report a success it did not
      // have. A failure throws before this line.
      setSavedCount(selected.length);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the shortlist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={drive === null ? "Shortlisting" : `Shortlisting — ${drive.companyName}`}
        {...(drive?.roleTitle == null ? {} : { subtitle: drive.roleTitle })}
        actions={
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : `Shortlist ${selected.length}`}
          </Button>
        }
      />

      <p className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-ink-700">
        Ranking and rationale are internal and are <strong>never shown to students</strong>. The
        ranking is advisory — your selection is what is recorded. Saving{" "}
        <strong>notifies the shortlisted students</strong> and{" "}
        <strong>schedules them for Round 1</strong>.
      </p>

      {(applicants ?? []).some((a) => a.optedOut) && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-ink-900"
        >
          <strong>Opted out after applying:</strong>{" "}
          {(applicants ?? [])
            .filter((a) => a.optedOut)
            .map((a) => a.studentName)
            .join(", ")}
          . They cannot be shortlisted and will receive no notifications. You can override per
          student, with a reason.
        </div>
      )}

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {savedCount !== null && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-ink-900"
        >
          Shortlist saved — <strong>{savedCount}</strong>{" "}
          {savedCount === 1 ? "student is" : "students are"} on it. The recruiter export reads this
          list.
        </div>
      )}

      {applicants === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading applicants…
        </p>
      ) : applicants.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">Nobody has applied to this drive yet.</p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {ranked.map((candidate, index) => {
              const applicant = byId.get(candidate.applicationId);
              const blocked = applicant?.optedOut === true;
              const overridden = overrides[candidate.applicationId] !== undefined;
              return (
                <li key={candidate.applicationId} className="flex items-start gap-4 p-4">
                  {blocked && !overridden ? (
                    <span className="mt-1 w-4 text-center text-ink-300" aria-hidden="true">
                      –
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={`Shortlist ${candidate.studentName}`}
                      checked={selected.includes(candidate.applicationId)}
                      onChange={() => toggle(candidate.applicationId)}
                      className="mt-1"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
                      <span className="text-ink-400">{index + 1}.</span>
                      <span>{candidate.studentName}</span>
                      {/* F16: what is ON the shortlist, as opposed to what is
                          merely ticked, is the difference the screen used to
                          refuse to show. */}
                      {applicant?.shortlisted === true && <Badge tone="success">Shortlisted</Badge>}
                      {blocked && <Badge tone="danger">Opted out</Badge>}
                    </p>
                    {blocked && !overridden && overriding !== candidate.applicationId && (
                      <button
                        type="button"
                        className="mt-1 text-xs font-medium text-brand-600 hover:underline"
                        onClick={() => {
                          setOverriding(candidate.applicationId);
                          setOverrideDraft("");
                        }}
                      >
                        Override with reason…
                      </button>
                    )}
                    {overriding === candidate.applicationId && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
                          Reason for overriding the opt-out
                          <input
                            type="text"
                            value={overrideDraft}
                            onChange={(e) => setOverrideDraft(e.target.value)}
                            className="w-64 rounded-lg border border-line px-2 py-1.5 text-sm text-ink-900"
                          />
                        </label>
                        <Button
                          size="sm"
                          onClick={() => {
                            if (overrideDraft.trim() === "") return;
                            setOverrides((o) => ({
                              ...o,
                              [candidate.applicationId]: overrideDraft.trim(),
                            }));
                            setOverriding(null);
                          }}
                        >
                          Confirm override
                        </Button>
                      </div>
                    )}
                    <p className="text-sm text-ink-500">
                      {applicant?.rollNumber} · CGPA {applicant?.overallCgpa}
                    </p>
                    <ul className="mt-1 text-xs text-ink-500">
                      {candidate.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                  <span className="shrink-0 text-lg font-semibold text-brand-600">
                    {candidate.score}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
