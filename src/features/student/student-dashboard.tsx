import { Badge, Card, PageHeader, StatCard } from "@components/ui";
import {
  ABSENCE_LIMIT,
  type AttendanceRecord,
  countAbsences,
  needsDisbarmentReview,
} from "@domain/attendance";
import type { OfferCategory } from "@domain/offer-category";
import { type ApplicantRound, applicationProgress, studentPrompt } from "@domain/student-progress";
import type { OfferSource, ParticipationStatus, SrfStatus } from "@domain/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";

export interface StudentSemesterRow {
  readonly semesterNumber: number;
  readonly cgpa: number;
  readonly verified: boolean;
}

export interface StudentApplicationRow {
  readonly applicationId: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly appliedAt: string;
  readonly hasOffer: boolean;
  readonly rounds: readonly ApplicantRound[];
}

export interface StudentOfferRow {
  readonly offerId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly ctcLpa: number;
  readonly offerCategory: OfferCategory | null;
  readonly declaredAt: string;
  readonly source: OfferSource;
}

export interface StudentDashboardSnapshot {
  readonly fullName: string;
  readonly rollNumber: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
  readonly campus: string;
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
  /** How many live drives the student is actually eligible for, after R5. */
  readonly openDrives: number;
  readonly semesters: readonly StudentSemesterRow[];
  readonly applications: readonly StudentApplicationRow[];
  readonly offers: readonly StudentOfferRow[];
  /** Raw records: R8 counts them, this screen does not. */
  readonly attendance: readonly AttendanceRecord[];
}

export interface StudentDashboardView {
  snapshot(): Promise<StudentDashboardSnapshot>;
}

const humanise = (value: string) => value.replaceAll("_", " ");

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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    view
      .snapshot()
      .then((next) => {
        if (live) setSnapshot(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [view]);

  if (failed) {
    return (
      <p role="alert" className="rounded-card bg-danger-50 p-4 text-sm text-danger-700">
        We could not load your dashboard. Refresh the page, or contact your placement coordinator if
        this keeps happening.
      </p>
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
        subtitle={`${snapshot.rollNumber} · ${snapshot.degree} ${snapshot.branch} · Batch of ${snapshot.passingYear} · ${snapshot.campus}`}
      />

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
                className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
              >
                {prompt.action.label}
              </Link>
            )}
          </div>
        </Card>
      </section>

      <section aria-label="Summary" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <ul className="flex flex-col gap-3">
              {progressed.map(({ application, progress }) => (
                <li key={application.applicationId}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-heading font-bold text-ink-900">
                          {application.companyName}
                        </p>
                        <p className="text-sm text-ink-500">{application.roleTitle}</p>
                        <p className="mt-0.5 text-xs text-ink-300">
                          Applied {onDate(application.appliedAt)}
                        </p>
                      </div>
                      <Badge tone={STAGE_TONE[progress.stage]}>{progress.label}</Badge>
                    </div>

                    {application.rounds.length > 0 && (
                      <ol className="mt-4 flex flex-wrap gap-2">
                        {[...application.rounds]
                          .sort((a, b) => a.sequence - b.sequence)
                          .map((round) => (
                            <li key={round.sequence}>
                              <Badge tone={ROUND_TONE(round)}>{round.name}</Badge>
                            </li>
                          ))}
                      </ol>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
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
                      {offer.offerCategory !== null && (
                        <Badge tone="brand">{humanise(offer.offerCategory)}</Badge>
                      )}
                    </div>
                    <p className="font-heading font-bold text-ink-900">{offer.companyName}</p>
                    {offer.roleTitle !== null && (
                      <p className="text-sm text-ink-500">{offer.roleTitle}</p>
                    )}
                    <p className="mt-1 text-sm text-ink-700">
                      ₹{offer.ctcLpa} LPA · Declared {onDate(offer.declaredAt)}
                    </p>
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
                            {semester.cgpa.toFixed(2)}
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
