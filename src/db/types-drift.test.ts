import { OFFER_CATEGORIES } from "@domain/offer-category";
import {
  APP_ROLES,
  ARREAR_POLICIES,
  ATTENDANCE_STATUSES,
  DRIVE_MODES,
  DRIVE_STATUSES,
  DRIVE_TYPES,
  OFFER_SOURCES,
  PARTICIPATION_STATUSES,
  ROLE_CATEGORIES,
  ROUND_RESULTS,
  SRF_STATUSES,
  VERIFICATION_STATUSES,
} from "@domain/types";
import { describe, expect, it } from "vitest";
import { createTestDb } from "./harness";

/**
 * Drift guard.
 *
 * The domain enums in TypeScript and the Postgres enums must stay identical.
 * Changing one without the other corrupts data silently, so the database is
 * introspected and compared against the domain constants directly.
 */
describe("Postgres enums match the domain vocabularies", () => {
  const cases: Array<[string, readonly string[]]> = [
    ["role_category", ROLE_CATEGORIES],
    ["drive_type", DRIVE_TYPES],
    ["drive_mode", DRIVE_MODES],
    ["arrear_policy", ARREAR_POLICIES],
    ["offer_category", OFFER_CATEGORIES],
    ["srf_status", SRF_STATUSES],
    ["participation_status", PARTICIPATION_STATUSES],
    ["drive_status", DRIVE_STATUSES],
    ["round_result", ROUND_RESULTS],
    ["attendance_status", ATTENDANCE_STATUSES],
    ["offer_source", OFFER_SOURCES],
    ["app_role", APP_ROLES],
    // Raw strings in TypeScript until certificates (0038) made it a decision
    // the UI has to render.
    ["verification_status", VERIFICATION_STATUSES],
  ];

  it.each(cases)(
    "%s",
    async (pgType, tsValues) => {
      const { sql } = await createTestDb();
      const rows = await sql(
        `select e.enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = $1 order by e.enumsortorder`,
        [pgType],
      );
      expect(rows.map((r) => r.enumlabel)).toEqual([...tsValues]);
    },
    60_000,
  );
});
