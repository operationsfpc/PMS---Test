import {
  Badge,
  Button,
  ButtonAnchor,
  ButtonLink,
  Card,
  PageHeader,
  type Tone,
} from "@components/ui";
import { visitDayInParentheses } from "@domain/drive-aging";
import { FUNNEL_STAGES, type FunnelStageKey, filterFunnelStage } from "@domain/drive-portfolio";
import { asDriveType, driveTypeLabel, driveTypeTone } from "@domain/drive-type";
import { describeDriveFreeze } from "@domain/drive-working";
import { offerCategoryLabel, offerCategoryRestatesType } from "@domain/offer-category";
import type { AppRole, DriveStatus } from "@domain/types";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { DriveRecord, DriveRecordView } from "./record-view";

/**
 * N1 — the drive's one canonical page (approved mockup 2026-08-19).
 *
 * READ-ONLY by design: a page that shows everything and edits nothing cannot
 * leak a permission by accident. Editing stays where it lives — the PIF for
 * the AE, publish-and-target for the Central CPC.
 *
 * `role` is REQUIRED, not defaulted: a permissive default is a permission
 * granted by forgetfulness (the CockpitPage rule).
 */

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved — not yet published",
  rejected: "Sent back",
  live: "LIVE",
  applications_closed: "Applications closed",
  in_rounds: "In rounds",
  completed: "Completed",
};

/** Matches the PIF event picker's tones, so "Live" is green on both screens. */
const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  submitted: "warning",
  approved: "success",
  rejected: "danger",
  live: "success",
  applications_closed: "warning",
  in_rounds: "warning",
  completed: "neutral",
};

const AREA_LABEL: Record<string, string> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

