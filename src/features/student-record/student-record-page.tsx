import { Badge, Card, PageHeader } from "@components/ui";
import { type OfferCategory, offerCategoryLabel } from "@domain/offer-category";
import { SKILL_SCORE_MAX } from "@domain/skills";
import type { OfferSource, ParticipationStatus, RoleCategory, SrfStatus } from "@domain/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";

/**
 * G7 (UAT 2026-08-20, Q7 answer b): the canonical student record.
 *
 * "Student numbers/counts aren't clickable, and there's no way to drill into
 * student details from that view." One read-only page for every staff role,
 * reached from the directory and anywhere else a student is named. RLS
 * decides who may read the row at all; this page only renders what comes back.
 *
 * Read-only ON PURPOSE: verification belongs to the campus coordinator, and
 * this must never become a second way to edit a student.
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
  readonly ctcLpa: number;
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
}: {
  studentId: string;
  view: StudentRecordView;
}) {
  const [record, setRecord] = useState<StudentRecord | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void view.record(studentId).then((next) => {
      if (live) setRecord(next);
    });
    return () => {
      live = false;
    };
  }, [view, studentId]);

  if (record === undefined) {
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
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title={record.fullName}
        subtitle={`${record.rollNumber} · ${record.campusName}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={record.srfStatus === "srf_approved" ? "success" : "neutral"}>
          Registration: {SRF_LABEL[record.srfStatus]}
        </Badge>
        {record.participationStatus !== "active" && (
          <Badge tone="warning">{record.participationStatus.replaceAll("_", " ")}</Badge>
        )}
      </div>

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
                <dt className="text-ink-500">Email</dt>
                <dd className="text-ink-900">{record.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Mobile</dt>
                <dd className="text-ink-900">{record.mobile ?? "Not recorded"}</dd>
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
                      <span className="font-medium text-ink-900">{semester.cgpa}</span>
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
                    className="rounded-full border border-line bg-surface-muted px-2 py-0.5 font-medium text-ink-700"
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
