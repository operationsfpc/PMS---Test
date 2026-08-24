import { Badge, Button, Card, PageHeader } from "@components/ui";
import type { OfferCategory } from "@domain/offer-category";
import type { DriveType } from "@domain/types";
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
}

export interface OfferCandidate {
  readonly applicationId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly rollNumber: string;
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
 * This is an explicit act, not an inference from the last round. The CTC is
 * pre-filled from the drive but editable per student (A16), because the
 * per-student figure is what R9 uses to resolve the placement record - a range
 * on the PIF is not what the student was actually offered.
 */
export function OfferPage({ driveId, view }: { driveId: string; view: OfferView }) {
  const [drive, setDrive] = useState<OfferDrive | null>(null);
  const [candidates, setCandidates] = useState<readonly OfferCandidate[] | null>(null);
  const [ctc, setCtc] = useState<Record<string, string>>({});
  const [letters, setLetters] = useState<Record<string, File | null>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loadedDrive, loadedCandidates] = await Promise.all([
      view.drive(driveId),
      view.candidates(driveId),
    ]);
    setDrive(loadedDrive);
    setCandidates(loadedCandidates);
    setCtc((current) => {
      const next = { ...current };
      for (const candidate of loadedCandidates) {
        next[candidate.studentId] ??= String(loadedDrive.suggestedCtcLpa);
      }
      return next;
    });
  }, [view, driveId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function declare(candidate: OfferCandidate) {
    if (drive === null) return;
    setError(null);

    const value = Number(ctc[candidate.studentId] ?? "");
    if (!Number.isFinite(value) || value <= 0) {
      setError(`Enter a valid CTC in LPA for ${candidate.studentName}.`);
      return;
    }

    try {
      await view.declare({
        studentId: candidate.studentId,
        driveId,
        companyName: drive.companyName,
        roleTitle: drive.roleTitle,
        driveType: drive.driveType,
        offerCategory: drive.offerCategory,
        ctcLpa: value,
        // Spec B: the letter travels with the declaration when one was chosen.
        letter: letters[candidate.studentId] ?? null,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not declare the offer.");
    }
  }

  return (
    <div>
      <PageHeader
        title={drive === null ? "Final selection" : `${drive.companyName} — final selection`}
        subtitle="Being placed is declared here. It is never inferred from the last round."
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {candidates === null ? (
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
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{candidate.studentName}</p>
                  <p className="text-sm text-ink-500">{candidate.rollNumber}</p>
                </div>

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
                            void (async () => {
                              setError(null);
                              try {
                                await view.attachLetter?.(candidate.studentId, driveId, file);
                                await refresh();
                              } catch (cause) {
                                setError(
                                  cause instanceof Error
                                    ? cause.message
                                    : "Could not file the offer letter.",
                                );
                              }
                            })();
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
                    <div>
                      <label
                        htmlFor={`ctc-${candidate.studentId}`}
                        className="mb-1 block text-xs font-medium text-ink-700"
                      >
                        CTC (LPA)
                      </label>
                      <input
                        id={`ctc-${candidate.studentId}`}
                        inputMode="decimal"
                        value={ctc[candidate.studentId] ?? ""}
                        onChange={(e) => setCtc({ ...ctc, [candidate.studentId]: e.target.value })}
                        className="w-28 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <Button onClick={() => void declare(candidate)}>Declare selected</Button>
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
