import { Badge, Button, Card, PageHeader } from "@components/ui";
import { applicationEvidenceProblems } from "@domain/application-snapshot";
import type { OfferCategory } from "@domain/offer-category";
import { useCallback, useEffect, useState } from "react";
import { ApplyError } from "./apply-repository";

/** Everything behind "View more" (F14). Null when the drive did not say. */
export interface OpenDriveDetails {
  readonly jobDescription: string;
  /** F7: other job titles this ONE interview process covers. */
  readonly designations: readonly string[];
  readonly locations: string;
  readonly openings: number | null;
  readonly ctcBreakup: string;
  readonly bondDetails: string;
  readonly shiftType: string;
  readonly mandatorySkills: string;
  readonly driveMode: string;
  readonly applicationStart: string | null;
  readonly rounds: readonly { readonly sequence: number; readonly name: string }[];
}

/** One row as the student sees it. R5/R6 have already been applied upstream. */
export interface OpenDrive {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly ctcLabel: string;
  readonly offerCategory: OfferCategory | null;
  readonly applicationEnd: string;
  readonly canApply: boolean;
  /** Student-facing prose, already translated from R6's refusal code. */
  readonly refusal: string | null;
  readonly applied: boolean;
  readonly details: OpenDriveDetails;
}

export interface DrivesView {
  openDrives(): Promise<readonly OpenDrive[]>;
  /** F14: the resume the student chose for THIS drive travels with it. */
  apply(driveId: string, resume: File): Promise<void>;
}

const CATEGORY_LABEL: Record<OfferCategory, string> = {
  regular: "Regular",
  dream: "Dream",
  super_dream: "Super Dream",
};

const day = (iso: string | null) =>
  iso === null ? "—" : new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

/** One labelled fact, omitted entirely when the drive did not supply it. */
function Fact({ label, value }: { label: string; value: string }) {
  if (value.trim() === "") return null;

  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value}</dd>
    </div>
  );
}

/**
 * The student's open drives.
 *
 * Anything hidden by R5 - the category ladder, the internship cap, opt-out,
 * disbarment, failed eligibility - never reaches this list. Showing a student
 * a drive they can never apply to is worse than not showing it.
 *
 * Mobile-first: students are on phones (PRD §21.2), so this is a stacked card
 * list rather than a table.
 */
