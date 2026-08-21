import { Badge, Card, PageHeader } from "@components/ui";
import { FUNNEL_STAGES, type FunnelStageKey, filterFunnelStage } from "@domain/drive-portfolio";
import { offerCategoryLabel } from "@domain/offer-category";
import type { AppRole } from "@domain/types";
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
      <h2 className="mb-3 inline-block border-b-2 border-[#FFB800] pb-0.5 font-[Raleway] text-sm font-bold uppercase tracking-wide text-[#3D3777]">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  if (value.trim() === "" || value === "—") return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value}</dd>
    </div>
  );
}

/** A snapshot value that may be nested under `academics` (the R7 shape). */
function fromSnapshot(snapshot: Record<string, unknown>, key: string): string {
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
      <Card className="border border-[#DD4820] bg-[#FFF0EC] p-5">
        <p role="alert" className="text-sm text-[#DD4820]">
          {error}
        </p>
      </Card>
    );
  }

  if (record === null) {
    return (
      <p role="status" className="p-6 text-sm text-neutral-500">
        Loading the drive…
      </p>
    );
  }

  const staff = role !== "student";

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
    <>
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
              <ul className="divide-y divide-neutral-200">
                {stageApplicants.map((applicant) => (
                  <li
                    key={applicant.applicationId}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <span>
                      <Link
                        to={`/students/${applicant.studentId}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {applicant.fullName}
                      </Link>{" "}
                      <span className="text-sm text-ink-500">
                        {applicant.rollNumber}
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
        <Badge tone="brand">{STATUS_LABEL[record.status] ?? record.status}</Badge>
        {record.offerCategory !== null && (
          <Badge tone="neutral">{offerCategoryLabel(record.offerCategory)}</Badge>
        )}
        {record.driveType !== "" && (
          <Badge tone="neutral">{record.driveType.replaceAll("_", " ")}</Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Compensation">
          <dl className="grid gap-3 sm:grid-cols-2">
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
          <dl className="grid gap-3 sm:grid-cols-2">
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

        <Section title="Eligibility as published">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="CGPA cutoff" value={record.eligibility.cgpaLabel} />
            <Fact label="10th standard" value={record.eligibility.tenthLabel} />
            <Fact label="12th standard" value={record.eligibility.twelfthLabel} />
            <Fact label="Arrears" value={record.eligibility.arrearsLabel} />
            <Fact label="Passing years" value={record.eligibility.passingYears.join(", ")} />
            <Fact label="Must-have skills" value={record.eligibility.mandatorySkills} />
            <Fact label="Degrees" value={record.eligibility.degrees.join(", ")} />
            <Fact label="Branches" value={record.eligibility.branches.join(", ")} />
            <Fact label="Campuses" value={record.eligibility.campuses.join(", ")} />
          </dl>
        </Section>

        <Section title="Selection process">
          {record.rounds.length === 0 ? (
            <p className="text-sm text-ink-500">No rounds declared yet.</p>
          ) : (
            <ol className="space-y-1">
              {record.rounds.map((round) => (
                <li key={round.sequence} className="text-sm text-ink-800">
                  <span className="font-semibold">Round {round.sequence}</span> — {round.name}
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {(record.jobDescription !== "" || record.jobDescriptionUrl !== null) && (
          <Section title="Job description">
            {record.jobDescription !== "" && (
              <p className="whitespace-pre-line text-sm text-ink-800">{record.jobDescription}</p>
            )}
            {record.jobDescriptionUrl !== null && (
              <p className="mt-3 text-sm">
                <a
                  href={record.jobDescriptionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[#3D3777] underline underline-offset-2"
                >
                  {record.jobDescriptionName ?? "Job description (PDF)"}
                </a>{" "}
                <span className="text-ink-500">— the recruiter’s own document</span>
              </p>
            )}
          </Section>
        )}

        {staff && record.applicants.length > 0 && (
          <Section title={`Applicants (${record.applicants.length})`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-1 pr-3">Student</th>
                  <th className="py-1 pr-3">Roll number</th>
                  <th className="py-1 pr-3">Campus</th>
                  <th className="py-1 pr-3">Applied</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {record.applicants.map((applicant) => (
                  <tr key={applicant.applicationId} className="border-t border-line">
                    <td className="py-2 pr-3 font-medium text-ink-900">{applicant.fullName}</td>
                    <td className="py-2 pr-3">{applicant.rollNumber}</td>
                    <td className="py-2 pr-3">{applicant.campus}</td>
                    <td className="py-2 pr-3">{when(applicant.appliedAt)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-xs font-semibold text-[#3D3777] underline underline-offset-2"
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
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {record.applicants
              .filter((a) => a.applicationId === openSnapshot)
              .map((applicant) => (
                <section
                  key={applicant.applicationId}
                  aria-label={`Snapshot of ${applicant.fullName}`}
                  className="mt-3 rounded-lg bg-surface-muted p-4"
                >
                  <p className="mb-2 text-xs font-semibold text-[#8a6d00]">
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

        {role === "account_executive" && (
          <Section title="Recruiter contacts — visible to you alone">
            {record.recruiters.length === 0 ? (
              // A5 (UAT 2026-08-19): an honest "none", with the routing stated.
              <p className="text-sm text-ink-700">
                No contact recorded for this company — communication goes through the{" "}
                <strong>Central Placement Coordinator</strong>.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {record.recruiters.map((contact) => (
                  <dl
                    // Contacts have no id of their own; the four fields together are the identity.
                    key={`${contact.name}|${contact.designation}|${contact.email}|${contact.phone}`}
                    className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2"
                  >
                    <Fact label="Name" value={contact.name} />
                    <Fact label="Designation" value={contact.designation} />
                    <Fact label="Email" value={contact.email} />
                    <Fact label="Phone" value={contact.phone} />
                  </dl>
                ))}
              </div>
            )}
          </Section>
        )}

        {staff && (
          <Section title="Provenance">
            <p className="text-sm text-ink-700">
              Raised by <strong>{record.provenance.raisedBy ?? "—"}</strong> ·{" "}
              {when(record.provenance.raisedAt)}
              {record.provenance.approvedBy !== null && (
                <>
                  {" "}
                  → Approved by <strong>{record.provenance.approvedBy}</strong> ·{" "}
                  {when(record.provenance.approvedAt)}
                </>
              )}
              {record.provenance.publishedBy !== null && (
                <>
                  {" "}
                  → Published by <strong>{record.provenance.publishedBy}</strong> ·{" "}
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
    </>
  );
}
