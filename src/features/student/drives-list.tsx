import { Badge, Button, Card, PageHeader } from "@components/ui";
import { applicationEvidenceProblems } from "@domain/application-snapshot";
import { driveTypeLabel, driveTypeTone } from "@domain/drive-type";
import {
  type OfferCategory,
  offerCategoryLabel,
  offerCategoryRestatesType,
} from "@domain/offer-category";
import { describeTimeLeft } from "@domain/student-drive-lists";
import type { DriveType, RoleCategory } from "@domain/types";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
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
  /** J2/J3 (2026-08-18): worded by @domain/shift and @domain/joining. */
  readonly shift: string;
  readonly joining: string;
  /** J1: a short-lived signed link to the recruiter's own JD, or null. */
  readonly jobDescriptionUrl: string | null;
  readonly jobDescriptionName: string | null;
  readonly mandatorySkills: string;
  readonly driveMode: string;
  /**
   * UAT 2026-08-21 item 2: already worded by `@domain/drive-venue` — the
   * venue itself, "Venue to be confirmed", or "" when the mode has none.
   */
  readonly venue: string;
  readonly applicationStart: string | null;
  readonly rounds: readonly { readonly sequence: number; readonly name: string }[];
}

/** One row as the student sees it. R5/R6 have already been applied upstream. */
export interface OpenDrive {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string;
  /** N7: the four-list screen filters on it. */
  readonly roleCategory: RoleCategory;
  /** 2026-08-27: filtered on, and tagged on every card. */
  readonly driveType?: DriveType | null;
  readonly ctcLabel: string;
  readonly offerCategory: OfferCategory | null;
  readonly applicationEnd: string;
  readonly canApply: boolean;
  /** Student-facing prose, already translated from R6's refusal code. */
  readonly refusal: string | null;
  readonly applied: boolean;
  /**
   * D2 (UAT 2026-08-19): the saved per-area resume that will be sent if the
   * student uploads nothing. Null when they have none for this role area —
   * then the upload is required, as F14 originally asked.
   */
  readonly profileResumeName: string | null;
  readonly details: OpenDriveDetails;
}

export interface DrivesView {
  openDrives(): Promise<readonly OpenDrive[]>;
  /**
   * F14 + D2: `resume` is the drive-specific override; null means "send the
   * saved per-area resume", which the snapshot builder picks automatically.
   */
  apply(driveId: string, resume: File | null): Promise<void>;
}

const day = (iso: string | null) =>
  iso === null ? "—" : new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

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
export function DrivesList({
  view,
  embedded = false,
  now = () => new Date(),
}: {
  view: DrivesView;
  /** True inside the four-tab screen, which brings its own heading. */
  embedded?: boolean;
  now?: () => Date;
}) {
  const [rows, setRows] = useState<readonly OpenDrive[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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
    const problems = applicationEvidenceProblems({
      hasDriveResume: resume !== null,
      hasProfileResume: drive.profileResumeName !== null,
    });
    if (problems.length > 0) {
      setProblem(problems.join(" "));
      return;
    }

    setProblem(null);
    setBusyId(drive.id);
    setError(null);
    try {
      await view.apply(drive.id, resume);
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
      {!embedded && (
        <PageHeader
          title="Open drives"
          subtitle="Drives you are eligible for. Applying cannot be withdrawn."
        />
      )}

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
            const confirming = confirmingId === drive.id;

            return (
              <Card key={drive.id} className="p-5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h2 className="font-[Raleway] text-lg font-bold text-ink-900">
                    {drive.companyName}
                  </h2>
                  {/* 2026-08-27: the type tag. */}
                  {drive.driveType !== undefined && drive.driveType !== null && (
                    <Badge tone={driveTypeTone(drive.driveType)}>
                      {driveTypeLabel(drive.driveType)}
                    </Badge>
                  )}
                  {/* PB3: an internship's CATEGORY is "Internship" and so is
                      its type tag. The same word twice, in two colours, says
                      nothing the second time. The rule moved into the domain
                      2026-08-27 — as a literal here, three other screens that
                      show both facts never got it. */}
                  {drive.offerCategory !== null &&
                    !offerCategoryRestatesType(drive.driveType ?? null, drive.offerCategory) && (
                      <Badge tone="brand">{offerCategoryLabel(drive.offerCategory)}</Badge>
                    )}
                  {drive.applied && <Badge tone="success">Applied</Badge>}
                </div>
                <p className="text-sm text-ink-500">
                  {drive.roleTitle} · {drive.ctcLabel}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  Applications close {day(drive.applicationEnd)}
                </p>
                {/* N7: closing time SHOWN, hot under 24 hours. */}
                {!drive.applied &&
                  (() => {
                    const left = describeTimeLeft(new Date(drive.applicationEnd), now());
                    return (
                      <p
                        className={`mt-2 inline-block rounded-lg px-2.5 py-1 text-xs font-semibold ${
                          left.urgent
                            ? "bg-[#FF7200] text-white"
                            : "bg-surface-muted text-[#3D3777]"
                        }`}
                      >
                        {left.urgent ? "🔥 " : "⏳ "}
                        {left.label}
                      </p>
                    );
                  })()}
                {/* N1: the card links to the drive's one canonical page. */}
                <p className="mt-2">
                  <Link
                    to={`/drives/${drive.id}`}
                    className="text-xs font-semibold text-[#3D3777] underline underline-offset-2"
                  >
                    View everything about {drive.companyName}
                  </Link>
                </p>

                {/* ⚠️ F14's "View more" expander DELIBERATELY REMOVED
                    2026-08-24 (Karthik): "view everything is sufficient."
                    Every detail it showed lives on the canonical /drives/:id
                    page the link above opens. */}
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
                      {/* D2: the saved per-area resume is the default; the
                          upload replaces it. With none on file the upload is
                          required, as F14 originally asked. */}
                      {drive.profileResumeName !== null && (
                        <p className="mb-2 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-ink-700">
                          Your saved resume <strong>{drive.profileResumeName}</strong> will be sent
                          with this application unless you upload a different one below.
                        </p>
                      )}
                      <label
                        htmlFor={`resume-${drive.id}`}
                        className="mb-1 block text-sm font-medium text-ink-700"
                      >
                        {drive.profileResumeName === null ? (
                          <>
                            Resume for this drive <span className="text-destructive">*</span>
                          </>
                        ) : (
                          "Replace with a drive-specific resume (optional)"
                        )}
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
