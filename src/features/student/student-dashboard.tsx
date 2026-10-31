import { ErrorPanel } from "@components/error-panel";
import { NotificationBody } from "@components/notification-body";
import { OfferLetterLink } from "@components/offer-letter-link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  PageHeader,
  StatCard,
} from "@components/ui";
import {
  ABSENCE_LIMIT,
  type AttendanceRecord,
  countAbsences,
  needsDisbarmentReview,
} from "@domain/attendance";
import { groupByCompanyVisit } from "@domain/company-drive";
import { describeMarks } from "@domain/marks";
import { condenseNotifications } from "@domain/notifications";
import { type OfferCategory, offerCategoryLabel } from "@domain/offer-category";
import { describeOfferPay } from "@domain/offer-pay";
import {
  type ApplicantRound,
  type ApplicationProgress,
  applicationProgress,
  studentPrompt,
} from "@domain/student-progress";
import type { DriveType, OfferSource, ParticipationStatus, SrfStatus } from "@domain/types";
import { describeReadFailure } from "@lib/postgrest-read";
import { useEffect, useState } from "react";
import { Link } from "react-router";

export interface StudentSemesterRow {
  readonly semesterNumber: number;
  readonly cgpa: number;
  readonly verified: boolean;
}

export interface StudentApplicationRow {
  readonly applicationId: string;
  /** The company visit this role belongs to; null for a legacy standalone drive. */
  readonly companyDriveId?: string | null;
  /** The visit's day, so the same company visiting twice stays two cards. */
  readonly tentativeDate?: string | null;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly appliedAt: string;
  readonly hasOffer: boolean;
  readonly rounds: readonly ApplicantRound[];
}

/** An application plus the stage the domain says it has reached. */
interface ProgressedApplication {
  readonly application: StudentApplicationRow;
  readonly progress: ApplicationProgress;
}

export interface StudentOfferRow {
  readonly offerId: string;
  /** 0070: which of the two figures this offer carries depends on the type. */
  readonly driveType?: DriveType;
  readonly stipendMonthly?: number | null;
  /** Null for a self-placed offer, which belongs to no drive of ours. */
  readonly driveId?: string | null;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly ctcLpa: number | null;
  readonly offerCategory: OfferCategory | null;
  readonly declaredAt: string;
  readonly source: OfferSource;
  /**
   * UAT 2026-08-27: the letter the CPC attached (`0062`), signed and
   * short-lived. Both halves travel together — a name with no URL is a link
   * that opens nothing.
   */
  readonly letterUrl?: string | null;
  readonly letterName?: string | null;
}

export interface StudentDashboardSnapshot {
  readonly fullName: string;
  readonly rollNumber: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
  readonly campus: string;
  readonly srfStatus: SrfStatus;
  /** Why a coordinator sent the form back, so the prompt can say what to fix. */
  readonly srfRejectionReason?: string | null;
  readonly participationStatus: ParticipationStatus;
  /** How many live drives the student is actually eligible for, after R5. */
  readonly openDrives: number;
  readonly semesters: readonly StudentSemesterRow[];
  readonly applications: readonly StudentApplicationRow[];
  readonly offers: readonly StudentOfferRow[];
  /** Raw records: R8 counts them, this screen does not. */
  readonly attendance: readonly AttendanceRecord[];
}

/** D8/D9 (2026-08-12): what the Central CPC's entries told this student. */
export interface StudentNotificationRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly read: boolean;
  /** 0068: the drive this message is about, when there is one. */
  readonly driveId?: string | null;
  /** Present only on the message the letter belongs under — see the domain. */
  readonly letterUrl?: string | null;
  readonly letterName?: string | null;
}

export interface StudentDashboardView {
  snapshot(): Promise<StudentDashboardSnapshot>;
  notifications(): Promise<readonly StudentNotificationRow[]>;
  markRead(notificationId: string): Promise<void>;
}

/** Asia/Kolkata, always: a student in Chennai should not read a UTC date. */
const onDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const STAGE_TONE = {
  applied: "neutral",
  in_process: "warning",
  selected: "success",
  not_selected: "neutral",
} as const;

const ROUND_TONE = (round: ApplicantRound) => {
  if (round.result === "selected") return "success" as const;
  if (round.result === "rejected") return "danger" as const;
  if (round.participating) return "warning" as const;
  return "neutral" as const;
};

const AppliedLine = ({ entry }: { entry: ProgressedApplication }) => (
  <p className="mt-0.5 text-xs text-ink-300">Applied {onDate(entry.application.appliedAt)}</p>
);

