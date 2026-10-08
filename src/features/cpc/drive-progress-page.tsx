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
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

/**
 * D10 (2026-08-12): the placement coordinator and KAM follow students
 * through the ENTIRE cycle — shortlist, every round, the offer.
 *
 * Strictly read-only. Recording results is the Central CPC's (D8); attendance
 * has its own screen. RLS scopes everything here to the coordinator's / KAM's campuses,
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
  readonly studentId?: string | undefined;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly campusName?: string | undefined;
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

const PAGE_SIZE = 5;

export function DriveProgressPage({ view }: { view: DriveProgressView }) {
  const [drives, setDrives] = useState<readonly DriveProgressEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<DriveTypeFilterValue>("");
  const [page, setPage] = useState(1);
  const [selectedCollegeByDrive, setSelectedCollegeByDrive] = useState<Record<string, string>>({});
  const [selectedStageByDrive, setSelectedStageByDrive] = useState<
    Record<string, "all" | "shortlisted" | "in_rounds" | "offers">
  >({});

  useEffect(() => {
    void view.drives().then(setDrives);
  }, [view]);

  // The domain's predicate, so "hcl" matches the same drives here as on every other list.
  const visible = useMemo(() => {
    if (drives === null) return [];
    return searchDrives(
      drives.filter((drive) => matchesDriveType(drive.driveType ?? null, type)),
      query,
    );
  }, [drives, query, type]);

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

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const paginatedDrives = useMemo(
    () => visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visible, page],
  );

  return (
    <div>
      <PageHeader
        title="Drive progress"
        subtitle="Students and college-wise progress through every round to the offer. Read-only — results are recorded centrally."
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
          <DriveSearch
            value={query}
            onChange={(q) => {
              setQuery(q);
              setPage(1);
            }}
          />
          <DriveTypeFilter
            value={type}
            onChange={(t) => {
              setType(t);
              setPage(1);
            }}
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

          {paginatedDrives.map((drive) => {
            const selectedCollege = selectedCollegeByDrive[drive.driveId] ?? "";
            const selectedStage = selectedStageByDrive[drive.driveId] ?? "all";

            // College-wise count aggregation
            const collegeMap = new Map<
              string,
              { applied: number; shortlisted: number; inRounds: number; offers: number }
            >();

            for (const s of drive.students) {
              const cName = s.campusName ?? "All Campuses";
              const current = collegeMap.get(cName) ?? {
                applied: 0,
                shortlisted: 0,
                inRounds: 0,
                offers: 0,
              };
              collegeMap.set(cName, {
                applied: current.applied + 1,
                shortlisted: current.shortlisted + (s.shortlisted ? 1 : 0),
                inRounds: current.inRounds + (s.rounds.length > 0 ? 1 : 0),
                offers: current.offers + (s.offer !== null ? 1 : 0),
              });
            }

            const collegeList = [...collegeMap.entries()].map(([name, counts]) => ({
              name,
              ...counts,
            }));

            const filteredStudents = drive.students.filter((s) => {
              if (selectedCollege !== "" && (s.campusName ?? "All Campuses") !== selectedCollege) {
                return false;
              }
              if (selectedStage === "shortlisted" && !s.shortlisted) return false;
              if (selectedStage === "in_rounds" && s.rounds.length === 0) return false;
              if (selectedStage === "offers" && s.offer === null) return false;
              return true;
            });

            const totalShortlisted = drive.students.filter((s) => s.shortlisted).length;
            const totalInRounds = drive.students.filter((s) => s.rounds.length > 0).length;
            const totalOffers = drive.students.filter((s) => s.offer !== null).length;

            return (
              <Card key={drive.driveId} className="mb-6 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-muted/30 p-4">
                  <div className="min-w-0">
                    <Link
                      to={`/drives/${drive.driveId}`}
                      className="flex flex-wrap items-center gap-2 font-heading text-lg font-bold text-ink-900 hover:text-brand-600 hover:underline transition-colors"
                    >
                      {drive.companyName}
                      <Badge tone={driveTypeTone(drive.driveType ?? null)}>
                        {driveTypeLabel(drive.driveType ?? null)}
                      </Badge>
                    </Link>
                    <p className="text-sm text-ink-500">{drive.roleTitle ?? "Role not set"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Stage quick filter buttons */}
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedStageByDrive((prev) => ({
                          ...prev,
                          [drive.driveId]: "all",
                        }))
                      }
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer border ${
                        selectedStage === "all"
                          ? "bg-brand-500 text-white border-brand-600"
                          : "bg-surface text-ink-700 border-line hover:bg-surface-muted"
                      }`}
                    >
                      {drive.students.length} Total Applicants
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedStageByDrive((prev) => ({
                          ...prev,
                          [drive.driveId]: selectedStage === "shortlisted" ? "all" : "shortlisted",
                        }))
                      }
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer border ${
                        selectedStage === "shortlisted"
                          ? "bg-brand-500 text-white border-brand-600"
                          : "bg-surface text-ink-700 border-line hover:bg-surface-muted"
                      }`}
                    >
                      {totalShortlisted} Shortlisted
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedStageByDrive((prev) => ({
                          ...prev,
                          [drive.driveId]: selectedStage === "in_rounds" ? "all" : "in_rounds",
                        }))
                      }
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer border ${
                        selectedStage === "in_rounds"
                          ? "bg-brand-500 text-white border-brand-600"
                          : "bg-surface text-gold-700 border-gold-300 hover:bg-gold-50"
                      }`}
                    >
                      {totalInRounds} In Rounds
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedStageByDrive((prev) => ({
                          ...prev,
                          [drive.driveId]: selectedStage === "offers" ? "all" : "offers",
                        }))
                      }
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer border ${
                        selectedStage === "offers"
                          ? "bg-success-600 text-white border-success-700"
                          : "bg-surface text-success-700 border-success-300 hover:bg-success-50"
                      }`}
                    >
                      {totalOffers} Offers
                    </button>
                    <Badge tone="brand">{label(drive.status)}</Badge>
                  </div>
                </div>

                {/* College-wise Clickable Count Cards */}
                {collegeList.length > 0 && (
                  <div className="border-b border-line bg-surface px-4 py-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
                      College Breakdown (Click card to filter college · Click counts to filter stage)
                    </p>
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                      {/* Overall / All colleges button card */}
                      <div
                        className={`rounded-lg p-3 transition-all ${
                          selectedCollege === ""
                            ? "bg-brand-50 border-2 border-brand-500 shadow-xs"
                            : "bg-surface-muted/50 border border-line"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedCollegeByDrive((prev) => ({
                              ...prev,
                              [drive.driveId]: "",
                            }))
                          }
                          className="w-full flex items-center justify-between font-semibold text-xs text-ink-800 hover:text-brand-600 cursor-pointer"
                        >
                          <span>All Colleges</span>
                          {selectedCollege === "" && <span className="text-brand-600 font-bold">✓</span>}
                        </button>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-600">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCollegeByDrive((prev) => ({ ...prev, [drive.driveId]: "" }));
                              setSelectedStageByDrive((prev) => ({ ...prev, [drive.driveId]: "all" }));
                            }}
                            className="hover:underline cursor-pointer"
                          >
                            Applied: <strong className="text-ink-900">{drive.students.length}</strong>
                          </button>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCollegeByDrive((prev) => ({ ...prev, [drive.driveId]: "" }));
                              setSelectedStageByDrive((prev) => ({
                                ...prev,
                                [drive.driveId]: "shortlisted",
                              }));
                            }}
                            className="hover:underline cursor-pointer"
                          >
                            Shortlisted:{" "}
                            <strong className="text-ink-900">{totalShortlisted}</strong>
                          </button>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCollegeByDrive((prev) => ({ ...prev, [drive.driveId]: "" }));
                              setSelectedStageByDrive((prev) => ({
                                ...prev,
                                [drive.driveId]: "offers",
                              }));
                            }}
                            className="hover:underline cursor-pointer"
                          >
                            Offers: <strong className="text-brand-700">{totalOffers}</strong>
                          </button>
                        </div>
                      </div>

                      {/* Individual College cards */}
                      {collegeList.map((col) => (
                        <div
                          key={col.name}
                          className={`rounded-lg p-3 transition-all ${
                            selectedCollege === col.name
                              ? "bg-brand-50 border-2 border-brand-500 shadow-xs"
                              : "bg-surface-muted/50 border border-line"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedCollegeByDrive((prev) => ({
                                ...prev,
                                [drive.driveId]: prev[drive.driveId] === col.name ? "" : col.name,
                              }))
                            }
                            className="w-full flex items-center justify-between font-semibold text-xs text-ink-800 hover:text-brand-600 cursor-pointer"
                            title={col.name}
                          >
                            <span className="truncate">{col.name}</span>
                            {selectedCollege === col.name && <span className="ml-1 text-brand-600 font-bold">✓</span>}
                          </button>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-600">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCollegeByDrive((prev) => ({
                                  ...prev,
                                  [drive.driveId]: col.name,
                                }));
                                setSelectedStageByDrive((prev) => ({
                                  ...prev,
                                  [drive.driveId]: "all",
                                }));
                              }}
                              className="hover:underline cursor-pointer"
                            >
                              Applied: <strong className="text-ink-900">{col.applied}</strong>
                            </button>
                            <span>·</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCollegeByDrive((prev) => ({
                                  ...prev,
                                  [drive.driveId]: col.name,
                                }));
                                setSelectedStageByDrive((prev) => ({
                                  ...prev,
                                  [drive.driveId]: "shortlisted",
                                }));
                              }}
                              className="hover:underline cursor-pointer"
                            >
                              Shortlisted: <strong className="text-ink-900">{col.shortlisted}</strong>
                            </button>
                            <span>·</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCollegeByDrive((prev) => ({
                                  ...prev,
                                  [drive.driveId]: col.name,
                                }));
                                setSelectedStageByDrive((prev) => ({
                                  ...prev,
                                  [drive.driveId]: "offers",
                                }));
                              }}
                              className="hover:underline cursor-pointer"
                            >
                              Offers: <strong className="text-brand-700">{col.offers}</strong>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Student list for this drive / selected college */}
                <ul className="divide-y divide-neutral-200">
                  {filteredStudents.length === 0 ? (
                    <li className="p-4 text-xs text-ink-500 italic text-center">
                      No students found for this filter.
                    </li>
                  ) : (
                    filteredStudents.map((student) => (
                      <li
                        key={student.applicationId}
                        className="flex flex-wrap items-start justify-between gap-4 p-4 hover:bg-surface-muted/20 transition-colors"
                      >
                        <div className="min-w-40">
                          {student.studentId ? (
                            <Link
                              to={`/students/${student.studentId}`}
                              className="font-medium text-ink-900 hover:text-brand-600 hover:underline transition-colors block"
                            >
                              {student.studentName}
                            </Link>
                          ) : (
                            <p className="font-medium text-ink-900">{student.studentName}</p>
                          )}
                          <p className="text-sm text-ink-500">{student.rollNumber}</p>
                          {student.campusName && (
                            <span className="mt-0.5 inline-block text-[11px] font-medium text-brand-700">
                              {student.campusName}
                            </span>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
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
                              Offer ·{" "}
                              {describeOfferPay({
                                driveType: student.offer.driveType ?? "placement",
                                ctcLpa: student.offer.ctcLpa,
                                stipendMonthly: student.offer.stipendMonthly ?? null,
                              })}
                              {student.offer.offerCategory !== null
                                ? ` · ${offerCategoryLabelOf(student.offer.offerCategory)}`
                                : ""}
                            </Badge>
                          )}
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </Card>
            );
          })}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-ink-500">
                Showing Page <span className="font-semibold text-ink-900">{page}</span> of{" "}
                <span className="font-semibold text-ink-900">{totalPages}</span> ({visible.length}{" "}
                total drives)
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      p === page
                        ? "bg-brand-500 text-white"
                        : "border border-line text-ink-700 hover:bg-surface-muted"
                    }`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
