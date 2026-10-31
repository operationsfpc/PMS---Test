import type { DriveMode, DriveStatus } from "./types";

/** Reusable company identity across recruitment events. */
export interface Company {
  readonly id: string;
  readonly name: string;
  readonly industry: string | null;
  readonly website: string | null;
  readonly createdAt: string;
}

/** One recruitment visit or event by a company. */
export interface CompanyDriveEvent {
  readonly id: string;
  readonly companyId: string | null;
  readonly companyName: string;
  readonly driveMode: DriveMode | null;
  readonly venue: string | null;
  readonly tentativeDate: string | null;
  readonly timelineNotes: string | null;
  readonly joiningTimeline: string | null;
  readonly status: DriveStatus;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A recruiter / SPOC contact for an event. */
export interface CompanyDriveContact {
  readonly sequence: number;
  readonly name: string;
  readonly designation: string;
  readonly email: string;
  readonly phone: string;
}

/**
 * Resolves the effective campus targeting for a role.
 *
 * If `hasCustomTargeting` is false, the role inherits the event's default campuses.
 * If `hasCustomTargeting` is true, the role uses its own specific campus list.
 */
export function resolveEffectiveCampuses(
  hasCustomTargeting: boolean,
  roleCampuses: readonly string[],
  eventDefaultCampuses: readonly string[],
): readonly string[] {
  if (hasCustomTargeting) {
    return roleCampuses;
  }
  return eventDefaultCampuses;
}

/**
 * Counts distinct company visits across drives.
 *
 * Delegates to the same grouping the lists draw, so a number beside a list can
 * never disagree with the cards under it.
 */
export function countDistinctEvents(
  drives: readonly {
    readonly driveId: string;
    readonly companyDriveId?: string | null | undefined;
    readonly companyName?: string | null | undefined;
    readonly tentativeDate?: string | null | undefined;
  }[],
): number {
  return groupDrivesByEvent(drives).size;
}

/**
 * Counts unique applicants across an event or set of applications.
 */
export function countDistinctApplicants(
  applications: readonly { readonly studentId: string }[],
): number {
  return new Set(applications.map((a) => a.studentId)).size;
}

/** Marks a legacy drive that is a visit on its own, rather than a real event id. */
export const STANDALONE_VISIT_PREFIX = "standalone:";

/**
 * The key one company visit is grouped under.
 *
 * Rows that list several roles of one visit and rows that list one application
 * each arrive with different fields, so every caller passes its own ids here
 * and shares one answer. The prefix is what keeps a legacy drive's own id from
 * ever reading as somebody else's event id.
 */
export function visitKey(companyDriveId: string | null | undefined, ownId: string): string {
  return companyDriveId || `${STANDALONE_VISIT_PREFIX}${ownId}`;
}

/** True when a visit key is a lone legacy drive rather than a shared event. */
export function isStandaloneVisit(key: string): boolean {
  return key.startsWith(STANDALONE_VISIT_PREFIX);
}

/** What a row must be able to say for its company visit to be identified. */
export interface VisitIdentity {
  readonly companyDriveId?: string | null | undefined;
  readonly ownId: string;
  readonly companyName?: string | null | undefined;
  readonly tentativeDate?: string | null | undefined;
}

/** The day part of a date or timestamp, or null when it does not say one. */
function visitDay(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, 10);
}

/** Company names compare case- and spacing-insensitively, as people type them. */
function companySlug(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replaceAll(/\s+/g, " ");
}

/**
 * The key one company visit is grouped under when the row can name both the
 * company and the day.
 *
 * One company on one day is one visit, even when the rows were raised
 * separately and carry different event ids. A different day, or a row missing
 * either fact, falls back to the event key so genuinely separate visits never
 * merge. The `visit:` prefix keeps this namespace away from real event ids and
 * from the legacy `standalone:` keys.
 */
export function companyVisitKey(row: VisitIdentity): string {
  const company = companySlug(row.companyName);
  const day = visitDay(row.tentativeDate);
  if (company === "" || day === null) {
    return visitKey(row.companyDriveId, row.ownId);
  }
  return `visit:${company}|${day}`;
}

/** Groups any rows by the company visit they belong to. */
export function groupByVisitKey<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = keyOf(row);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  return groups;
}

/**
 * Groups rows by the company visit they belong to.
 *
 * Two passes, because either fact alone is not the whole rule:
 *
 *  1. Rows of one event stay together whatever they say — a role that forgot
 *     its date must not fall out of its own event.
 *  2. Event groups that name the same company and day merge. The 0118 backfill
 *     left one event per legacy drive, so separate event ids cannot mean
 *     separate visits.
 *
 * A group that cannot name both facts keeps its event key, so a genuinely
 * different day never merges.
 */
function groupRowsByVisit<T>(
  rows: readonly T[],
  identityOf: (row: T) => VisitIdentity,
): Map<string, T[]> {
  const byEvent = groupByVisitKey(rows, (row) => {
    const identity = identityOf(row);
    return visitKey(identity.companyDriveId, identity.ownId);
  });

  const visits = new Map<string, T[]>();
  for (const [eventKey, eventRows] of byEvent) {
    const named = eventRows.find((row) => {
      const identity = identityOf(row);
      return companySlug(identity.companyName) !== "" && visitDay(identity.tentativeDate) !== null;
    });
    const key = named === undefined ? eventKey : companyVisitKey(identityOf(named));

    const existing = visits.get(key);
    if (existing === undefined) {
      visits.set(key, [...eventRows]);
    } else {
      existing.push(...eventRows);
    }
  }

  return visits;
}

/**
 * Groups drives by their company visit.
 *
 * A drive that names its company and date joins its siblings even when the
 * event ids differ; a legacy drive that cannot say both becomes its own visit.
 */
export function groupDrivesByEvent<
  T extends {
    readonly driveId: string;
    readonly companyDriveId?: string | null | undefined;
    readonly companyName?: string | null | undefined;
    readonly tentativeDate?: string | null | undefined;
  },
>(drives: readonly T[]): Map<string, T[]> {
  return groupRowsByVisit(drives, (drive) => ({
    companyDriveId: drive.companyDriveId,
    ownId: drive.driveId,
    companyName: drive.companyName,
    tentativeDate: drive.tentativeDate,
  }));
}

/** Groups rows that each name the company and day they belong to. */
export function groupByCompanyVisit<T>(
  rows: readonly T[],
  identityOf: (row: T) => VisitIdentity,
): Map<string, T[]> {
  return groupRowsByVisit(rows, identityOf);
}