export function DrivesList({ view }: { view: DrivesView }) {
  const [rows, setRows] = useState<readonly OpenDrive[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** The drive the student has pressed Apply on and not yet confirmed (F14). */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await view.openDrives());
      setError(null);
    } catch {
      setError("Could not load your drives. Please try again.");
      setRows(null);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  function startApplying(driveId: string) {
    setConfirmingId(driveId);
    setResume(null);
    setProblem(null);
    setError(null);
  }

  async function confirm(drive: OpenDrive) {
    // The domain decides what an application must carry, so the screen and the
    // repository refuse for the same reason and say the same words.
    const problems = applicationEvidenceProblems({ hasDriveResume: resume !== null });
    if (problems.length > 0) {
      setProblem(problems.join(" "));
      return;
    }

    setProblem(null);
    setBusyId(drive.id);
    setError(null);
    try {
      await view.apply(drive.id, resume as File);
      setConfirmingId(null);
      setResume(null);
      setRows((current) =>
        (current ?? []).map((r) => (r.id === drive.id ? { ...r, applied: true } : r)),
      );
    } catch (caught) {
      setError(
        caught instanceof ApplyError ? caught.message : "Could not submit your application.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Open drives"
        subtitle="Drives you are eligible for. Applying cannot be withdrawn."
      />

      {error !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {error}
          </p>
        </Card>
      )}

      {rows === null ? (
        error === null ? (
          <p role="status" className="p-6 text-sm text-neutral-500">
            Loading your drives…
          </p>
        ) : null
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            No drives are open to you right now. You will be notified when one is.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((drive) => {
            const open = expandedId === drive.id;
            const confirming = confirmingId === drive.id;

            return (
              <Card key={drive.id} className="p-5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h2 className="font-[Raleway] text-lg font-bold text-ink-900">
                    {drive.companyName}
                  </h2>
                  {drive.offerCategory !== null && (
                    <Badge tone="brand">{CATEGORY_LABEL[drive.offerCategory]}</Badge>
                  )}
                  {drive.applied && <Badge tone="success">Applied</Badge>}
                </div>
                <p className="text-sm text-ink-500">
                  {drive.roleTitle} · {drive.ctcLabel}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  Applications close {day(drive.applicationEnd)}
                </p>

                {/* F14: "Add a view more button to view further details on the
                    drives displayed." Collapsed by default — the list is read
                    on a phone, and ten expanded cards is not a list. */}
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpandedId(open ? null : drive.id)}
                  className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-brand-300"
                >
                  View {open ? "less" : "more"} about {drive.companyName}
                </button>

                {open && (
                  <section
                    aria-label={`${drive.companyName} details`}
                    className="mt-3 rounded-lg bg-surface-muted p-4"
                  >
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <Fact label="About the role" value={drive.details.jobDescription} />
                      <Fact label="Locations" value={drive.details.locations} />
                      <Fact label="CTC breakup" value={drive.details.ctcBreakup} />
                      <Fact label="Must-have skills" value={drive.details.mandatorySkills} />
                      <Fact label="Shift" value={drive.details.shiftType} />
                      <Fact label="Bond / service agreement" value={drive.details.bondDetails} />
                      <Fact
                        label="Openings"
                        value={
                          drive.details.openings === null ? "" : String(drive.details.openings)
                        }
                      />
                      <Fact
                        label="Applications open"
                        value={
                          drive.details.applicationStart === null
                            ? ""
                            : day(drive.details.applicationStart)
                        }
                      />
                      {/* F7: one interview process, several job titles. */}
                      <Fact label="Also hiring for" value={drive.details.designations.join(", ")} />
                    </dl>

                    {drive.details.rounds.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                          Selection rounds
                        </p>
                        {/* Listed because applying is a promise to attend them
                            all — the student should read that promise first. */}
                        <ol className="mt-1 space-y-0.5">
                          {drive.details.rounds.map((round) => (
                            <li key={round.sequence} className="text-sm text-ink-800">
                              {round.sequence}. {round.name}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </section>
                )}

                {drive.applied ? null : confirming ? (
                  /* F14: "Add a warning that you are sure you want to apply
                     for this drive?" There is no withdrawal (PRD §7.4), so
                     this is the last moment the decision is reversible. */
                  <section
                    aria-label={`Confirm applying to ${drive.companyName}`}
                    className="mt-4 rounded-lg border border-gold-300 bg-gold-50 p-4"
                  >
                    <p className="font-semibold text-ink-900">
                      Are you sure you want to apply for this drive?
                    </p>
                    <p className="mt-1 text-sm text-ink-700">
                      If you apply, you are expected to <strong>attend all the rounds</strong> of
                      this drive, and to <strong>accept the final offer</strong> if you get one. An
                      application cannot be withdrawn.
                    </p>

                    <div className="mt-3">
                      <label
                        htmlFor={`resume-${drive.id}`}
                        className="mb-1 block text-sm font-medium text-ink-700"
                      >
                        Resume for this drive <span className="text-destructive">*</span>
                      </label>
                      <p className="mb-2 text-xs text-ink-500">
                        This is what {drive.companyName} will read. Tailor it to this role rather
                        than sending the one on your profile.
                      </p>
                      <input
                        id={`resume-${drive.id}`}
                        type="file"
                        accept="application/pdf"
                        onChange={(e) => setResume(e.target.files?.[0] ?? null)}
                        className="w-full rounded-lg border border-neutral-300 bg-surface px-3 py-2 text-sm"
                      />
                      {problem !== null && (
                        <p className="mt-1 text-xs font-medium text-[#DD4820]">{problem}</p>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button disabled={busyId === drive.id} onClick={() => void confirm(drive)}>
                        {busyId === drive.id ? "Applying…" : "Yes, apply"}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </section>
                ) : drive.canApply ? (
                  <div className="mt-4">
                    <Button
                      aria-label={`Apply to ${drive.companyName}`}
                      onClick={() => startApplying(drive.id)}
                    >
                      Apply
                    </Button>
                    <p className="mt-2 text-xs text-[#FF7200]">
                      An application cannot be withdrawn once submitted.
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-[#DD4820]">{drive.refusal}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
