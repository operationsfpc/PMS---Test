import { DrilldownModal } from "@components/drilldown-modal";
import { Badge, Button } from "@components/ui";
import { applicationEvidenceProblems } from "@domain/application-snapshot";
import { useCallback, useEffect, useState } from "react";
import { ApplyError } from "../student/apply-repository";
import type { OpenDrive } from "../student/drives-list";

/** The two answers the canonical page needs from the student's drive gateway. */
export interface StudentApplyView {
  openDrive(driveId: string): Promise<OpenDrive | null>;
  apply(driveId: string, resume: File | null): Promise<void>;
}

/**
 * 2026-10-29 UAT: the canonical drive page an applicant links to from a card
 * had no Apply on it at all — the one page that shows the whole drive left the
 * student to walk back to the list. The bar centred here stays in view while
 * the long page scrolls, and asks R5/R6 the same way the card does, so the two
 * cannot disagree about whether this student may apply.
 *
 * It renders nothing when `openDrive` says the drive is invisible to them or
 * already applied to; a drive that is merely closed to this student shows the
 * refusal in place of a button, as on the card.
 */
export function StudentApplyBar({ driveId, view }: { driveId: string; view: StudentApplyView }) {
  /** undefined while the verdict is still being read. */
  const [card, setCard] = useState<OpenDrive | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resume, setResume] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCard(await view.openDrive(driveId));
      setError(null);
    } catch {
      setError("Could not check whether you can apply. Please try again.");
      setCard(undefined);
    }
  }, [view, driveId]);

  useEffect(() => {
    void load();
  }, [load]);

  function closeConfirm() {
    if (busy) return;
    setConfirming(false);
    setResume(null);
    setProblem(null);
    setError(null);
  }

  async function confirm() {
    if (card === null || card === undefined) return;

    const problems = applicationEvidenceProblems({
      hasDriveResume: resume !== null,
      hasProfileResume: card.profileResumeName !== null,
    });
    if (problems.length > 0) {
      setProblem(problems.join(" "));
      return;
    }

    setProblem(null);
    setError(null);
    setBusy(true);
    try {
      await view.apply(card.id, resume);
      setCard({ ...card, applied: true, canApply: false });
      setConfirming(false);
      setResume(null);
    } catch (caught) {
      setError(
        caught instanceof ApplyError ? caught.message : "Could not submit your application.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (card === undefined) {
    if (error === null) return null;
    return (
      <Bar>
        <p role="alert" className="text-sm text-danger-500">
          {error}
        </p>
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          Try again
        </Button>
      </Bar>
    );
  }

  if (card === null) return null;

  return (
    <>
      <Bar>
        {card.applied ? (
          <Badge tone="success">Application submitted</Badge>
        ) : card.canApply ? (
          <Button
            aria-label={`Apply to ${card.companyName} — ${card.roleTitle}`}
            onClick={() => {
              setConfirming(true);
              setResume(null);
              setProblem(null);
              setError(null);
            }}
          >
            Apply
          </Button>
        ) : (
          <p className="max-w-md text-center text-sm font-medium text-danger-500 break-words">
            {card.refusal}
          </p>
        )}
      </Bar>

      {confirming && (
        <DrilldownModal
          eyebrow="Apply"
          title={`${card.companyName} — ${card.roleTitle}`}
          subtitle="An application cannot be withdrawn."
          onClose={closeConfirm}
        >
          {/* F14: the same last reversible moment the card gives (PRD §7.4). */}
          <p className="font-semibold text-ink-900">
            Are you sure you want to apply for this drive?
          </p>
          <p className="mt-1 text-sm text-ink-700">
            If you apply, you are expected to <strong>attend all the rounds</strong> of this drive,
            and to <strong>accept the final offer</strong> if you get one. An application cannot be
            withdrawn.
          </p>

          <div className="mt-3">
            {card.profileResumeName !== null && (
              <p className="mb-2 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-ink-700">
                Your saved resume <strong>{card.profileResumeName}</strong> will be sent with this
                application unless you upload a different one below.
              </p>
            )}
            <label
              htmlFor={`record-resume-${card.id}`}
              className="mb-1 block text-sm font-medium text-ink-700"
            >
              {card.profileResumeName === null ? (
                <>
                  Resume for this drive <span className="text-destructive">*</span>
                </>
              ) : (
                "Replace with a drive-specific resume (optional)"
              )}
            </label>
            <p className="mb-2 text-xs text-ink-500">
              This is what {card.companyName} will read. Tailor it to this role rather than sending
              the one on your profile.
            </p>
            <input
              id={`record-resume-${card.id}`}
              type="file"
              accept="application/pdf"
              onChange={(e) => setResume(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-neutral-300 bg-surface px-3 py-2 text-sm"
            />
            {problem !== null && (
              <p className="mt-1 text-xs font-medium text-danger-500">{problem}</p>
            )}
          </div>

          {error !== null && (
            <p role="alert" className="mt-3 text-sm text-danger-500">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button isLoading={busy} onClick={() => void confirm()}>
              Yes, apply
            </Button>
            <Button variant="secondary" onClick={closeConfirm}>
              Cancel
            </Button>
          </div>
        </DrilldownModal>
      )}
    </>
  );
}

/** The centred pill that floats over the page while it scrolls. */
function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-6 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur-xs sm:rounded-full">
        {children}
      </div>
    </div>
  );
}
