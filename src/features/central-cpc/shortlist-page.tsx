import { Badge, Button, Card, PageHeader } from "@components/ui";
import { serialiseCsv } from "@domain/csv";
import { describeDriveFreeze } from "@domain/drive-working";
import { DEFAULT_RANKING_WEIGHTS, rankApplicants } from "@domain/ranking";
import {
  buildRecruiterCsvRows,
  buildRecruiterExport,
  EXPORT_COLUMNS,
  RECRUITER_CSV_COLUMNS,
  recruiterPackProblem,
  resumePackFilename,
  type ShortlistEntry,
} from "@domain/recruiter-export";
import { checkShortlistTarget } from "@domain/shortlist-target";
import { SKILL_SCORE_MAX } from "@domain/skills";
import type { DriveStatus, RoleCategory } from "@domain/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { buildRecruiterZip } from "./export-pack";

export interface ShortlistApplicant {
  readonly applicationId: string;
  /** The student behind the application, so a row can reach their record. */
  readonly studentId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  /** Their own college — a drive targets several, and rank is read across them. */
  readonly college?: string | null;
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
  /**
   * Where the drive is in its lifecycle — the fact that decides whether this
   * screen may write anything at all (2026-10-18). Asking it of the drive
   * rather than trusting the tab the coordinator arrived on is what stops a
   * completed drive being shortlisted again.
   *
   * Null means the read did not carry it — which is not evidence of a closed
   * drive, so the screen stays as it was instead of locking on a missing fact.
   */
  readonly status: DriveStatus | null;
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
  /** WS8: the saved entries with their frozen snapshots, for the export. */
  exportEntries(driveId: string): Promise<readonly ShortlistEntry[]>;
  /** PRD §13.2: every export is a data-sharing event and is logged. */
  logExport(driveId: string, columns: readonly string[], studentCount: number): Promise<void>;
  /**
   * Answer 5a (2026-08-24): the resumes travel IN the pack. Keyed by resume
   * document id; the extension comes from the stored file. Optional so the
   * older tests and mocks keep compiling — absent means an empty pack.
   */
  resumeFiles?(
    resumeIds: readonly string[],
  ): Promise<ReadonlyMap<string, { data: ArrayBuffer; extension: string }>>;
  /**
   * DB / Storage direct links for resumes (signed URLs).
   * Used for CSV export with direct clickable links instead of separate zip files.
   */
  resumeSignedUrls?(
    resumeIds: readonly string[],
    expiresInSeconds?: number,
  ): Promise<ReadonlyMap<string, string>>;
}

