/**
 * The student directory — every student in the placement process, and where
 * they got to.
 *
 * Asked for 2026-08-17: "add one more page to display details of all students
 * part of the placement process", and "hyperlink the Placed count to open or
 * export a detailed breakdown (student name, company, package, role)".
 *
 * Those are one screen, not two. The breakdown is this list filtered to the
 * placed, so the number on the dashboard and the rows behind it cannot drift
 * apart - which they would, given two screens and two definitions of "placed".
 *
 * The placement carried here is R9's single record (`resolvePlacementRecord`),
 * resolved by the caller: a student holding three offers appears once, at the
 * one that counts.
 */

import type { OfferCategory } from "./offer-category";
import type { OfferSource, ParticipationStatus, SrfStatus } from "./types";

/** The one offer reported as this student's placement, flattened for display. */
export interface DirectoryPlacement {
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly ctcLpa: number;
  readonly offerCategory: OfferCategory | null;
  /**
   * C1 (UAT 2026-08-19): a self-placed student IS placed here. The source is
   * carried so the row can say so — R9's reported statistic still excludes
   * self-placed, and a directory that silently mixed the two would make the
   * overview number look wrong instead of differently-scoped.
   */
  readonly source: OfferSource;
}

export interface DirectoryStudent {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly campusName: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
  readonly applications: number;
  /** Null when they hold no placement record. */
  readonly placement: DirectoryPlacement | null;
}

export type DirectoryFilter = "all" | "placed" | "not_placed" | "opted_out";

export interface DirectoryQuery {
  readonly filter: DirectoryFilter;
  readonly query: string;
}

export interface DirectorySummary {
  readonly total: number;
  readonly placed: number;
  readonly notPlaced: number;
  readonly optedOut: number;
}

/**
 * Placement and participation are different questions.
 *
 * An opted-out student who was already placed is still placed. Letting the
 * participation column answer the placement question is how a placed student
 * silently disappears from a report.
 */
const isPlaced = (student: DirectoryStudent): boolean => student.placement !== null;

/** Everything a coordinator might reasonably type into one box. */
function haystack(student: DirectoryStudent): string {
  return [
    student.fullName,
    student.rollNumber,
    student.campusName,
    student.degree,
    student.branch,
    String(student.passingYear),
    student.placement?.companyName ?? "",
    student.placement?.roleTitle ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * The rows to show, in the order they were given.
 *
 * Filter and query COMPOSE: searching inside "placed" stays inside "placed".
 * A query that widened the filter would quietly answer a different question
 * from the one the tab claims to be answering.
 */
export function filterDirectory(
  students: readonly DirectoryStudent[],
  { filter, query }: DirectoryQuery,
): readonly DirectoryStudent[] {
  const needle = query.trim().toLowerCase();

  return students.filter((student) => {
    const passesFilter =
      filter === "all" ||
      (filter === "placed" && isPlaced(student)) ||
      (filter === "not_placed" && !isPlaced(student)) ||
      (filter === "opted_out" && student.participationStatus === "opted_out");

    if (!passesFilter) return false;
    return needle === "" || haystack(student).includes(needle);
  });
}

/** Counts for the tabs. `placed + notPlaced` is always `total`, by construction. */
export function summariseDirectory(students: readonly DirectoryStudent[]): DirectorySummary {
  const placed = students.filter(isPlaced).length;

  return {
    total: students.length,
    placed,
    notPlaced: students.length - placed,
    optedOut: students.filter((s) => s.participationStatus === "opted_out").length,
  };
}
