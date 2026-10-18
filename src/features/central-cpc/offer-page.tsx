import { ErrorPanel } from "@components/error-panel";
import { StudentIdentity } from "@components/student-identity";
import { Badge, Button, Card, PageHeader } from "@components/ui";
import { describeDriveFreeze } from "@domain/drive-working";
import type { OfferCategory } from "@domain/offer-category";
import { offerCountsAsPackage, offerPayProblem } from "@domain/offer-pay";
import type { DriveStatus, DriveType } from "@domain/types";
import { useAsyncAction } from "@lib/use-async-action";
import { useCallback, useEffect, useState } from "react";
import type { DeclaredOffer } from "./offers-repository";

export interface OfferDrive {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly driveType: DriveType;
  readonly offerCategory: OfferCategory | null;
  /** The drive's ctc_max ?? ctc_min, used only to pre-fill (A16). */
  readonly suggestedCtcLpa: number;
  /**
   * The drive's stipend, used to pre-fill an INTERNSHIP offer (2026-08-27).
   * A plain internship has no CTC to suggest, and the box that demanded one
   * is what recorded ₹10 LPA against ₹15,000 a month.
   */
  readonly suggestedStipendMonthly?: number | null;
  /**
   * The drive's own status. Without it this screen declared an offer against a
   * completed or rejected drive, because it only ever looked at the row.
   */
  readonly status?: DriveStatus | null;
}

export interface OfferCandidate {
  readonly applicationId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  /** Their own college — the offer list runs across every campus the drive hit. */
  readonly college?: string | null;
  readonly declared: boolean;
  /** Spec B: the filed letter's display name, or null when none is on file. */
  readonly letterName?: string | null;
  /** A short-lived signed URL, or null when none could be produced. */
  readonly letterUrl?: string | null;
}

export interface OfferView {
  drive(driveId: string): Promise<OfferDrive>;
  candidates(driveId: string): Promise<readonly OfferCandidate[]>;
  declare(offer: DeclaredOffer): Promise<void>;
  /** Answer 1d: a letter arriving after declaration is still filed. */
  attachLetter?(studentId: string, driveId: string, letter: File): Promise<void>;
}

/**
 * Declaring the final selection.
 *
 * This is an explicit act, not an inference from the last round. The figure is
 * pre-filled from the drive but editable per student (A16), because the
 * per-student figure is what R9 uses to resolve the placement record - a range
 * on the PIF is not what the student was actually offered.
 *
 * WHICH figure depends on the drive (Karthik, 2026-08-27, "option 1"): a plain
 * internship is paid a monthly stipend and everything else an annual CTC. The
 * screen asks for one of them, never both, and the domain decides which.
 */