/** Real downloads go through a Blob; tests hand in a spy. */
function browserDownload(filename: string, content: Blob | string): void {
  const blob =
    typeof content === "string" ? new Blob([content], { type: "text/csv;charset=utf-8" }) : content;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
export function ShortlistPage({
  driveId,
  view,
  download = browserDownload,
}: {
  driveId: string;
  view: ShortlistView;
  download?: (filename: string, content: Blob | string) => void;
}) {
  const [drive, setDrive] = useState<ShortlistDrive | null>(null);
  const [applicants, setApplicants] = useState<readonly ShortlistApplicant[] | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  /**
   * F16 (UAT 2026-08-06): "After shortlisting the candidates, the screen stays
   * the same, this needs to be fixed." It saved, re-read, and came back pixel
   * for pixel identical — so a save that worked was indistinguishable from one
   * that silently did not, and the button got pressed again.
   */
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [missingResumes, setMissingResumes] = useState<readonly string[]>([]);
  /**
   * D7: an opted-out applicant is excluded until the coordinator overrides
   * with a reason. Keyed by application; the reason travels with the save.
   */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [overriding, setOverriding] = useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = useState("");
  /** F2 (UAT 2026-08-19): the save waits behind an explicit confirmation. */
  const [confirming, setConfirming] = useState(false);
  /** D6: advisory only — a number the CPC steers by, never a gate. */
  const [target, setTarget] = useState("");
  /**
   * UAT 2026-08-26: a shortlist that does not match the recruiter's ask is
   * saved only after the mismatch has been read and ticked. Advisory still —
   * the tick is available immediately — but it cannot be clicked through by
   * reflex, and a save that notifies students deserves that much.
   */
  const [acknowledgedTarget, setAcknowledgedTarget] = useState(false);
  /**
   * SPEC CHANGE 2026-08-21 (Karthik): the already-shortlisted and the not-yet
   * are SEPARATE TABS. Before this, the saved students came back pre-ticked in
   * the same list — so they could be selected and "shortlisted again", and
   * un-ticking one silently REMOVED them on the next save. Decided people are
   * read-only now; only the undecided can be selected and shortlisted.
   */
  const [tab, setTab] = useState<"pending" | "shortlisted">("pending");

  const refresh = useCallback(async () => {
    const [loadedDrive, loadedApplicants] = await Promise.all([
      view.drive(driveId),
      view.applicants(driveId),
    ]);
    setDrive(loadedDrive);
    setApplicants(loadedApplicants);
    // Nothing is pre-selected: the shortlisted are decided, not "ticked".
    setSelected([]);
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

  /**
   * Whether this drive's status still allows shortlisting at all — null while
   * it does, the sentence to say while it does not. The lifecycle is the
   * drive's, not the tab's, so a completed or unpublished drive is closed here
   * even when it was opened straight from a link (2026-10-18).
   */
  const freeze = describeDriveFreeze("shortlist", drive?.status ?? null);

  /** The two tabs. Ranks stay OVERALL positions, so the audit trail's rank
   * means the same thing it always did (PRD 13.1). */
  const alreadyShortlisted = useMemo(
    () => (applicants ?? []).filter((a) => a.shortlisted),
    [applicants],
  );
  const rankedWithPosition = useMemo(
    () => ranked.map((candidate, index) => ({ candidate, rank: index + 1 })),
    [ranked],
  );
  const visibleRanked = useMemo(
    () =>
      rankedWithPosition.filter(
        ({ candidate }) =>
          (byId.get(candidate.applicationId)?.shortlisted === true) === (tab === "shortlisted"),
      ),
    [rankedWithPosition, byId, tab],
  );

  /**
   * UAT 2026-08-26: "2 of 1 selected" was printed and the save went through
   * unremarked. The comparison itself is a business rule and lives in
   * `@domain/shortlist-target`; the screen only decides how loudly to say it.
   * The already-shortlisted count toward the ask — they hold seats.
   */
  const targetCheck = useMemo(
    () => checkShortlistTarget({ target, count: alreadyShortlisted.length + selected.length }),
    [target, alreadyShortlisted.length, selected.length],
  );

  function toggle(applicationId: string) {
    // Any change makes the confirmation stale: what is on screen is no longer
    // what was saved, and leaving it up would say otherwise.
    setSavedCount(null);
    setAcknowledgedTarget(false);
    setSelected((current) =>
      current.includes(applicationId)
        ? current.filter((id) => id !== applicationId)
        : [...current, applicationId],
    );
  }

  /**
   * D9 (UAT 2026-08-19): every applicant who is actually selectable — an
   * opted-out student without an override is not, and "select all" must never
   * sweep one in by stealth.
   */
  const selectable = useMemo(
    () =>
      (applicants ?? [])
        .filter((a) => !a.shortlisted)
        .filter((a) => !a.optedOut || overrides[a.applicationId] !== undefined)
        .map((a) => a.applicationId),
    [applicants, overrides],
  );
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.includes(id));

  function toggleAll() {
    setSavedCount(null);
    setAcknowledgedTarget(false);
    setSelected(allSelected ? [] : selectable);
  }

  /**
   * Recruiter CSV export with direct DB signed URLs for resumes.
   * Eliminates the need to download binary files and bundle them into a zip,
   * providing instant, clickable links directly to the PDFs in Supabase storage.
   */
  async function exportShortlistCsv() {
    setError(null);
    setExportFeedback(null);
    setExporting(true);
    try {
      const entries = await view.exportEntries(driveId);
      const pack = buildRecruiterExport(entries);

      if (pack.rows.length === 0) {
        setError("No shortlisted candidates to export.");
        return;
      }

      const signedUrls =
        (await view.resumeSignedUrls?.(pack.resumeIds)) ?? new Map<string, string>();

      const csvRows = buildRecruiterCsvRows(entries, signedUrls);
      const companyName = drive?.companyName ?? "drive";
      const company = companyName.toLowerCase().replaceAll(/\s+/g, "-");
      const columns = [...RECRUITER_CSV_COLUMNS];
      const csvContent = `\uFEFF${serialiseCsv(columns, csvRows)}`;
      download(`shortlist-${company}.csv`, csvContent);

      await view.logExport(driveId, columns, csvRows.length);
      setExportFeedback(`Exported ${csvRows.length} shortlisted candidates with resume links.`);
      setMissingResumes([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the shortlist.");
    } finally {
      setExporting(false);
    }
  }

  /**
   * WS8 (D4), reshaped by answers 5a/5b (2026-08-24): ONE zip —
   * shortlist.xlsx beside resumes/, each row hyperlinking its candidate's
   * file — built from the SNAPSHOTS (R7), included students only. A missing
   * resume BLOCKS the export outright (5b): half a pack reads as complete to
   * the recruiter, and nobody re-counts the folder against the sheet. Logged
   * before it is called done: an unlogged export never happened.
   */
  async function exportShortlist() {
    setError(null);
    try {
      const entries = await view.exportEntries(driveId);
      const pack = buildRecruiterExport(entries);

      const problem = recruiterPackProblem(pack);
      if (problem !== null) {
        setError(problem);
        return;
      }

      const resumes =
        (await view.resumeFiles?.(pack.resumeIds)) ??
        new Map<string, { data: ArrayBuffer; extension: string }>();
      const files = entries.flatMap((entry) => {
        if (!entry.included || entry.snapshot.resumeId === null) return [];
        const file = resumes.get(entry.snapshot.resumeId);
        if (file === undefined) return [];
        const roll = entry.snapshot.profile.rollNumber;
        return [
          {
            rollNumber: roll,
            // Named for the person reading the folder, not for the database —
            // and by the domain, so a slash in a name cannot turn one
            // candidate's CV into a folder the sheet never links to
            // (UAT 2026-08-26).
            filename: resumePackFilename(roll, entry.snapshot.profile.fullName, file.extension),
            data: file.data,
          },
        ];
      });

      const companyName = drive?.companyName ?? "drive";
      const blob = await buildRecruiterZip(companyName, pack.rows, files);
      const company = companyName.toLowerCase().replaceAll(/\s+/g, "-");
      download(`shortlist-${company}.zip`, blob);
      await view.logExport(driveId, [...EXPORT_COLUMNS, "Resume"], pack.rows.length);
      setMissingResumes([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the shortlist.");
    }
  }

  async function save() {
    setError(null);
    setSavedCount(null);
    setSaving(true);
    try {
      // Only the UNDECIDED travel with the save. The already-shortlisted are
      // settled rows — re-sending them would re-notify and re-stamp decisions
      // that were already made (the "shortlist them again" bug, 2026-08-21).
      await view.saveShortlist(
        driveId,
        rankedWithPosition
          .filter(({ candidate }) => byId.get(candidate.applicationId)?.shortlisted !== true)
          .map(({ candidate, rank }) => ({
            applicationId: candidate.applicationId,
            included: selected.includes(candidate.applicationId),
            rank,
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
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              isLoading={exporting}
              onClick={() => void exportShortlistCsv()}
              disabled={exporting || alreadyShortlisted.length === 0 || freeze !== null}
              title="Downloads the shortlist as it is saved in the database"
            >
              {exporting ? "Exporting CSV…" : "Export shortlist (CSV)"}
            </Button>
            {/* Both exports read the SAVED shortlist, so on a drive where nobody
                is on it yet they could only refuse. A control that cannot do
                anything is not offered — and a greyed button says why. */}
            <Button
              variant="secondary"
              disabled={alreadyShortlisted.length === 0 || freeze !== null}
              onClick={() => void exportShortlist()}
              title="Downloads shortlist.xlsx beside the resume files"
            >
              Export recruiter pack (ZIP)
            </Button>
            {alreadyShortlisted.length === 0 && freeze === null && (
              <span className="text-xs text-ink-500">
                Both exports send the saved shortlist — shortlist someone first.
              </span>
            )}
            <Button
              isLoading={saving}
              // "Shortlist 0" is a real decision: it records everyone still on
              // this tab as left off. Refusing it would leave the exclusions
              // unsaid.
              disabled={freeze !== null}
              onClick={() => setConfirming(true)}
            >
              {`Shortlist ${selected.length}`}
            </Button>
          </span>
        }
      />

      {/* The state, not the person, refused — so the reason is on the screen
          and not merely a greyed button they have to guess at. */}
      {freeze !== null && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm text-ink-700"
        >
          <strong>This shortlist is closed.</strong> {freeze}
        </p>
      )}

      <p className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-ink-700">
        Ranking and rationale are internal and are <strong>never shown to students</strong>. The
        order is advisory — your selection is what is recorded. Saving{" "}
        <strong>notifies the shortlisted students</strong> and{" "}
        <strong>schedules them for Round 1</strong>.
      </p>

      {/* What the role asks for, and how many the recruiter wanted. Both
          describe the drive rather than the decision in progress, so they are
          one strip — and every other notice on this page is now conditional,
          which is what keeps the applicants near the top. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line px-4 py-3">
        {/* D8 (UAT 2026-08-19): "No specific skills required" with no detail told
            the coordinator nothing. The drive's own skills, or an honest gap. */}
        {drive !== null && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-ink-700">Skills required:</span>
            {drive.mandatorySkills.length === 0 ? (
              <span className="text-ink-500">
                No specific skills recorded for this role — the PIF left them blank.
              </span>
            ) : (
              drive.mandatorySkills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-accent/40 bg-accent/5 px-2.5 py-0.5 text-xs font-medium text-ink-900"
                >
                  {skill}
                </span>
              ))
            )}
          </p>
        )}

        {/* D6 (UAT 2026-08-19): a number to steer by. Advisory — the recruiter
            asked for so many, and the button never refuses more or fewer. */}
        <label className="flex items-end gap-2 text-xs font-medium text-ink-500">
          Target shortlist size (optional)
          <input
            type="number"
            min="1"
            value={target}
            onChange={(e) => {
              // A changed ask is a different decision — the old acknowledgement
              // dies with it.
              setAcknowledgedTarget(false);
              setTarget(e.target.value);
            }}
            className="w-24 rounded-lg border border-line px-2 py-1.5 text-sm text-ink-900"
          />
        </label>
        {targetCheck.target !== null && (
          <p
            role="status"
            aria-label="Selection against target"
            className={`text-sm font-medium ${
              targetCheck.message === null ? "text-ink-700" : "text-destructive"
            }`}
          >
            {/* The decided count toward the recruiter's ask — already-
                shortlisted people still fill seats (2026-08-21). */}
            {`${targetCheck.count} of ${targetCheck.target} selected`}
            {targetCheck.message !== null && (
              <span className="ml-2 font-normal">— {targetCheck.message}</span>
            )}
          </p>
        )}
      </div>

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {exportFeedback !== null && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-success-700"
        >
          {exportFeedback}
        </div>
      )}

      {missingResumes.length > 0 && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-ink-900"
        >
          Exported without a resume on file: {missingResumes.join(", ")}. The recruiter pack is
          incomplete for them.
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
        <>
          {/* D7 (2026-08-12): "applied but not yet shortlisted should not be
              shortlisted. This is an alert. Central PC can override."

              It sits with the rows it warns about rather than in the stack
              above them: those rows already carry the "Opted out" badge and the
              override button, so this line only says how many and which. */}
          {applicants.some((a) => a.optedOut && !a.shortlisted) && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-ink-900"
            >
              <strong>Opted out after applying:</strong>{" "}
              {applicants
                .filter((a) => a.optedOut && !a.shortlisted)
                .map((a) => a.studentName)
                .join(", ")}
              . They cannot be shortlisted and will receive no notifications. You can override per
              student, with a reason.
            </div>
          )}

          {/* The two tabs (2026-08-21): decided people are read-only. */}
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setTab("pending")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                tab === "pending"
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-line bg-surface text-ink-700 hover:border-brand-300"
              }`}
            >
              Not shortlisted ({applicants.length - alreadyShortlisted.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("shortlisted")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                tab === "shortlisted"
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-line bg-surface text-ink-700 hover:border-brand-300"
              }`}
            >
              Shortlisted ({alreadyShortlisted.length})
            </button>
          </div>

          <Card>
            {/* D9: one box for the lot. Indeterminate states are more honest as
                a plain label, so the box is checked only when ALL are.
                A closed drive offers no selection at all — not a tick that
                cannot be saved. */}
            {tab === "pending" && visibleRanked.length > 0 && freeze === null && (
              <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all applicants"
                  checked={allSelected}
                  onChange={toggleAll}
                />
                <span className="text-sm font-medium text-ink-700">
                  Select all ({selectable.length})
                </span>
              </div>
            )}
            {visibleRanked.length === 0 && (
              <p className="p-6 text-sm text-ink-700">
                {tab === "pending"
                  ? "Everyone who applied is already on the shortlist."
                  : "Nobody is on the shortlist yet."}
              </p>
            )}
            <ul className="divide-y divide-neutral-200">
              {visibleRanked.map(({ candidate, rank }) => {
                const applicant = byId.get(candidate.applicationId);
                const blocked = applicant?.optedOut === true;
                const overridden = overrides[candidate.applicationId] !== undefined;
                return (
                  <li
                    key={candidate.applicationId}
                    aria-label={candidate.studentName}
                    className="flex items-start gap-4 p-4"
                  >
                    {/* Decided rows carry NO checkbox — a shortlisted student
                        cannot be shortlisted again (2026-08-21). Neither does a
                        row on a drive whose shortlist is closed. */}
                    {tab === "shortlisted" || freeze !== null ? null : blocked && !overridden ? (
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
                        {/* The rank that is SAVED, spelled as such. This used to
                            print the position inside whichever tab was open, so
                            the "1." on a card and the rank in the audit trail
                            were two different numbers. */}
                        <span className="text-ink-400">Rank {rank}</span>
                        {applicant === undefined ? (
                          <span>{candidate.studentName}</span>
                        ) : (
                          <Link to={`/students/${applicant.studentId}`} className="hover:underline">
                            {candidate.studentName}
                          </Link>
                        )}
                        {/* F16: what is ON the shortlist, as opposed to what is
                          merely ticked, is the difference the screen used to
                          refuse to show. A tick is not a decision, so the two
                          never print the same word. */}
                        {applicant?.shortlisted === true && (
                          <Badge tone="success">Shortlisted</Badge>
                        )}
                        {applicant?.shortlisted !== true &&
                          selected.includes(candidate.applicationId) && (
                            <Badge tone="brand">Will shortlist on save</Badge>
                          )}
                        {blocked && <Badge tone="danger">Opted out</Badge>}
                      </p>
                      {tab === "pending" &&
                        freeze === null &&
                        blocked &&
                        !overridden &&
                        overriding !== candidate.applicationId && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="mt-1"
                            onClick={() => {
                              setOverriding(candidate.applicationId);
                              setOverrideDraft("");
                            }}
                          >
                            Override with reason…
                          </Button>
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
                      {/* "1  KG-Test  CGPA 8.5" read as three unexplained
                          tokens. Each now says what it is, and the CGPA is left
                          to the reasoning line below rather than stated twice
                          in one card. */}
                      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
                        {applicant !== undefined && <span>Roll {applicant.rollNumber}</span>}
                        {applicant?.college != null && applicant.college !== "" && (
                          <span
                            title="College campus"
                            className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700"
                          >
                            <span className="sr-only">College: </span>
                            {applicant.college}
                          </span>
                        )}
                      </p>
                      {/* G5a (UAT 2026-08-20): "Scored on 0 of 1 required
                        skills" told the coordinator nothing about what the
                        student HAS. Their own scores, or an honest gap. */}
                      {applicant !== undefined &&
                        (applicant.skillScores.length === 0 ? (
                          /* Only a gap when the role actually asked for skills.
                             Otherwise the reasoning line below already says "No
                             specific skills required for this role." */
                          drive !== null && drive.mandatorySkills.length > 0 ? (
                            <p className="mt-1 text-xs text-ink-500">No skill scores recorded.</p>
                          ) : null
                        ) : (
                          <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                            {applicant.skillScores.map(({ skill, score }) => (
                              <span
                                key={skill}
                                className="rounded-full border border-line bg-surface-muted px-2 py-0.5 font-medium text-ink-700"
                              >
                                {skill} {score}/{SKILL_SCORE_MAX}
                              </span>
                            ))}
                          </p>
                        ))}
                      <ul className="mt-1 text-xs text-ink-500">
                        {candidate.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                    {/*
                     * The score used to be printed here. Removed 2026-08-17: it
                     * was not used, and a number nobody acts on is a number that
                     * has to be explained forever. It is still CALCULATED - it
                     * orders this list - and still saved with the decision,
                     * because PRD 13.1 wants the recommendation kept beside the
                     * choice. It is simply not shown.
                     */}
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}

      {/* F2 (UAT 2026-08-19): an accidental save notifies real students and
          schedules them for a round — so the save asks first. */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div
            role="alertdialog"
            aria-label="Confirm shortlist"
            className="my-auto w-full max-w-md rounded-card bg-white p-6 shadow-xl"
          >
            <h2 className="font-heading text-lg font-bold text-ink-900">Confirm the shortlist</h2>
            <p className="mt-2 text-sm text-ink-700">
              <strong>{selected.length}</strong> {selected.length === 1 ? "student" : "students"}{" "}
              will be shortlisted for {drive?.companyName ?? "this drive"}. They will be{" "}
              <strong>notified</strong> and <strong>scheduled for Round 1</strong>. {(() => {
                // "Left off" counts only the UNDECIDED — the already-
                // shortlisted are neither re-saved nor left off (2026-08-21).
                const undecided = ranked.length - alreadyShortlisted.length;
                const leftOff = undecided - selected.length;
                return leftOff > 0 ? (
                  <>
                    {leftOff} {leftOff === 1 ? "applicant" : "applicants"} will be left off.
                  </>
                ) : null;
              })()}
            </p>

            {/* UAT 2026-08-26: the recruiter asked for a number. Saying it
                here — and making it a deliberate tick — is the difference
                between an advisory target and a target nobody reads. */}
            {targetCheck.message !== null && (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-ink-900">
                <p className="font-medium text-destructive">{targetCheck.message}</p>
                <label className="mt-3 flex items-start gap-2 text-sm text-ink-900">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acknowledgedTarget}
                    onChange={(e) => setAcknowledgedTarget(e.target.checked)}
                  />
                  <span>
                    I know this differs from the target and want to shortlist{" "}
                    <strong>{targetCheck.count}</strong> anyway.
                  </span>
                </label>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                disabled={targetCheck.message !== null && !acknowledgedTarget}
                onClick={() => {
                  setConfirming(false);
                  void save();
                }}
              >
                Confirm — notify and schedule
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