const when = (iso: string | null) =>
  iso === null
    ? "—"
    : new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 inline-block border-b-2 border-gold-500 pb-0.5 font-heading text-sm font-bold uppercase tracking-wide text-ink-900">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Fact({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  if (value.trim() === "" || value === "—") return null;
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800 break-words [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

/**
 * A snapshot value, read from the REAL envelope: `buildApplicationSnapshot`
 * nests everything under `profile`, with `academics` inside it.
 *
 * 🔴 2026-08-24: this used to read one level too shallow (`snapshot.academics`)
 * — the same defect that showed "CGPA 0" on shortlisting. The shallow reads
 * stay as fallbacks only.
 */
function fromSnapshot(envelope: Record<string, unknown>, key: string): string {
  const snapshot = (envelope.profile ?? envelope) as Record<string, unknown>;
  const academics = (snapshot.academics ?? snapshot) as Record<string, unknown>;
  const value = academics[key] ?? snapshot[key];
  return value === null || value === undefined ? "—" : String(value);
}

const STAGE_LABEL: Record<FunnelStageKey, string> = {
  applied: "Applied",
  shortlisted: "Shortlisted",
  in_rounds: "In rounds",
  offers: "Offers",
  not_selected: "Not selected",
};

export function DriveRecordPage({
  view,
  role,
  driveId,
  stage,
}: {
  view: DriveRecordView;
  role: AppRole;
  driveId: string;
  /** C8: the funnel number that linked here — `?stage=` on the route. */
  stage?: string | undefined;
}) {
  const [record, setRecord] = useState<DriveRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSnapshot, setOpenSnapshot] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const found = await view.record(driveId);
      if (found === null) setError("This drive does not exist, or you cannot see it.");
      else {
        setRecord(found);
        setError(null);
      }
    } catch {
      setError("Could not load this drive. Please try again.");
    }
  }, [view, driveId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) {
    return (
      <Card className="border border-danger-500 bg-danger-50 p-5">
        <p role="alert" className="text-sm text-danger-500">
          {error}
        </p>
      </Card>
    );
  }

  if (record === null) {
    return (
      <p role="status" className="p-6 text-sm text-ink-500">
        Loading the drive…
      </p>
    );
  }

  const staff = role !== "student";
  const driveType = asDriveType(record.driveType);
  /**
   * Whether this drive's visit still admits one more role. The visit, not just
   * this row: a new role attaches to the company event, so it is refused only
   * when every role under it is closed — the same rule the AE portfolio reads.
   */
  const visitStatuses: readonly DriveStatus[] = [
    record.status,
    ...record.siblingRoles.map((sibling) => sibling.status),
  ];
  const refusalPerRole = visitStatuses.map((status) => describeDriveFreeze("roles", status));
  const rolesRefused =
    refusalPerRole.length > 0 && refusalPerRole.every((sentence) => sentence !== null)
      ? (refusalPerRole[0] ?? null)
      : null;

  /**
   * C8 (2026-08-21, answer 5b): the list behind a clicked funnel number.
   * `filterFunnelStage` is the SAME arithmetic the count used, so the number
   * and this list cannot disagree. Staff only — the counts are theirs.
   */
  const activeStage: FunnelStageKey | null =
    staff && (FUNNEL_STAGES as readonly string[]).includes(stage ?? "")
      ? (stage as FunnelStageKey)
      : null;
  const stageApplicants =
    activeStage === null ? null : filterFunnelStage(record.applicants, activeStage);

  return (
    <div className="pb-24">
      <PageHeader
        title={`${record.companyName} — ${record.roleTitle}`}
        subtitle={[
          record.roleCategory === null ? null : AREA_LABEL[record.roleCategory],
          record.additionalDesignations.length === 0
            ? null
            : `also hiring: ${record.additionalDesignations.join(", ")}`,
        ]
          .filter((part) => part !== null)
          .join(" · ")}
        actions={
          staff && (role === "account_executive" || role === "admin") ? (
            rolesRefused === null ? (
              <ButtonLink
                size="sm"
                variant="ghost"
                to={`/ae/pif?companyName=${encodeURIComponent(record.companyName)}${
                  record.companyDriveId
                    ? `&companyDriveId=${encodeURIComponent(record.companyDriveId)}`
                    : ""
                }&tentativeDate=${encodeURIComponent(record.tentativeDate ?? "")}`}
              >
                + Add another role{visitDayInParentheses(record.tentativeDate)}
              </ButtonLink>
            ) : (
              // A closed visit cannot take a fifth role onto it. The offer is
              // replaced by the reason, not removed: a missing button reads
              // as a defect, a refused one that says why reads as a rule.
              <p className="max-w-full break-words text-xs text-ink-500">
                {rolesRefused} No further roles can be raised.
              </p>
            )
          ) : undefined
        }
      />

      {activeStage !== null && stageApplicants !== null && (
        <section aria-label="Applicants by stage" className="mb-4">
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap gap-3 text-sm">
              {FUNNEL_STAGES.map((key) => {
                const count = filterFunnelStage(record.applicants, key).length;
                return key === activeStage ? (
                  <span key={key} className="font-semibold text-ink-900">
                    {STAGE_LABEL[key]} ({count})
                  </span>
                ) : (
                  <Link
                    key={key}
                    to={`/drives/${driveId}?stage=${key}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    {STAGE_LABEL[key]} ({count})
                  </Link>
                );
              })}
            </div>

            {stageApplicants.length === 0 ? (
              <p className="text-sm text-ink-500">
                Nobody is at “{STAGE_LABEL[activeStage]}” on this drive.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {stageApplicants.map((applicant) => (
                  <li
                    key={applicant.applicationId}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      <Link
                        to={`/students/${applicant.studentId}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {applicant.fullName}
                      </Link>{" "}
                      <span className="text-sm text-ink-500">
                        Roll {applicant.rollNumber}
                        {applicant.campus !== "" && ` · ${applicant.campus}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={STATUS_TONE[record.status] ?? "neutral"}>
          {STATUS_LABEL[record.status] ?? record.status}
        </Badge>
        {/* UAT 2026-08-27: an internship's category IS its type. Two badges
            reading "Internship" are one fact wearing two colours. */}
        {record.offerCategory !== null &&
          !offerCategoryRestatesType(driveType, record.offerCategory) && (
            <Badge tone="neutral">{offerCategoryLabel(record.offerCategory)}</Badge>
          )}
        {/* The domain's words, not `replaceAll("_", " ")` — which is where
            the lower-case "internship" in the screenshot came from. */}
        {driveType !== null && (
          <Badge tone={driveTypeTone(driveType)}>{driveTypeLabel(driveType)}</Badge>
        )}
      </div>

      {/* Quick Highlights Strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="min-w-0 rounded-xl border border-line bg-surface-muted p-3.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Package / CTC
          </span>
          <p className="mt-1 font-heading text-base font-bold text-ink-900 break-words [overflow-wrap:anywhere] leading-snug">
            {record.ctcLabel ? `${record.ctcLabel} (CTC)` : "—"}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-surface-muted p-3.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Location
          </span>
          <p
            className="mt-1 text-sm font-medium text-ink-800 break-words [overflow-wrap:anywhere] leading-snug"
            title={record.locations || "—"}
          >
            {record.locations || "—"}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-surface-muted p-3.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Drive Mode
          </span>
          <p className="mt-1 text-sm font-medium capitalize text-ink-800 break-words leading-snug">
            {record.driveMode ? `${record.driveMode.replaceAll("_", " ")} drive` : "—"}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-surface-muted p-3.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Apply Deadline
          </span>
          <p className="mt-1 text-sm font-medium text-ink-800 break-words leading-snug">
            {record.applicationEnd ? when(record.applicationEnd) : "Open"}
          </p>
        </div>
      </div>

      {/* Main asymmetric 3-column layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Column (2 cols) */}
        <div className="space-y-6 lg:col-span-2">
          {(record.jobDescription !== "" || record.jobDescriptionUrl !== null) && (
            <Section title="Job description">
              {record.jobDescription !== "" && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800 break-words [overflow-wrap:anywhere]">
                  {record.jobDescription}
                </p>
              )}
              {record.jobDescriptionUrl !== null && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted p-3.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="text-xl shrink-0" aria-hidden="true">
                      📄
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={record.jobDescriptionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700 break-all"
                      >
                        {record.jobDescriptionName ?? "Job description (PDF)"}
                      </a>
                      <p className="text-xs text-ink-500">
                        Official document provided by recruiter
                      </p>
                    </div>
                  </div>
                  {/* The row already names the document beside it, so this
                      affordance names its object — "View" belongs to the one
                      link that opens the record (architecture rule). */}
                  <ButtonAnchor
                    href={record.jobDescriptionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0"
                    aria-label={`Open the job description PDF for ${record.companyName} — ${record.roleTitle}`}
                  >
                    PDF
                  </ButtonAnchor>
                </div>
              )}
            </Section>
          )}

          <Section title="Eligibility as published">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="CGPA cutoff" value={record.eligibility.cgpaLabel} />
              <Fact label="10th standard" value={record.eligibility.tenthLabel} />
              <Fact label="12th standard" value={record.eligibility.twelfthLabel} />
              <Fact label="Arrears" value={record.eligibility.arrearsLabel} />
              <Fact label="Passing years" value={record.eligibility.passingYears.join(", ")} />
              <Fact
                label="Must-have skills"
                value={record.eligibility.mandatorySkills}
                className="sm:col-span-2"
              />
              <Fact
                label="Degrees"
                value={record.eligibility.degrees.join(", ")}
                className="sm:col-span-2"
              />
              <Fact
                label="Branches"
                value={record.eligibility.branches.join(", ")}
                className="sm:col-span-2"
              />
              {/* College targeting is staff-internal; students do not see which campuses are targeted */}
              {staff && (
                <Fact
                  label="Campuses"
                  value={
                    record.eligibility.campuses.length === 0
                      ? "Open to every campus"
                      : `Open to: ${record.eligibility.campuses.join(", ")}`
                  }
                  className="sm:col-span-2"
                />
              )}
            </dl>
          </Section>

          <Section title="Selection process">
            {record.rounds.length === 0 ? (
              <p className="text-sm text-ink-500">No rounds declared yet.</p>
            ) : (
              <ol className="space-y-2">
                {record.rounds.map((round) => (
                  <li
                    key={round.sequence}
                    className="flex items-start gap-3 rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-sm text-ink-800"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-600">
                      {round.sequence}
                    </span>
                    <span className="min-w-0 flex-1 break-words font-medium">
                      <span className="font-semibold text-ink-900">Round {round.sequence}</span> —{" "}
                      {round.name}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {staff && record.applicants.length > 0 && (
            <Section title={`Applicants (${record.applicants.length})`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-ink-500">
                      <th className="py-1 pr-3 whitespace-nowrap">Student</th>
                      <th className="py-1 pr-3 whitespace-nowrap">Roll number</th>
                      <th className="py-1 pr-3 whitespace-nowrap">Campus</th>
                      <th className="py-1 pr-3 whitespace-nowrap">Applied</th>
                      <th className="py-1 whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {record.applicants.map((applicant) => (
                      <tr key={applicant.applicationId} className="border-t border-line">
                        <td className="py-2 pr-3 font-medium text-ink-900 break-words max-w-[200px]">
                          {applicant.fullName}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs">
                          {applicant.rollNumber}
                        </td>
                        <td className="py-2 pr-3 break-words max-w-[180px]">{applicant.campus}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-ink-600">
                          {when(applicant.appliedAt)}
                        </td>
                        <td className="py-2 whitespace-nowrap text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={openSnapshot === applicant.applicationId}
                            onClick={() =>
                              setOpenSnapshot(
                                openSnapshot === applicant.applicationId
                                  ? null
                                  : applicant.applicationId,
                              )
                            }
                          >
                            {openSnapshot === applicant.applicationId
                              ? "Hide snapshot"
                              : "View snapshot"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {record.applicants
                .filter((a) => a.applicationId === openSnapshot)
                .map((applicant) => (
                  <section
                    key={applicant.applicationId}
                    aria-label={`Snapshot of ${applicant.fullName}`}
                    className="mt-3 rounded-lg bg-surface-muted p-4"
                  >
                    <p className="mb-2 text-xs font-semibold text-gold-800">
                      ⚠️ The profile as it was AT APPLY TIME — what the recruiter received, never the
                      live profile.
                    </p>
                    <dl className="grid gap-3 sm:grid-cols-3">
                      <Fact label="CGPA" value={fromSnapshot(applicant.snapshot, "overallCgpa")} />
                      <Fact
                        label="10th %"
                        value={fromSnapshot(applicant.snapshot, "tenthPercentage")}
                      />
                      <Fact
                        label="12th %"
                        value={fromSnapshot(applicant.snapshot, "twelfthPercentage")}
                      />
                      <Fact
                        label="Current arrears"
                        value={fromSnapshot(applicant.snapshot, "currentArrears")}
                      />
                      <Fact label="Degree" value={fromSnapshot(applicant.snapshot, "degree")} />
                      <Fact label="Branch" value={fromSnapshot(applicant.snapshot, "branch")} />
                    </dl>
                  </section>
                ))}
            </Section>
          )}

          {record.siblingRoles.length > 0 && (
            <Section title="Other Roles in This Drive">
              <p className="mb-3 text-sm text-ink-600">
                This company is hiring for {record.siblingRoles.length + 1} roles under the same
                recruitment drive.
              </p>
              <ul className="space-y-2">
                {record.siblingRoles.map((sibling) => (
                  <li
                    key={sibling.driveId}
                    className="rounded-lg border border-line bg-surface-muted p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 max-w-full">
                        <Link
                          to={`/drives/${sibling.driveId}`}
                          className="font-semibold text-brand-600 hover:underline break-words"
                        >
                          {sibling.roleTitle || "Unnamed role"}
                        </Link>
                        {sibling.driveType !== null && (
                          <span className="ml-2">
                            <Badge tone={driveTypeTone(asDriveType(sibling.driveType))}>
                              {driveTypeLabel(asDriveType(sibling.driveType))}
                            </Badge>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm shrink-0">
                        <Badge tone={STATUS_TONE[sibling.status] ?? "neutral"}>
                          {STATUS_LABEL[sibling.status] ?? sibling.status}
                        </Badge>
                        <span className="text-ink-600">{sibling.ctcLabel}</span>
                        {sibling.stipendLabel !== null && (
                          <span className="text-ink-600">{sibling.stipendLabel}</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {/* Sidebar Column (1 col) */}
        <div className="space-y-6 lg:col-span-1">
          <Section title="Compensation">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Fact label="CTC" value={record.ctcLabel} />
              <Fact label="Breakup" value={record.ctcBreakup} />
              <Fact label="Bond / service agreement" value={record.bondDetails} />
              <Fact
                label="Openings"
                value={record.openings === null ? "" : String(record.openings)}
              />
            </dl>
          </Section>

          <Section title="Where and when">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Fact label="Locations" value={record.locations} />
              <Fact label="Mode" value={record.driveMode.replaceAll("_", " ")} />
              {/* UAT 2026-08-21 item 2: worded by the domain; null hides it. */}
              <Fact label="Venue" value={record.venue ?? ""} />
              <Fact label="Applications open" value={when(record.applicationStart)} />
              <Fact label="Applications close" value={when(record.applicationEnd)} />
              <Fact label="Tentative drive date" value={when(record.tentativeDate)} />
              <Fact label="Shift" value={record.shift} />
              <Fact label="Joining" value={record.joining} />
            </dl>
          </Section>

          {role === "account_executive" && (
            <Section title="Recruiter contacts — visible to you alone">
              {record.recruiters.length === 0 ? (
                // A5 (UAT 2026-08-19): an honest "none", with the routing stated.
                <p className="text-sm text-ink-700">
                  No contact recorded for this company — communication goes through the{" "}
                  <strong>Central Placement Coordinator</strong>.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {record.recruiters.map((contact) => (
                    <dl
                      // Contacts have no id of their own; the four fields together are the identity.
                      key={`${contact.name}|${contact.designation}|${contact.email}|${contact.phone}`}
                      className="grid gap-2.5 rounded-lg border border-line p-3"
                    >
                      <Fact label="Name" value={contact.name} />
                      <Fact label="Designation" value={contact.designation} />
                      <Fact label="Email" value={contact.email} className="break-all" />
                      <Fact label="Phone" value={contact.phone} />
                    </dl>
                  ))}
                </div>
              )}
            </Section>
          )}

          {staff && (
            <Section title="Provenance">
              <p className="text-sm leading-relaxed text-ink-700 break-words [overflow-wrap:anywhere]">
                Raised by <strong>{record.provenance.raisedBy ?? "—"}</strong> ·{" "}
                {when(record.provenance.raisedAt)}
                {record.provenance.approvedBy !== null && (
                  <>
                    <br />→ Approved by <strong>{record.provenance.approvedBy}</strong> ·{" "}
                    {when(record.provenance.approvedAt)}
                  </>
                )}
                {record.provenance.publishedBy !== null && (
                  <>
                    <br />→ Published by <strong>{record.provenance.publishedBy}</strong> ·{" "}
                    {when(record.provenance.publishedAt)}
                  </>
                )}
              </p>
              <p className="mt-2 text-xs italic text-ink-500">
                This page edits nothing. Actions stay on their own screens.
              </p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
