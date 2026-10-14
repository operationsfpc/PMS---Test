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
    if (drive.companyDriveId) {
      eventKeys.add(`event:${drive.companyDriveId}`);
    } else {
      eventKeys.add(`standalone:${drive.driveId}`);
    }
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

/**
 * Groups drives by their parent event ID (or by their own drive ID if standalone).
 */
export function groupDrivesByEvent<
  T extends { readonly driveId: string; readonly companyDriveId?: string | null },
>(drives: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const drive of drives) {
    const key = drive.companyDriveId || drive.driveId;
    const existing = groups.get(key);
    if (existing) {
      existing.push(drive);
    } else {
      groups.set(key, [drive]);
    }
  }

  return groups;
}
