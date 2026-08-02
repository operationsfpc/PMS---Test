import { Button, Card, PageHeader } from "@components/ui";
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
    setSelected((current) =>
      current.includes(applicationId)
        ? current.filter((id) => id !== applicationId)
        : [...current, applicationId],
    );
  }

  async function save() {
    setError(null);
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
        })),
      );
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
        ranking is advisory — your selection is what is recorded.
      </p>

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
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
              return (
                <li key={candidate.applicationId} className="flex items-start gap-4 p-4">
                  <input
                    type="checkbox"
                    aria-label={`Shortlist ${candidate.studentName}`}
                    checked={selected.includes(candidate.applicationId)}
                    onChange={() => toggle(candidate.applicationId)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-900">
                      <span className="text-ink-400">{index + 1}.</span>{" "}
                      <span>{candidate.studentName}</span>
                    </p>
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