export function OfferPage({ driveId, view }: { driveId: string; view: OfferView }) {
  const [drive, setDrive] = useState<OfferDrive | null>(null);
  const [candidates, setCandidates] = useState<readonly OfferCandidate[] | null>(null);
  // These two reads used to be a bare `void refresh()` in an effect: when the
  // network refused, the screen sat on "Loading candidates…" forever and said
  // nothing.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pay, setPay] = useState<Record<string, string>>({});
  const [letters, setLetters] = useState<Record<string, File | null>>({});
  // Keyed per student: declaring Nithya must not spin Arjun's button, and a
  // second click on the same row is a second placement record for the same
  // offer.
  const actions = useAsyncAction();

  const refresh = useCallback(async () => {
    const [loadedDrive, loadedCandidates] = await Promise.all([
      view.drive(driveId),
      view.candidates(driveId),
    ]);
    setDrive(loadedDrive);
    setCandidates(loadedCandidates);
    const salaried = offerCountsAsPackage(loadedDrive.driveType);
    const suggestion = salaried
      ? loadedDrive.suggestedCtcLpa
      : (loadedDrive.suggestedStipendMonthly ?? 0);
    setPay((current) => {
      const next = { ...current };
      for (const candidate of loadedCandidates) {
        next[candidate.studentId] ??= suggestion > 0 ? String(suggestion) : "";
      }
      return next;
    });
  }, [view, driveId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    let live = true;
    // A drive that never arrived is not a drive with nobody in it: this used to
    // sit on "Loading candidates…" for ever with the request already rejected.
    refresh().catch(() => {
      if (live) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [refresh, attempt]);

  // Thrown, not returned: `useAsyncAction` turns any rejection into the copy in
  // the alert, so a missing figure and a database refusal arrive the same way
  // — and it refuses the second click while the first is still out. Double
  // declaring is how one student ended up with two placement records.
  async function declare(candidate: OfferCandidate) {
    if (drive === null) return;

    const salaried = offerCountsAsPackage(drive.driveType);
    const typed = (pay[candidate.studentId] ?? "").trim();
    const value = typed === "" ? null : Number(typed);
    const ctcLpa = salaried ? value : null;
    const stipendMonthly = salaried ? null : value;

    // The domain's guard, which mirrors the database constraint. It names the
    // figure that is missing rather than the one this screen happens to show.
    const problem = offerPayProblem({ driveType: drive.driveType, ctcLpa, stipendMonthly });
    if (problem !== null) {
      throw new Error(`${problem} (${candidate.studentName})`);
    }

    await view.declare({
      studentId: candidate.studentId,
      driveId,
      companyName: drive.companyName,
      roleTitle: drive.roleTitle,
      driveType: drive.driveType,
      offerCategory: drive.offerCategory,
      ctcLpa,
      stipendMonthly,
      // Spec B: the letter travels with the declaration when one was chosen.
      letter: letters[candidate.studentId] ?? null,
    });
    await refresh();
  }

  // An offer cannot be declared against a drive whose record is closed. This is
  // the same rule the shortlisting and rounds screens read, in the same words.
  const closed = describeDriveFreeze("offers", drive?.status ?? null);

  return (
    <div>
      <PageHeader
        title={drive === null ? "Final selection" : `${drive.companyName} — final selection`}
        subtitle="Being placed is declared here. It is never inferred from the last round."
      />

      {actions.error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {actions.error}
        </div>
      )}

      {/* The state, not the person, refused — so the reason is on the screen and
          not merely a greyed button the coordinator has to guess at. */}
      {closed !== null && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm text-ink-700"
        >
          <strong>Declaring is closed.</strong> {closed}
        </p>
      )}

      {failed ? (
        <ErrorPanel
          onRetry={() => {
            setFailed(false);
            setAttempt((count) => count + 1);
          }}
          retryLabel="Load this drive again"
        >
          We could not load this drive or the students who reached its final round, so nothing here
          can be declared.
        </ErrorPanel>
      ) : candidates === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading candidates…
        </p>
      ) : candidates.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">Nobody has reached the final round of this drive.</p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {candidates.map((candidate) => (
              <li
                key={candidate.applicationId}
                className="flex flex-wrap items-center justify-between gap-4 p-4"
              >
                <StudentIdentity
                  name={candidate.studentName}
                  rollNumber={candidate.rollNumber}
                  college={candidate.college}
                  studentId={candidate.studentId}
                />

                {candidate.declared ? (
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Spec B: the filed letter, or the late-attach path (1d). */}
                    {candidate.letterUrl != null ? (
                      <a
                        href={candidate.letterUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-brand-600 underline"
                      >
                        {candidate.letterName ?? "Offer letter"}
                      </a>
                    ) : view.attachLetter !== undefined ? (
                      <div>
                        <label
                          htmlFor={`late-letter-${candidate.studentId}`}
                          className="mb-1 block text-xs font-medium text-ink-700"
                        >
                          Attach offer letter (PDF/JPG/PNG)
                        </label>
                        <input
                          id={`late-letter-${candidate.studentId}`}
                          type="file"
                          accept="application/pdf,image/jpeg,image/png"
                          className="text-sm"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file === undefined) return;
                            void actions.run(async () => {
                              await view.attachLetter?.(candidate.studentId, driveId, file);
                              await refresh();
                            }, `attach:${candidate.studentId}`);
                          }}
                        />
                      </div>
                    ) : null}
                    <Badge tone="success">Declared</Badge>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label
                        htmlFor={`letter-${candidate.studentId}`}
                        className="mb-1 block text-xs font-medium text-ink-700"
                      >
                        Offer letter (optional, PDF/JPG/PNG)
                      </label>
                      <input
                        id={`letter-${candidate.studentId}`}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        className="text-sm"
                        onChange={(e) =>
                          setLetters({
                            ...letters,
                            [candidate.studentId]: e.target.files?.[0] ?? null,
                          })
                        }
                      />
                    </div>
                    {/* 2026-08-27: one figure, chosen by the drive. An
                        internship is paid monthly and a salary annually, and
                        offering both boxes is how ₹10 LPA came to describe
                        ₹15,000 a month. */}
                    <div>
                      <label
                        htmlFor={`pay-${candidate.studentId}`}
                        className="mb-1 block text-xs font-medium text-ink-700"
                      >
                        {drive !== null && offerCountsAsPackage(drive.driveType)
                          ? "CTC (LPA)"
                          : "Stipend (\u20b9 / month)"}
                      </label>
                      <input
                        id={`pay-${candidate.studentId}`}
                        inputMode="decimal"
                        value={pay[candidate.studentId] ?? ""}
                        onChange={(e) => setPay({ ...pay, [candidate.studentId]: e.target.value })}
                        className="w-28 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <Button
                      disabled={closed !== null}
                      isLoading={actions.isPending(candidate.studentId)}
                      onClick={() =>
                        void actions.run(() => declare(candidate), candidate.studentId)
                      }
                    >
                      Declare selected
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
