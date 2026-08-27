import { DriveSearch, NoDriveMatches } from "@components/drive-search";
import { DriveTypeFilter } from "@components/drive-type-filter";
import { Badge, Card, PageHeader } from "@components/ui";
import { searchDrives } from "@domain/drive-portfolio";
import {
  type DriveTypeFilter as DriveTypeFilterValue,
  driveTypeLabel,
  driveTypeTone,
  matchesDriveType,
} from "@domain/drive-type";
import { offerCategoryLabelOf } from "@domain/offer-category";
import { describeOfferPay } from "@domain/offer-pay";
import type { AttendanceStatus, DriveType, RoundResult } from "@domain/types";
import { useEffect, useState } from "react";

/**
 * D10 (2026-08-12): the campus placement coordinator follows their students
 * through the ENTIRE cycle — shortlist, every round, the offer.
 *
 * Strictly read-only. Recording results is the Central CPC's (D8); attendance
 * has its own screen. RLS scopes everything here to the coordinator's campus,
 * so an empty screen means "no drives touch my students", not "no access".
 */

export interface StudentRoundProgress {
  readonly sequence: number;
  readonly name: string;
  readonly attendance: AttendanceStatus;
  readonly result: RoundResult | null;
}

export interface DriveProgressStudent {
  readonly applicationId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly shortlisted: boolean;
  readonly rounds: readonly StudentRoundProgress[];
  readonly offer: {
    /** 0070: null on a plain internship, which records a stipend instead. */
    readonly ctcLpa: number | null;
    readonly stipendMonthly?: number | null;
    readonly driveType?: DriveType;
    readonly offerCategory: string | null;
  } | null;
}

export interface DriveProgressEntry {
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  /** 2026-08-27: filtered on, and tagged on every card. */
  readonly driveType?: DriveType | null;
  readonly status: string;
  readonly students: readonly DriveProgressStudent[];
}

export interface DriveProgressView {
  drives(): Promise<readonly DriveProgressEntry[]>;
}

const label = (value: string) => value.replaceAll("_", " ");

const RESULT_TONE = (result: RoundResult | null, attendance: AttendanceStatus) => {
  if (result === "selected") return "success" as const;
  if (result === "rejected") return "danger" as const;
  if (attendance === "absent") return "danger" as const;
  return "neutral" as const;
};

export function DriveProgressPage({ view }: { view: DriveProgressView }) {
  const [drives, setDrives] = useState<readonly DriveProgressEntry[] | null>(null);
  /**
   * 2026-08-18: "search for specific companies and monitor their ongoing drive
   * progress without manual scrolling." Each card here carries a whole cohort's
   * rounds, so this is the longest scroll in the application.
   */
  const [query, setQuery] = useState("");
  const [type, setType] = useState<DriveTypeFilterValue>("");

  useEffect(() => {
    void view.drives().then(setDrives);
  }, [view]);

  // The domain's predicate, so "hcl" matches the same drives here as on every
  // other list.
  const visible =
    drives === null
      ? []
      : searchDrives(
          drives.filter((drive) => matchesDriveType(drive.driveType ?? null, type)),
          query,
        );

  const typeCounts =
    drives === null
      ? undefined
      : {
          "": drives.length,
          placement: drives.filter((d) => d.driveType === "placement").length,
          internship_convertible: drives.filter((d) => d.driveType === "internship_convertible")
            .length,
          internship: drives.filter((d) => d.driveType === "internship").length,
        };

  return (
    <div>
      <PageHeader
        title="Drive progress"
        subtitle="Your students, through every round to the offer. Read-only — results are recorded centrally."
      />

      {drives === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading drives…
        </p>
      ) : drives.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">No drives involve your students yet.</p>
        </Card>
      ) : (
        <>
          <DriveSearch value={query} onChange={setQuery} />
          <DriveTypeFilter
            value={type}
            onChange={setType}
            {...(typeCounts === undefined ? {} : { counts: typeCounts })}
          />
          {visible.length === 0 ? (
            <Card className="p-6">
              <NoDriveMatches
                query={query}
                {...(type === "" ? {} : { typeLabel: driveTypeLabel(type) })}
              />
            </Card>
          ) : null}
          {visible.map((drive) => (
            <Card key={drive.driveId} className="mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-heading text-lg font-bold text-ink-900">
                    {drive.companyName}
                    {/* 2026-08-27: the type, on every drive summary. */}
                    <Badge tone={driveTypeTone(drive.driveType ?? null)}>
                      {driveTypeLabel(drive.driveType ?? null)}
                    </Badge>
                  </p>
                  <p className="text-sm text-ink-500">{drive.roleTitle ?? "Role not set"}</p>
                </div>
                <Badge tone="brand">{label(drive.status)}</Badge>
              </div>
              <ul className="divide-y divide-neutral-200">
                {drive.students.map((student) => (
                  <li key={student.applicationId} className="flex flex-wrap items-start gap-4 p-4">
                    <div className="min-w-40">
                      <p className="font-medium text-ink-900">{student.studentName}</p>
                      <p className="text-sm text-ink-500">{student.rollNumber}</p>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      {student.shortlisted ? (
                        student.rounds.length === 0 ? (
                          <Badge tone="neutral">Shortlisted — no round yet</Badge>
                        ) : (
                          student.rounds.map((round) => (
                            <Badge
                              key={round.sequence}
                              tone={RESULT_TONE(round.result, round.attendance)}
                            >
                              Round {round.sequence} ·{" "}
                              {round.result !== null
                                ? label(round.result)
                                : label(round.attendance)}
                            </Badge>
                          ))
                        )
                      ) : (
                        <Badge tone="neutral">Applied — not shortlisted</Badge>
                      )}
                      {student.offer !== null && (
                        <Badge tone="success">
                          {/* 2026-08-27: an internship is paid monthly. This
                              read "Offer · ₹10 LPA" against ₹15,000 a month. */}
                          Offer ·{" "}
                          {describeOfferPay({
                            driveType: student.offer.driveType ?? "placement",
                            ctcLpa: student.offer.ctcLpa,
                            stipendMonthly: student.offer.stipendMonthly ?? null,
                          })}
                          {/* 2026-08-27: the domain's spelling, not the
                              round-status humaniser it happened to sit next
                              to. `label` still serves results and attendance,
                              which have no domain wording of their own. */}
                          {student.offer.offerCategory !== null
                            ? ` · ${offerCategoryLabelOf(student.offer.offerCategory)}`
                            : ""}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
