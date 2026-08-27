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

import { sameMoney } from "./math";
import type { OfferCategory } from "./offer-category";
import { countsAsSubmitted, countsAsVerified } from "./registration-funnel";
import type { OfferSource, ParticipationStatus, SrfStatus } from "./types";

/** The one offer reported as this student's placement, flattened for display. */
export interface DirectoryPlacement {
  readonly companyName: string;
  readonly roleTitle: string | null;
  /** Null when the offer records no annual figure (0070). */
  readonly ctcLpa: number | null;
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
  /**
   * Holds a self-placed offer — whether or not it is the one displayed.
   *
   * 2026-08-26: the overview's Self-placed card counts every student with such
   * an offer, while `placement` shows the on-campus record when both exist
   * (C1). Without this fact, a doubly-placed student would be missing from the
   * list their own card opened.
   */
  readonly hasSelfPlacement: boolean;
}

/**
 * 2026-08-26: `on_campus`, `self_placed`, `submitted` and `verified` were
 * added so every card on the placement overview can open exactly the students
 * it counted.
 *
 * `placed` keeps its C1 meaning — any placement record, self-placed included —
 * because that is the question a coordinator asks of a directory. `on_campus`
 * is the REPORTED statistic (PRD §16.2), and the two are deliberately
 * different populations rather than one blurred one.
 */
export type DirectoryFilter =
  | "all"
  | "placed"
  | "on_campus"
  | "self_placed"
  | "not_placed"
  | "opted_out"
  | "submitted"
  | "verified";

export interface DirectoryQuery {
  readonly filter: DirectoryFilter;
  readonly query: string;
  /** Exact campus name, case-insensitive. Carried from the overview's switcher. */
  readonly campus?: string | undefined;
  /** A package figure to drill into. Compared with `sameMoney`, never `===`. */
  readonly ctc?: number | undefined;
  /** The placement's offer category. */
  readonly category?: OfferCategory | undefined;
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

/**
 * Placed ON CAMPUS — the figure PRD §16.2 reports and the overview's card.
 *
 * An on-campus record always wins the display when both exist
 * (`resolveDisplayedPlacement`), so reading the displayed source is the same
 * population as `hasOnCampusPlacement`, and not a second definition of it.
 */
const isPlacedOnCampus = (student: DirectoryStudent): boolean =>
  student.placement?.source === "on_campus";

/** The evidence the funnel's middle stages are judged on. */
const evidence = (student: DirectoryStudent) => ({
  srfStatus: student.srfStatus,
  hasApplied: student.applications > 0,
  hasOnCampusPlacement: isPlacedOnCampus(student),
});

const matchesFilter = (student: DirectoryStudent, filter: DirectoryFilter): boolean => {
  switch (filter) {
    case "all":
      return true;
    case "placed":
      return isPlaced(student);
    case "on_campus":
      return isPlacedOnCampus(student);
    case "self_placed":
      return student.hasSelfPlacement;
    case "not_placed":
      return !isPlaced(student);
    case "opted_out":
      return student.participationStatus === "opted_out";
    case "submitted":
      return countsAsSubmitted(evidence(student));
    case "verified":
      return countsAsVerified(evidence(student));
  }
};

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
  { filter, query, campus, ctc, category }: DirectoryQuery,
): readonly DirectoryStudent[] {
  const needle = query.trim().toLowerCase();
  const campusName = campus?.trim().toLowerCase();

  return students.filter((student) => {
    if (!matchesFilter(student, filter)) return false;

    if (campusName !== undefined && campusName !== "") {
      if (student.campusName.trim().toLowerCase() !== campusName) return false;
    }

    // An unplaced student holds no package and no category, so a drill-down
    // into either excludes them - never matches them on a missing value.
    if (ctc !== undefined) {
      // A placement with no annual figure (an internship's stipend, 0070)
      // matches no CTC drill-down, for the same reason an unplaced student
      // does not: there is no package to compare, and treating the absence as
      // zero would file them under "₹0 LPA".
      const held = student.placement?.ctcLpa ?? null;
      if (held === null || !sameMoney(held, ctc)) return false;
    }

    if (category !== undefined) {
      if (student.placement?.offerCategory !== category) return false;
    }

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