const RoundChips = ({ entry }: { entry: ProgressedApplication }) =>
  entry.application.rounds.length === 0 ? null : (
    <ol className="mt-4 flex flex-wrap gap-2">
      {[...entry.application.rounds]
        .sort((a, b) => a.sequence - b.sequence)
        .map((round) => (
          <li key={round.sequence}>
            <Badge tone={ROUND_TONE(round)}>{round.name}</Badge>
          </li>
        ))}
    </ol>
  );

/**
 * One card per company visit (UAT 2026-10-16: "single company, under it each
 * role and its data"). Two roles of one visit are one visit the student applied
 * to twice, so the company is said once and each role keeps its own stage, its
 * own date and its own rounds — those are never summed.
 */
function ApplicationVisits({ entries }: { entries: readonly ProgressedApplication[] }) {
  const visits = groupByCompanyVisit(entries, (entry) => ({
    ownId: entry.application.applicationId,
    companyDriveId: entry.application.companyDriveId,
    companyName: entry.application.companyName,
    tentativeDate: entry.application.tentativeDate,
  }));

  return (
    <ul className="flex flex-col gap-3">
      {[...visits.entries()].map(([visitId, roles]) => {
        const [first] = roles;
        if (first === undefined) return null;

        if (roles.length === 1) {
          return (
            <li key={visitId}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-heading font-bold text-ink-900 [overflow-wrap:anywhere]">
                      {first.application.companyName}
                    </p>
                    <p className="break-words text-sm text-ink-500 [overflow-wrap:anywhere]">
                      {first.application.roleTitle}
                    </p>
                    <AppliedLine entry={first} />
                  </div>
                  <Badge tone={STAGE_TONE[first.progress.stage]}>{first.progress.label}</Badge>
                </div>
                <RoundChips entry={first} />
              </Card>
            </li>
          );
        }

        return (
          <li key={visitId}>
            <Card className="p-4">
              <p className="flex flex-wrap items-center gap-2 font-heading font-bold text-ink-900">
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                  {first.application.companyName}
                </span>
                <Badge tone="brand">{roles.length} roles</Badge>
              </p>
              <Accordion
                multiple
                className="mt-1"
                defaultValue={roles.map((role) => role.application.applicationId)}
              >
                {roles.map((role) => (
                  <AccordionItem
                    key={role.application.applicationId}
                    value={role.application.applicationId}
                  >
                    <AccordionTrigger className="py-2">
                      <span className="font-semibold text-ink-900">
                        {role.application.roleTitle}
                      </span>
                      <Badge tone={STAGE_TONE[role.progress.stage]}>{role.progress.label}</Badge>
                    </AccordionTrigger>
                    <AccordionContent className="pb-2">
                      <AppliedLine entry={role} />
                      <RoundChips entry={role} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** A problem with the notifications section only, never with the page around it. */
interface NotesProblem {
  readonly message: string;
  /** The note whose "Mark read" failed; null when the list itself never loaded. */
  readonly retryNoteId: string | null;
}

/**
 * The student's own dashboard. PRD §17.1, and their landing route.
 *
 * Mobile-first: students are on phones (PRD §21.2), so every section is a
 * single column that only widens on a large screen.
 *
 * Every judgement on this page is imported: `studentPrompt` decides what they
 * should do next, `applicationProgress` decides where each application has got
 * to, and `countAbsences` / `needsDisbarmentReview` decide whether their
 * attendance matters. This file lays them out and nothing more.
 */
export function StudentDashboard({ view }: { view: StudentDashboardView }) {
  const [snapshot, setSnapshot] = useState<StudentDashboardSnapshot | null>(null);
  /** Which read failed, in its own words — "no applications" and "we could not
   * ask" are opposite answers, and the page used to print one generic sentence
   * for both. */
  const [failure, setFailure] = useState<string | null>(null);
  // Bumping this re-runs the one read below; the failure card used to only
  // tell the reader to refresh the whole page.
  const [attempt, setAttempt] = useState(0);
  const [notes, setNotes] = useState<readonly StudentNotificationRow[]>([]);
  /**
   * Why the notifications below are missing or still unread. The read used to
   * fail into an empty catch and a "Mark read" click into an unhandled
   * rejection — either way the student was left with no note telling them the
   * note never arrived. `retryNoteId` separates "we could not ask" (ask the
   * server again) from "that click did not land" (do that one note again).
   */
  const [notesProblem, setNotesProblem] = useState<NotesProblem | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    let live = true;
    view
      .snapshot()
      .then((next) => {
        if (live) setSnapshot(next);
      })
      .catch((cause: unknown) => {
        if (live)
          setFailure(
            describeReadFailure(
              cause,
              "We could not load your dashboard. If it keeps happening, contact your placement coordinator.",
            ),
          );
      });
    // Notifications failing must never take the dashboard down with them.
    view
      .notifications()
      .then((next) => {
        if (!live) return;
        setNotes(next);
        setNotesProblem(null);
      })
      .catch(() => {
        if (live)
          setNotesProblem({
            message: "We could not load your notifications. Your other details are unaffected.",
            retryNoteId: null,
          });
      });
    return () => {
      live = false;
    };
  }, [view, attempt]);

  async function markRead(id: string) {
    try {
      await view.markRead(id);
      setNotes(await view.notifications());
      setNotesProblem(null);
    } catch {
      setNotesProblem({
        message: "We could not mark that notification read. It is still waiting for you.",
        retryNoteId: id,
      });
    }
  }

  if (failure !== null) {
    return (
      <ErrorPanel
        onRetry={() => {
          setFailure(null);
          setAttempt((count) => count + 1);
        }}
      >
        {failure}
      </ErrorPanel>
    );
  }

  if (snapshot === null) {
    return (
      <p role="status" className="text-sm text-ink-500">
        Loading your dashboard…
      </p>
    );
  }

  const prompt = studentPrompt({
    srfStatus: snapshot.srfStatus,
    participationStatus: snapshot.participationStatus,
    openDrives: snapshot.openDrives,
    // The coordinator's own words, on the screen the student lands on.
    srfRejectionReason: snapshot.srfRejectionReason ?? null,
  });

  const progressed = snapshot.applications.map((application) => ({
    application,
    progress: applicationProgress({
      rounds: application.rounds,
      hasOffer: application.hasOffer,
    }),
  }));

  const absences = countAbsences(snapshot.attendance);
  const underReview = needsDisbarmentReview(absences);
  const inProcess = progressed.filter((p) => p.progress.stage === "in_process").length;

  return (
    <>
      <PageHeader
        title={snapshot.fullName}
        subtitle={`Roll ${snapshot.rollNumber} · ${snapshot.degree} ${snapshot.branch} · Batch of ${snapshot.passingYear} · ${snapshot.campus}`}
      />

      {notesProblem !== null &&
        (() => {
          const noteId = notesProblem.retryNoteId;
          return (
            <div className="mb-6">
              <ErrorPanel
                onRetry={
                  noteId !== null
                    ? () => void markRead(noteId)
                    : () => setAttempt((count) => count + 1)
                }
                retryLabel={noteId !== null ? "Try marking it again" : "Load them again"}
              >
                {notesProblem.message}
              </ErrorPanel>
            </div>
          );
        })()}

      {notes.length > 0 &&
        (() => {
          /**
           * E1/E2 (UAT 2026-08-19): the top 3, unread first; the rest live on
           * the full alerts page. A read note SINKS — it is never deleted.
           */
          const { shown, hidden } = condenseNotifications(notes, 3);
          return (
            <section aria-label="Notifications" className="mb-6">
              <Card className="p-5">
                <p className="flex items-center gap-2 font-heading text-lg font-bold text-ink-900">
                  Notifications
                  {notes.some((n) => !n.read) && (
                    <Badge tone="warning">{notes.filter((n) => !n.read).length} unread</Badge>
                  )}
                </p>
                <ul className="mt-3 space-y-2">
                  {shown.map((note) => (
                    <li
                      key={note.id}
                      className={`rounded-lg border p-3 ${
                        note.read ? "border-line" : "border-warning/50 bg-warning/5"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink-900">{note.title}</p>
                          <p className="mt-0.5 text-sm text-ink-700">
                            <NotificationBody body={note.body} />
                          </p>
                          <p className="mt-1 text-xs text-ink-500">{onDate(note.createdAt)}</p>
                        </div>
                        {note.read ? (
                          <span className="shrink-0 text-xs font-medium text-ink-500">✓ Read</span>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => void markRead(note.id)}>
                            Mark read
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {hidden > 0 && (
                  <Link
                    to="/student/notifications"
                    className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline"
                  >
                    Read all {notes.length} notifications →
                  </Link>
                )}
              </Card>
            </section>
          );
        })()}

      <section aria-label="What to do next" className="mb-6">
        <Card className="overflow-hidden">
          <div className="fpc-gradient h-1" aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="font-heading text-lg font-bold text-ink-900">{prompt.headline}</p>
              <p className="mt-1 text-sm text-ink-500">{prompt.detail}</p>
            </div>
            {prompt.action !== null && (
              <Link
                to={prompt.action.href}
                className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-600 sm:w-auto"
              >
                {prompt.action.label}
              </Link>
            )}
          </div>
        </Card>
      </section>

      <section
        aria-label="Summary"
        className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard label="Applications" value={snapshot.applications.length} />
        <StatCard label="In process" value={inProcess} tone="brand" />
        <StatCard
          label="Offers"
          value={snapshot.offers.length}
          tone={snapshot.offers.length > 0 ? "success" : "neutral"}
        />
        <StatCard
          label="Absences"
          value={`${absences} of ${ABSENCE_LIMIT}`}
          tone={underReview ? "danger" : absences > 0 ? "warning" : "neutral"}
          hint={
            underReview
              ? "Your participation is under review"
              : `${ABSENCE_LIMIT} absences lead to a review`
          }
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-label="My applications" className="lg:col-span-2">
          <h2 className="mb-3 text-lg text-ink-900">My applications</h2>

          {progressed.length === 0 ? (
            <Card className="p-5">
              <p className="text-sm text-ink-700">
                You have not applied to any drive yet. Drives open to you appear under Open drives.
              </p>
            </Card>
          ) : (
            <ApplicationVisits entries={progressed} />
          )}
        </section>

        <div className="flex flex-col gap-6">
          <section aria-label="My offers">
            <h2 className="mb-3 text-lg text-ink-900">My offers</h2>
            {snapshot.offers.length === 0 ? (
              <Card className="p-5">
                <p className="text-sm text-ink-700">
                  No offers yet. Every result is published here as soon as it is declared.
                </p>
              </Card>
            ) : (
              <Card className="divide-y divide-line">
                {snapshot.offers.map((offer) => (
                  <div key={offer.offerId} className="p-4">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge tone="success">
                        {offer.source === "self_placed" ? "Self-placed" : "Placed"}
                      </Badge>
                      {/* 2026-08-27: the domain's spelling. This said "super
                          dream" while every staff screen said "Super Dream". */}
                      {offer.offerCategory !== null && (
                        <Badge tone="brand">{offerCategoryLabel(offer.offerCategory)}</Badge>
                      )}
                    </div>
                    <p className="break-words font-heading font-bold text-ink-900 [overflow-wrap:anywhere]">
                      {offer.companyName}
                    </p>
                    {offer.roleTitle !== null && (
                      <p className="break-words text-sm text-ink-500 [overflow-wrap:anywhere]">
                        {offer.roleTitle}
                      </p>
                    )}
                    <p className="mt-1 text-sm text-ink-700">
                      {/* 2026-08-27: an internship is paid monthly. This line
                          told a student their ₹15,000-a-month internship was
                          worth ₹10 LPA, because the declare box demanded a
                          CTC and somebody had to type one. */}
                      {describeOfferPay({
                        driveType: offer.driveType ?? "placement",
                        ctcLpa: offer.ctcLpa,
                        stipendMonthly: offer.stipendMonthly ?? null,
                      })}{" "}
                      · Declared {onDate(offer.declaredAt)}
                    </p>
                    {/* UAT 2026-08-27: the letter the CPC attached. Filed
                        since 0062, shown to the student since never. */}
                    <OfferLetterLink
                      url={offer.letterUrl}
                      name={offer.letterName}
                      className="mt-2"
                    />
                  </div>
                ))}
                {/* R3 catches students by surprise otherwise: their drive list
                    shrinks the moment an offer lands, and nobody tells them why. */}
                <p className="bg-brand-50 px-4 py-3 text-xs text-brand-600">
                  You will now only see <strong>new</strong> drives above this category. Drives you
                  had already applied to continue as normal.
                </p>
              </Card>
            )}
          </section>

          <section aria-label="My academic record">
            <h2 className="mb-3 text-lg text-ink-900">My academic record</h2>
            <Card className="p-4">
              {snapshot.semesters.length === 0 ? (
                <p className="text-sm text-ink-700">
                  You have not entered any semester marks yet. Eligibility for a drive is judged on
                  your latest verified semester.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {[...snapshot.semesters]
                    .sort((a, b) => a.semesterNumber - b.semesterNumber)
                    .map((semester) => (
                      <li
                        key={semester.semesterNumber}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                      >
                        <span className="text-ink-800">Semester {semester.semesterNumber}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-semibold text-ink-900">
                            {describeMarks(semester.cgpa, "cgpa")}
                          </span>
                          <Badge tone={semester.verified ? "success" : "warning"}>
                            {semester.verified ? "Verified" : "Awaiting verification"}
                          </Badge>
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}
