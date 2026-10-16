import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  PageHeader,
} from "@components/ui";
import { applicationEvidenceProblems } from "@domain/application-snapshot";
import { driveTypeLabel, driveTypeTone } from "@domain/drive-type";
import {
  type OfferCategory,
  offerCategoryLabel,
  offerCategoryRestatesType,
} from "@domain/offer-category";
import { describeTimeLeft } from "@domain/student-drive-lists";
import type { DriveType, RoleCategory } from "@domain/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ApplyError } from "./apply-repository";

/** Groups individual drives by their parent company event for multi-role display. */
function groupDrivesByEvent(drives: readonly OpenDrive[]): OpenDriveEvent[] {
  const groups = new Map<string, OpenDrive[]>();

  for (const drive of drives) {
    const key = drive.companyDriveId || `standalone:${drive.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(drive);
    } else {
      groups.set(key, [drive]);
    }
  }

  return Array.from(groups.entries()).map(([key, roles]) => {
    const first = roles[0];
    if (!first) throw new Error("Group has no roles");
    return {
      eventId: key,
      companyName: first.companyName,
      tentativeDate: first.tentativeDate,
      driveMode: first.details.driveMode,
      venue: first.details.venue,
      roles,
    };
  });
}

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
  /** Multi-role grouping: the parent event ID (null for legacy standalone drives). */
  readonly companyDriveId: string | null;
  /** Multi-role grouping: the event date (from drives table). */
  readonly tentativeDate: string | null;
}

/** Grouped drives by company event - shows all roles from one company visit together. */
export interface OpenDriveEvent {
  readonly eventId: string;
  readonly companyName: string;
  readonly tentativeDate: string | null;
  readonly driveMode: string;
  readonly venue: string;
  readonly roles: readonly OpenDrive[];
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
 * What tells one role on a visit apart from its siblings: its category when
 * that is not simply the type worded again, its own type when the visit as a
 * whole cannot name one, and whether this student has already applied.
 *
 * `showType` is false when the card header already states the type for every
 * role. PB3: an internship's CATEGORY is "Internship" and so is its type tag —
 * the same word twice, in two colours, says nothing the second time. That rule
 * lives in `@domain/offer-category`, moved there 2026-08-27 because three
 * other screens that show both facts never got it.
 */
function RoleFacts({ drive, showType }: { drive: OpenDrive; showType: boolean }) {
  return (
    <>
      {showType && drive.driveType !== undefined && drive.driveType !== null && (
        <Badge tone={driveTypeTone(drive.driveType)}>{driveTypeLabel(drive.driveType)}</Badge>
      )}
      {drive.offerCategory !== null &&
        !offerCategoryRestatesType(drive.driveType ?? null, drive.offerCategory) && (
          <Badge tone="brand">{offerCategoryLabel(drive.offerCategory)}</Badge>
        )}
      {drive.applied && <Badge tone="success">Applied</Badge>}
    </>
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

  const events = useMemo(() => (rows ? groupDrivesByEvent(rows) : []), [rows]);

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
          {events.map((event) => {
            const isMultiRole = event.roles.length > 1;
            /* The visit's type, said once: a Zoho that raised three SDE roles is
               three rows of the same kind, and a visit that mixes an internship
               with a full-time role says so rather than picking one at random. */
            const types = new Set(event.roles.map((role) => role.driveType ?? null));
            const [singleType] = types;
            const visitType = types.size === 1 ? (singleType ?? null) : undefined;

            /** A single-role visit needs no folding, so its name is a plain row. */
            const roleLine = (drive: OpenDrive) => (
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-ink-900">{drive.roleTitle}</h3>
                <RoleFacts drive={drive} showType={visitType === undefined} />
              </div>
            );

            /**
             * Everything a role does, below its name: when it closes, how much
             * time is left, the canonical page, and the application itself.
             */
            const roleBody = (drive: OpenDrive) => {
              const confirming = confirmingId === drive.id;
              return (
                <>
                  <p className="mt-1 text-xs text-ink-500">
                    Applications close {day(drive.applicationEnd)}
                  </p>
                  {/* N7: closing time SHOWN, hot under 24 hours. */}
                  {!drive.applied &&
                    (() => {
                      const left = describeTimeLeft(
                        new Date(drive.applicationEnd),
                        now(),
                        drive.details.applicationStart
                          ? new Date(drive.details.applicationStart)
                          : null,
                      );
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
                      {/* Per-role: a multi-role event card holds one of these per
                          role, and the company alone would name them all the
                          same. */}
                      View everything about {drive.companyName} — {drive.roleTitle}
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
                      aria-label={`Confirm applying to ${drive.companyName} — ${drive.roleTitle}`}
                      className="mt-4 rounded-lg border border-gold-300 bg-gold-50 p-4"
                    >
                      <p className="font-semibold text-ink-900">
                        Are you sure you want to apply for this drive?
                      </p>
                      <p className="mt-1 text-sm text-ink-700">
                        If you apply, you are expected to <strong>attend all the rounds</strong> of
                        this drive, and to <strong>accept the final offer</strong> if you get one.
                        An application cannot be withdrawn.
                      </p>

                      <div className="mt-3">
                        {/* D2: the saved per-area resume is the default; the
                              upload replaces it. With none on file the upload is
                              required, as F14 originally asked. */}
                        {drive.profileResumeName !== null && (
                          <p className="mb-2 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-ink-700">
                            Your saved resume <strong>{drive.profileResumeName}</strong> will be
                            sent with this application unless you upload a different one below.
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
                        <Button isLoading={busyId === drive.id} onClick={() => void confirm(drive)}>
                          Yes, apply
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </section>
                  ) : drive.canApply ? (
                    <div className="mt-4">
                      <Button
                        aria-label={`Apply to ${drive.companyName} — ${drive.roleTitle}`}
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
                </>
              );
            };

            return (
              <Card key={event.eventId} className="overflow-hidden">
                {/* One company visit is one card, and the COMPANY is its headline
                    whatever the number of roles under it (2026-10-16: "it should
                    show company name"). A student decides whether to give an
                    afternoon to Zoho, not to a list of job titles that happen to
                    share a date, a venue and one interview process. */}
                <div className="border-b border-line bg-brand-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-[Raleway] text-lg font-bold text-ink-900">
                      {event.companyName}
                    </h2>
                    {/* A visit where no role declared a type says nothing rather
                        than "Type not set" — the same rule RoleFacts follows one
                        level down. */}
                    {visitType !== null && (
                      <Badge tone={visitType === undefined ? "neutral" : driveTypeTone(visitType)}>
                        {visitType === undefined ? "Mixed types" : driveTypeLabel(visitType)}
                      </Badge>
                    )}
                    {isMultiRole && <Badge tone="brand">{event.roles.length} roles</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-sm text-ink-600">
                    {event.tentativeDate && (
                      <span>
                        📅{" "}
                        {new Date(event.tentativeDate).toLocaleDateString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
                      </span>
                    )}
                    {event.driveMode && <span>· {event.driveMode.replace(/_/g, " ")}</span>}
                    {event.venue && event.venue !== "Venue to be confirmed" && (
                      <span>· {event.venue}</span>
                    )}
                  </div>
                </div>

                {/* The roles fold into an accordion when there is more than one,
                    each trigger naming the role, its type and its money. They are
                    OPEN, not tidied away: every one of these rows is an offer to
                    act on, and a collapsed panel would hide the only button the
                    card exists for. A single-role visit gets no accordion — there
                    is nothing to fold, and one more click for one row is a cost
                    with no return. */}
                {isMultiRole ? (
                  <Accordion
                    multiple
                    className="px-4"
                    defaultValue={event.roles.map((role) => role.id)}
                  >
                    {event.roles.map((drive) => (
                      <AccordionItem key={drive.id} value={drive.id}>
                        <AccordionTrigger className="py-3">
                          <span className="font-semibold text-ink-900">{drive.roleTitle}</span>
                          <RoleFacts drive={drive} showType={visitType === undefined} />
                          <span className="text-sm font-normal text-ink-600">{drive.ctcLabel}</span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-4">{roleBody(drive)}</AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                ) : (
                  <div className="divide-y divide-line">
                    {event.roles.map((drive) => (
                      <div key={drive.id} className="p-4">
                        {roleLine(drive)}
                        <p className="text-sm text-ink-600">{drive.ctcLabel}</p>
                        {roleBody(drive)}
                      </div>
                    ))}
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
