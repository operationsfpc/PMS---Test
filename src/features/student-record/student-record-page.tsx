import { Badge, Button, ButtonAnchor, ButtonLink, Card, PageHeader } from "@components/ui";
import { HOLD_KIND_LABELS, holdStanding, holdWindowLine } from "@domain/holds";
import { describeMarks } from "@domain/marks";
import { type OfferCategory, offerCategoryLabel } from "@domain/offer-category";
import { SKILL_SCORE_MAX } from "@domain/skills";
import { extractOriginalFilename } from "@domain/storage-path";
import type { OfferSource, ParticipationStatus, RoleCategory, SrfStatus } from "@domain/types";
import type { Hold, HoldsView } from "@lib/holds-view";
import { useAsyncAction } from "@lib/use-async-action";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

/**
 * G7 (UAT 2026-08-20, Q7 answer b): the canonical student record.
 *
 * "Student numbers/counts aren't clickable, and there's no way to drill into
 * student details from that view." One page for every staff role, reached from
 * the directory and anywhere else a student is named. RLS decides who may read
 * the row at all; this page only renders what comes back.
 *
 * Read-only except for one verb: a Campus Manager may lift a placement hold
 * (0125) — the hold was placed by their college, and nobody above them can say
 * whether the dues that raised it have cleared. Verification still belongs to
 * the campus coordinator, and nothing here edits a student's record.
 */

export interface StudentRecordSemester {
  readonly semesterNumber: number;
  readonly cgpa: number;
  readonly verified: boolean;
}

export interface StudentRecordSkill {
  readonly skill: string;
  readonly score: number;
}

export interface StudentRecordApplication {
  readonly applicationId: string;
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly appliedAt: string | null;
  readonly shortlisted: boolean;
  readonly hasOffer: boolean;
}

export interface StudentRecordPlacement {
  readonly companyName: string;
  readonly roleTitle: string | null;
  /** Null when the offer records no annual figure (0070). */
  readonly ctcLpa: number | null;
  readonly offerCategory: OfferCategory | null;
  readonly source: OfferSource;
}

export interface StudentRecord {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly mobile: string | null;
  readonly campusName: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
  readonly tenthPercentage: number | null;
  readonly twelfthPercentage: number | null;
  readonly semesters: readonly StudentRecordSemester[];
  readonly skills: readonly StudentRecordSkill[];
  readonly rolePreferences: readonly RoleCategory[];
  readonly applications: readonly StudentRecordApplication[];
  readonly placement: StudentRecordPlacement | null;
}

export interface StudentRecordView {
  /** Null when the row does not exist or RLS refuses it — indistinguishable BY DESIGN. */
  record(studentId: string): Promise<StudentRecord | null>;
}

const SRF_LABEL: Record<SrfStatus, string> = {
  invited: "Not started",
  registered: "In progress",
  srf_submitted: "Submitted",
  srf_approved: "Verified",
  srf_rejected: "Returned",
};

const AREA_LABEL: Record<string, string> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

const onDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function StudentRecordPage({
  studentId,
  view,
  holds,
  release,
}: {
  studentId: string;
  view: StudentRecordView;
  /**
   * The hold read, for the roles 0125 admits to `student_holds` — a Campus
   * Manager's own college and the org readers above them. Absent draws no hold
   * block, which is also what a refused read looks like, so the screen never
   * claims a student is unheld when it simply could not see.
   */
  holds?: HoldsView;
  /** The Campus Manager's verb alone. Absent, the block is a fact, not a control. */
  release?: (holdId: string, note: string | null) => Promise<void>;
}) {
  const [record, setRecord] = useState<StudentRecord | null | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [pastHolds, setPastHolds] = useState<readonly Hold[]>([]);
  const [holdProblem, setHoldProblem] = useState<string | null>(null);
  const [orderUrl, setOrderUrl] = useState<string | null>(null);
  const [lifting, setLifting] = useState(false);
  const [releaseNote, setReleaseNote] = useState("");
  // One bump re-reads both halves: `release_student_hold` flips the student
  // back to active in the same transaction that lifts the row.
  const [reload, setReload] = useState(0);
  const actions = useAsyncAction();
  const navigate = useNavigate();
  const location = useLocation();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-runs the pair on purpose
  useEffect(() => {
    let live = true;
    view.record(studentId).then(
      (next) => {
        if (live) {
          setRecord(next);
          setFailure(null);
        }
      },
      () => {
        // A refused read is not "no such student". The record may exist and be
        // perfectly readable — the network or a policy failed — and left
        // unhandled this page sat on "Loading…" forever.
        if (live) setFailure("Could not load this student record. Please try again.");
      },
    );
    return () => {
      live = false;
    };
  }, [view, studentId, reload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-runs the read on purpose
  useEffect(() => {
    if (holds === undefined) return;
    let live = true;

    Promise.all([holds.live(studentId), holds.history(studentId)]).then(
      ([current, every]) => {
        if (!live) return;
        setHold(current);
        setPastHolds(every.filter((past) => past.releasedAt !== null));
        setHoldProblem(null);

        const path = current?.documentPath ?? null;
        setOrderUrl(null);
        // A link only ever appears once it has actually signed (0051): an order
        // that cannot be opened is still said to be on file, not offered dead.
        if (path !== null) {
          void holds.orderUrl(path).then((url) => {
            if (live) setOrderUrl(url);
          });
        }
      },
      (cause: unknown) => {
        if (!live) return;
        setHoldProblem(
          cause instanceof Error && cause.message !== ""
            ? cause.message
            : "Could not read whether this student is on a hold.",
        );
      },
    );

    return () => {
      live = false;
    };
  }, [holds, studentId, reload]);

  async function lift() {
    if (hold === null || release === undefined) return;
    // The note is optional to the database and asked for here: it is the only
    // record of why the block came off, and the next manager reads it cold.
    const note = releaseNote.trim() === "" ? null : releaseNote.trim();
    if (await actions.run(() => release(hold.id, note))) {
      setLifting(false);
      setReleaseNote("");
      setReload((count) => count + 1);
    }
  }

  /**
   * UAT 2026-10-18: "there is no way to go back". A record reached from a list
   * returns to that list. One loaded cold — bookmark, mail link, refresh — has
   * no in-app history to step into, so it points at the reader's own overview
   * instead of offering a button that would do nothing. `/` sends each role to
   * their landing screen, so this never hands someone a page they cannot read.
   */
  const back =
    location.key === "default" ? (
      <ButtonLink variant="secondary" size="sm" to="/">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Overview
      </ButtonLink>
    ) : (
      <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back
      </Button>
    );

  if (record === undefined) {
    if (failure !== null) {
      return (
        <Card className="border border-danger-500 bg-danger-50 p-5">
          <p role="alert" className="text-sm text-danger-500">
            {failure}
          </p>
          <div className="mt-4">{back}</div>
        </Card>
      );
    }

    return (
      <p role="status" className="text-sm text-ink-500">
        Loading the student record…
      </p>
    );
  }

  if (record === null) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-700">
          This student record does not exist, or you cannot read it.
        </p>
        <div className="mt-4">{back}</div>
      </Card>
    );
  }

  const today = new Date();
  const standing = hold === null ? null : holdStanding(hold, today);
  // The block below already says "On hold — Fees"; a chip 3cm above it saying
  // "on hold" again is the same fact twice.
  const badgeRepeatsHold = hold !== null && record.participationStatus === "on_hold";

  return (
    <div>
      <PageHeader
        title={record.fullName}
        subtitle={`Roll ${record.rollNumber} · ${record.campusName}`}
        actions={back}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={record.srfStatus === "srf_approved" ? "success" : "neutral"}>
          Registration: {SRF_LABEL[record.srfStatus]}
        </Badge>
        {record.participationStatus !== "active" && !badgeRepeatsHold && (
          <Badge tone="warning">{record.participationStatus.replaceAll("_", " ")}</Badge>
        )}
      </div>

      {holdProblem !== null && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {holdProblem}
        </p>
      )}

      {(hold !== null || pastHolds.length > 0) && (
        <section aria-label="Placement hold" className="mb-4 flex flex-col gap-3">
          {hold !== null && (
            <Card className="border-warning/40 bg-warning/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-heading text-lg font-bold text-ink-900">
                  On hold — {HOLD_KIND_LABELS[hold.kind]}
                </h2>
                <Badge tone={standing === "overdue" ? "danger" : "warning"}>
                  {standing === "overdue" ? "Review overdue" : "In force"}
                </Badge>
              </div>

              <p className="mt-2 text-sm text-ink-900">{hold.reason}</p>
              <p className="mt-1 text-xs text-ink-500">
                {holdWindowLine(hold, today)}
                {hold.heldBy !== null && ` · placed by ${hold.heldBy}`} · placed{" "}
                {onDate(hold.heldAt)}
              </p>

              {hold.documentPath !== null && (
                <p className="mt-3 flex flex-wrap items-center gap-2">
                  {orderUrl === null ? (
                    // True in both cases: the order is on file, and the record
                    // simply has no working link to it.
                    <span className="text-sm text-ink-500">
                      Order on file: {extractOriginalFilename(hold.documentPath)}
                    </span>
                  ) : (
                    <ButtonAnchor
                      href={orderUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Open the hold order — ${extractOriginalFilename(hold.documentPath)}`}
                    >
                      Hold order
                    </ButtonAnchor>
                  )}
                  <span className="text-xs text-ink-500">The student cannot open this file.</span>
                </p>
              )}

              {release !== undefined && (
                <div className="mt-4">
                  {lifting ? (
                    <div className="flex flex-col gap-2">
                      <label htmlFor="release-note" className="text-sm font-medium text-ink-700">
                        What cleared it?{" "}
                        <span className="font-normal text-ink-500">(optional)</span>
                      </label>
                      <textarea
                        id="release-note"
                        rows={2}
                        value={releaseNote}
                        onChange={(e) => setReleaseNote(e.target.value)}
                        placeholder="Cleared with accounts on 3 Nov — receipt filed."
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="danger"
                          isLoading={actions.isPending()}
                          onClick={() => void lift()}
                        >
                          Release hold
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={actions.busy}
                          onClick={() => setLifting(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="danger" size="sm" onClick={() => setLifting(true)}>
                      Release hold
                    </Button>
                  )}

                  {actions.error !== null && (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                    >
                      {actions.error}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {pastHolds.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-2 font-heading text-lg font-bold text-ink-900">Earlier holds</h2>
              <ul className="divide-y divide-line text-sm">
                {pastHolds.map((past) => (
                  <li key={past.id} className="py-2">
                    <p className="font-medium text-ink-900">{HOLD_KIND_LABELS[past.kind]}</p>
                    <p className="text-xs text-ink-500">
                      {past.reason} · {holdWindowLine(past, today)}
                      {past.releasedBy !== null && ` by ${past.releasedBy}`}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Identity">
          <Card className="p-5">
            <h2 className="mb-3 font-heading text-lg font-bold text-ink-900">Identity</h2>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Programme</dt>
                <dd className="text-right text-ink-900">
                  {record.degree}
                  {record.branch !== "" && ` — ${record.branch}`} · {record.passingYear}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-ink-500">Email</dt>
                <dd className="truncate text-right text-ink-900">{record.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-ink-500">Mobile</dt>
                <dd className="truncate text-right text-ink-900">
                  {record.mobile ?? "Not recorded"}
                </dd>
              </div>
            </dl>
          </Card>
        </section>

        <section aria-label="Placement">
          <Card className="p-5">
            <h2 className="mb-3 font-heading text-lg font-bold text-ink-900">Placement</h2>
            {record.placement === null ? (
              // A fact, not a blank: an empty card reads as missing data.
              <p className="text-sm text-ink-500">Not placed.</p>
            ) : (
              <div className="text-sm">
                <p className="font-medium text-ink-900">
                  {record.placement.companyName}
                  {record.placement.source === "self_placed" && (
                    <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                      Self-placed
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-ink-500">
                  {record.placement.roleTitle ?? "Role not recorded"} · ₹{record.placement.ctcLpa}{" "}
                  LPA
                  {record.placement.offerCategory !== null &&
                    ` · ${offerCategoryLabel(record.placement.offerCategory)}`}
                </p>
              </div>
            )}
          </Card>
        </section>

        <section aria-label="Academics">
          <Card className="p-5">
            <h2 className="mb-3 font-heading text-lg font-bold text-ink-900">Academics</h2>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">10th %</dt>
                <dd className="text-ink-900">{record.tenthPercentage ?? "Not recorded"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">12th %</dt>
                <dd className="text-ink-900">{record.twelfthPercentage ?? "Not recorded"}</dd>
              </div>
            </dl>
            {record.semesters.length > 0 && (
              <ul className="mt-3 divide-y divide-line border-t border-line pt-1">
                {record.semesters.map((semester) => (
                  <li
                    key={semester.semesterNumber}
                    className="flex items-center justify-between gap-4 py-2 text-sm"
                  >
                    <span className="text-ink-700">Semester {semester.semesterNumber}</span>
                    <span className="flex items-center gap-2">
                      {/* The figure says what scale it is on. Beside a Verified
                          badge, a bare "8.2" is the number the badge claims to
                          have checked, so the unit belongs on it. */}
                      <span className="font-medium text-ink-900">
                        {describeMarks(semester.cgpa, "cgpa")}
                      </span>
                      <Badge tone={semester.verified ? "success" : "warning"}>
                        {semester.verified ? "Verified" : "Pending"}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section aria-label="Skills and preferences">
          <Card className="p-5">
            <h2 className="mb-3 font-heading text-lg font-bold text-ink-900">
              Skills and preferences
            </h2>
            {record.skills.length === 0 ? (
              <p className="text-sm text-ink-500">No skill scores recorded.</p>
            ) : (
              <p className="flex flex-wrap gap-1.5 text-xs">
                {record.skills.map(({ skill, score }) => (
                  <span
                    key={skill}
                    className="whitespace-nowrap rounded-full border border-line bg-surface-muted px-2 py-0.5 font-medium text-ink-700"
                  >
                    {skill} {score}/{SKILL_SCORE_MAX}
                  </span>
                ))}
              </p>
            )}
            {record.rolePreferences.length > 0 && (
              <p className="mt-3 text-sm text-ink-700">
                <span className="text-ink-500">Preferred areas: </span>
                {record.rolePreferences.map((area) => AREA_LABEL[area] ?? area).join(" · ")}
              </p>
            )}
          </Card>
        </section>

        <section aria-label="Applications" className="lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-3 font-heading text-lg font-bold text-ink-900">Applications</h2>
            {record.applications.length === 0 ? (
              <p className="text-sm text-ink-700">No applications yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {record.applications.map((application) => (
                  <li
                    key={application.applicationId}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">
                        {/* N1: the name is the door to the drive's record. */}
                        <Link to={`/drives/${application.driveId}`} className="hover:underline">
                          {application.companyName}
                        </Link>
                      </p>
                      <p className="text-xs text-ink-500">
                        {application.roleTitle ?? "Role not recorded"}
                        {application.appliedAt !== null &&
                          ` · applied ${onDate(application.appliedAt)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {application.shortlisted && <Badge tone="brand">Shortlisted</Badge>}
                      {application.hasOffer && <Badge tone="success">Offer</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
