import { Badge, ButtonLink } from "@components/ui";
import { attendanceLabel } from "@domain/attendance";
import { offerCategoryLabelOf } from "@domain/offer-category";
import { roundResultLabel } from "@domain/round-outcome";
import type { AttendanceStatus, DriveType, RoundResult } from "@domain/types";
import { useMemo, useState } from "react";

export interface StudentRoundDetail {
  readonly roundId: string;
  readonly sequence: number;
  readonly name: string;
  readonly attendance: AttendanceStatus;
  readonly result: RoundResult | null;
}

export interface DriveProgressStudentItem {
  readonly applicationId: string;
  readonly studentId?: string | undefined;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly campusId: string;
  readonly campusName: string;
  readonly degree?: string | undefined;
  readonly branch?: string | undefined;
  readonly cgpa?: number | undefined;
  readonly shortlisted: boolean;
  readonly rounds: readonly StudentRoundDetail[];
  readonly offer: {
    readonly ctcLpa: number | null;
    readonly stipendMonthly?: number | null | undefined;
    readonly driveType?: DriveType | undefined;
    readonly offerCategory: string | null;
  } | null;
}

const RESULT_TONE = (result: RoundResult | null, attendance: AttendanceStatus) => {
  if (result === "selected") return "success" as const;
  if (result === "rejected") return "danger" as const;
  if (attendance === "absent") return "danger" as const;
  if (attendance === "scheduled") return "neutral" as const;
  return "warning" as const;
};

/**
 * Who is on one role of a drive, and how far each of them has come.
 *
 * The row is the student; the drawer under it is the whole cycle — academics,
 * every round's attendance and result, and the offer with its package. A
 * coordinator deciding whom to chase needs the history, not a badge, and needs
 * it without leaving the list.
 *
 * It carries no chrome of its own: the visit pane gives it a company, a role
 * tab and a way to close.
 */
