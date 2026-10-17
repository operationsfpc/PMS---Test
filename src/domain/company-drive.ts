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
 * Counts distinct recruitment events across drives.
 * A drive with a `companyDriveId` belongs to that event.
 * A legacy standalone drive (null `companyDriveId`) is treated as its own distinct event.
 */
export function countDistinctEvents(
  drives: readonly { readonly driveId: string; readonly companyDriveId?: string | null }[],
): number {
  const eventKeys = new Set<string>();

  for (const drive of drives) {
    eventKeys.add(visitKey(drive.companyDriveId, drive.driveId));
  }

  return eventKeys.size;
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
 * Groups drives by their parent event (a legacy drive becomes its own visit).
 */
export function groupDrivesByEvent<
  T extends { readonly driveId: string; readonly companyDriveId?: string | null },
>(drives: readonly T[]): Map<string, T[]> {
  return groupByVisitKey(drives, (drive) => visitKey(drive.companyDriveId, drive.driveId));
}
