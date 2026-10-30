import { Badge, Button, ButtonLink, Card, PageHeader } from "@components/ui";
import { visitDayInParentheses } from "@domain/drive-aging";
import { FUNNEL_STAGES, type FunnelStageKey, filterFunnelStage } from "@domain/drive-portfolio";
import { driveStatusLabel, driveStatusTone } from "@domain/drive-status";
import { asDriveType, driveTypeLabel, driveTypeTone } from "@domain/drive-type";
import { describeDriveFreeze } from "@domain/drive-working";
import { offerCategoryLabel, offerCategoryRestatesType } from "@domain/offer-category";
import type { AppRole, DriveStatus } from "@domain/types";
import { ExternalLink, FileText, TriangleAlert } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Skeleton } from "@/components/shadcn/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
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
 * The four figures a reader scans first, in the same shape as `Fact` above —
 * they used to be four copies of one block with three different type scales,
 * so a long CTC and a long city list looked like two different components.
 */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-muted p-3.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</span>
      <p className="mt-1 break-words text-sm font-semibold text-ink-900 [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}

/** Skeleton rows for the drive read, in the shape of the tiles and the two columns. */
const LOADING_TILES = ["ctc", "location", "mode", "deadline"];
const LOADING_MAIN = ["description", "eligibility", "applicants"];
const LOADING_SIDE = ["compensation", "window"];

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
      <Card className="border border-danger-500/30 bg-danger-50 p-5">
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      </Card>
    );
  }

  if (record === null) {
    return (
      <div role="status" aria-busy="true" className="space-y-6">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-5 w-24" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {LOADING_TILES.map((key) => (
            <Skeleton key={key} className="h-[70px]" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {LOADING_MAIN.map((key) => (
              <Skeleton key={key} className="h-44" />
            ))}
          </div>
          <div className="space-y-6">
            {LOADING_SIDE.map((key) => (
              <Skeleton key={key} className="h-36" />
            ))}
          </div>
        </div>
        <p className="text-sm text-ink-500">Loading the drive…</p>
      </div>
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
            <div className="mb-3 flex flex-nowrap overflow-x-auto pb-1 [scrollbar-width:none] gap-1.5 sm:flex-wrap">
              {FUNNEL_STAGES.map((key) => {
                const count = filterFunnelStage(record.applicants, key).length;
                return key === activeStage ? (
                  <span
                    key={key}
                    aria-current="true"
                    className="rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700"
                  >
                    {STAGE_LABEL[key]} ({count})
                  </span>
                ) : (
                  <Link
                    key={key}
                    to={`/drives/${driveId}?stage=${key}`}
                    className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
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
        <Badge tone={driveStatusTone(record.status)}>{driveStatusLabel(record.status)}</Badge>
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

      {/* Quick Highlights — one tile shape, one type scale */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Package / CTC"
          value={record.ctcLabel === "" ? "Not stated" : record.ctcLabel}
        />
        <Tile label="Location" value={record.locations === "" ? "Not stated" : record.locations} />
        <Tile
          label="Drive Mode"
          value={
            record.driveMode === ""
              ? "Not stated"
              : `${record.driveMode.replaceAll("_", " ")} drive`
          }
        />
        <Tile
          label="Apply Deadline"
          value={record.applicationEnd ? when(record.applicationEnd) : "Open"}
        />
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
                <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-surface-muted p-3.5">
                  <FileText className="size-5 shrink-0 text-brand-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    {/* One affordance, named by its document. The row used to carry a
                        link to the PDF AND a second "PDF" button for the same file. */}
                    <a
                      href={record.jobDescriptionUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex min-w-0 items-center gap-1.5 break-words font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700 [overflow-wrap:anywhere]"
                    >
                      {record.jobDescriptionName ?? "Job description (PDF)"}
                      <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                    </a>
                    <p className="text-xs text-ink-500">
                      Official document provided by recruiter — opens in a new tab
                    </p>
                  </div>
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
                    <Badge tone="brand">{round.sequence}</Badge>
                    <span className="min-w-0 flex-1 break-words font-medium [overflow-wrap:anywhere]">
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
              <div className="overflow-x-auto rounded-lg border border-line">
                <Table>
                  <TableHeader className="text-xs uppercase tracking-wide text-ink-500">
                    <TableRow className="border-line">
                      <TableHead className="pl-4">Student</TableHead>
                      <TableHead>Roll number</TableHead>
                      <TableHead>Campus</TableHead>
                      <TableHead>Applied</TableHead>
                      <TableHead className="pr-4 text-right">
                        <span className="sr-only">Snapshot</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="bg-surface">
                    {record.applicants.map((applicant) => {
                      const isOpen = openSnapshot === applicant.applicationId;
                      return (
                        <Fragment key={applicant.applicationId}>
                          <TableRow className="border-line">
                            <TableCell className="max-w-[200px] pl-4 break-words font-medium text-ink-900 [overflow-wrap:anywhere]">
                              <Link
                                to={`/students/${applicant.studentId}`}
                                className="text-brand-600 hover:underline"
                              >
                                {applicant.fullName}
                              </Link>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {applicant.rollNumber}
                            </TableCell>
                            <TableCell className="max-w-[180px] break-words [overflow-wrap:anywhere]">
                              {applicant.campus}
                            </TableCell>
                            <TableCell className="text-ink-600">
                              {when(applicant.appliedAt)}
                            </TableCell>
                            <TableCell className="pr-4 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-expanded={isOpen}
                                aria-controls={`snapshot-${applicant.applicationId}`}
                                onClick={() =>
                                  setOpenSnapshot(isOpen ? null : applicant.applicationId)
                                }
                              >
                                {isOpen ? "Hide snapshot" : "View snapshot"}
                              </Button>
                            </TableCell>
                          </TableRow>
                          {/* The snapshot belongs to its own row, so it opens inside the
                              table rather than under it, where it read as the last row's. */}
                          {isOpen && (
                            <TableRow className="border-line hover:bg-transparent">
                              <TableCell colSpan={5} className="p-0 pt-1 pb-4">
                                <section
                                  id={`snapshot-${applicant.applicationId}`}
                                  aria-label={`Snapshot of ${applicant.fullName}`}
                                  className="rounded-lg bg-surface-muted p-4"
                                >
                                  <p className="mb-2 flex items-start gap-1.5 text-xs font-semibold text-gold-800">
                                    <TriangleAlert
                                      className="mt-px size-3.5 shrink-0"
                                      aria-hidden="true"
                                    />
                                    The profile as it was AT APPLY TIME — what the recruiter
                                    received, never the live profile.
                                  </p>
                                  <dl className="grid gap-3 sm:grid-cols-3">
                                    <Fact
                                      label="CGPA"
                                      value={fromSnapshot(applicant.snapshot, "overallCgpa")}
                                    />
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
                                    <Fact
                                      label="Degree"
                                      value={fromSnapshot(applicant.snapshot, "degree")}
                                    />
                                    <Fact
                                      label="Branch"
                                      value={fromSnapshot(applicant.snapshot, "branch")}
                                    />
                                  </dl>
                                </section>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
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
                        <Badge tone={driveStatusTone(sibling.status)}>
                          {driveStatusLabel(sibling.status)}
                        </Badge>
                        <span className="text-ink-600">
                          {sibling.ctcLabel === "" ? "Package not stated" : sibling.ctcLabel}
                        </span>
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