export function DriveRoster({
  students,
  collegeFilter = "",
}: {
  students: readonly DriveProgressStudentItem[];
  collegeFilter?: string;
}) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | "shortlisted" | "in_rounds" | "offers">(
    "all",
  );
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);

  // College-scoped & search-filtered students
  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      // College scoping
      if (collegeFilter !== "" && s.campusName !== collegeFilter && s.campusId !== collegeFilter) {
        return false;
      }
      // Stage filter
      if (stageFilter === "shortlisted" && !s.shortlisted) return false;
      if (stageFilter === "in_rounds" && s.rounds.length === 0) return false;
      if (stageFilter === "offers" && s.offer === null) return false;
      // Search query
      if (q === "") return true;
      return (
        s.studentName.toLowerCase().includes(q) ||
        s.rollNumber.toLowerCase().includes(q) ||
        s.campusName.toLowerCase().includes(q)
      );
    });
  }, [students, collegeFilter, stageFilter, query]);

  const counts = useMemo(() => {
    const base =
      collegeFilter === ""
        ? students
        : students.filter((s) => s.campusName === collegeFilter || s.campusId === collegeFilter);
    return {
      all: base.length,
      shortlisted: base.filter((s) => s.shortlisted).length,
      inRounds: base.filter((s) => s.rounds.length > 0).length,
      offers: base.filter((s) => s.offer !== null).length,
    };
  }, [students, collegeFilter]);

  const chip = (active: boolean, on: string, off: string) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer border ${
      active ? on : off
    }`;

  const BRAND = "bg-brand-500 text-white border-brand-600";
  const PLAIN = "bg-surface text-ink-700 border-line hover:bg-surface-muted";

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        Showing {filteredStudents.length} of {counts.all} students
        {collegeFilter !== "" ? ` · Filtered to ${collegeFilter}` : ""}
      </p>

      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search students on this role"
          placeholder="Search student by name or roll number…"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
        />
        {query !== "" && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-2.5 text-xs text-ink-400 hover:text-ink-700 cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStageFilter("all")}
          className={chip(stageFilter === "all", BRAND, PLAIN)}
        >
          All ({counts.all})
        </button>
        <button
          type="button"
          onClick={() => setStageFilter("shortlisted")}
          className={chip(stageFilter === "shortlisted", BRAND, PLAIN)}
        >
          Shortlisted ({counts.shortlisted})
        </button>
        <button
          type="button"
          onClick={() => setStageFilter("in_rounds")}
          className={chip(
            stageFilter === "in_rounds",
            BRAND,
            "bg-surface text-gold-700 border-gold-300 hover:bg-gold-50",
          )}
        >
          In Rounds ({counts.inRounds})
        </button>
        <button
          type="button"
          onClick={() => setStageFilter("offers")}
          className={chip(
            stageFilter === "offers",
            "bg-success-600 text-white border-success-700",
            "bg-surface text-success-700 border-success-300 hover:bg-success-50",
          )}
        >
          Offers ({counts.offers})
        </button>
      </div>

      <div className="space-y-2">
        {filteredStudents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-ink-500">
            No students found matching the selected criteria.
          </div>
        ) : (
          filteredStudents.map((student) => {
            const isExpanded = expandedAppId === student.applicationId;
            const hasOffer = student.offer !== null;
            const latestRound =
              student.rounds.length > 0
                ? (student.rounds[student.rounds.length - 1] ?? null)
                : null;

            return (
              <div
                key={student.applicationId}
                className={`rounded-xl border transition-all ${
                  isExpanded
                    ? "border-brand-300 bg-brand-50/20 shadow-xs"
                    : "border-line bg-surface hover:border-line-hover hover:bg-surface-muted/20"
                }`}
              >
                {/* Clickable student summary row */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedAppId((curr) =>
                      curr === student.applicationId ? null : student.applicationId,
                    )
                  }
                  className="w-full flex items-center justify-between p-3.5 text-left cursor-pointer gap-3"
                  aria-expanded={isExpanded}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink-900 text-sm">
                        {student.studentName}
                      </span>
                      <span className="text-xs text-ink-500">(Roll {student.rollNumber})</span>
                      {student.campusName && (
                        <span className="text-[11px] font-medium text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">
                          {student.campusName}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500 truncate">
                      {student.degree && student.branch
                        ? `${student.degree} — ${student.branch}`
                        : ""}
                      {student.cgpa ? ` · ${student.cgpa} CGPA` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {hasOffer ? (
                      <Badge tone="success">
                        Offer{student.offer?.ctcLpa ? `: ₹${student.offer.ctcLpa} LPA` : ""}
                      </Badge>
                    ) : latestRound !== null ? (
                      <Badge tone={RESULT_TONE(latestRound.result, latestRound.attendance)}>
                        Round {latestRound.sequence} ·{" "}
                        {latestRound.result === null
                          ? attendanceLabel(latestRound.attendance)
                          : roundResultLabel(latestRound.result)}
                      </Badge>
                    ) : student.shortlisted ? (
                      <Badge tone="brand">Shortlisted</Badge>
                    ) : (
                      <Badge tone="neutral">Applied</Badge>
                    )}

                    <span className="text-ink-400 text-xs transition-transform">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                </button>

                {/* Expandable placement details drawer. The row above already
                    names the student, their college, programme and CGPA, so
                    this holds only what the row cannot say. */}
                {isExpanded && (
                  <div className="border-t border-line/60 bg-surface p-4 space-y-3.5 text-xs">
                    {/* The row itself is the disclosure, so the record link
                        lives in the drawer rather than inside that button. */}
                    {student.studentId !== undefined && (
                      <ButtonLink
                        size="sm"
                        variant="ghost"
                        to={`/students/${student.studentId}`}
                        aria-label={`View ${student.studentName}`}
                      >
                        View
                      </ButtonLink>
                    )}

                    {/* Offer Details if present */}
                    {hasOffer && student.offer && (
                      <div className="rounded-lg border border-success-200 bg-success-50/50 p-3">
                        <h4 className="font-semibold text-success-800 text-xs mb-1">
                          Placement Offer Details
                        </h4>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <span className="text-success-700 block text-[11px]">
                              Package (CTC)
                            </span>
                            <span className="font-bold text-success-900 text-sm">
                              {student.offer.ctcLpa !== null ? `₹${student.offer.ctcLpa} LPA` : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-success-700 block text-[11px]">
                              Offer Category
                            </span>
                            <span className="font-medium text-success-900">
                              {/* An offer with no category is not a "Standard"
                                  one — it is an unclassified offer, and the old
                                  fallback invented a category the ladder has
                                  never held. Anything the domain does not
                                  recognise is handed back untouched, so a bad
                                  value shows itself instead of going quiet. */}
                              {student.offer.offerCategory === null ||
                              student.offer.offerCategory === ""
                                ? "Not classified"
                                : offerCategoryLabelOf(student.offer.offerCategory)}
                            </span>
                          </div>
                          {student.offer.stipendMonthly ? (
                            <div>
                              <span className="text-success-700 block text-[11px]">
                                Monthly Stipend
                              </span>
                              <span className="font-medium text-success-900">
                                ₹{student.offer.stipendMonthly.toLocaleString()}/mo
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}

                    {/* Rounds & Attendance Progress */}
                    <div>
                      <h4 className="font-semibold text-ink-700 text-xs mb-2 uppercase tracking-wide">
                        Rounds & Evaluation History
                      </h4>
                      {student.rounds.length === 0 ? (
                        <p className="text-ink-500 italic">
                          {student.shortlisted
                            ? "Shortlisted — No evaluation rounds conducted yet."
                            : "Application submitted — awaiting shortlisting."}
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {student.rounds.map((round) => (
                            <div
                              key={round.roundId}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line/60 bg-surface-muted/20 px-3 py-2"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-ink-800">
                                  Round {round.sequence}: {round.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-ink-600">
                                  Attendance:{" "}
                                  <strong className="text-ink-900">
                                    {attendanceLabel(round.attendance)}
                                  </strong>
                                </span>
                                <span>·</span>
                                <Badge tone={RESULT_TONE(round.result, round.attendance)}>
                                  {round.result === null
                                    ? "Result not recorded"
                                    : `Result: ${roundResultLabel(round.result)}`}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
