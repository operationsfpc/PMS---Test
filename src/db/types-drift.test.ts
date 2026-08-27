import { SCHOOL_BOARDS } from "@domain/boards";
import { JOINING_TIMELINES } from "@domain/joining";
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
    // Membership must match; the ORDER deliberately does not — see the
    // separate case below.
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
    // 2026-08-18. The one enum whose LABELS differ from its values (ICSE at
    // class 10, ISC at class 12), which is exactly why the values must not
    // drift: `boardLabel` is the only thing that knows the difference.
    ["school_board", SCHOOL_BOARDS],
    // 2026-08-18. A real enum because nothing existed before it — unlike the
    // shift, whose column already held free text on four live drives and is
    // therefore guarded by a NOT VALID check constraint instead
    // (`pif-jd-shift-joining.test.ts`).
    ["joining_timeline", JOINING_TIMELINES],
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
      const labels = rows.map((r) => r.enumlabel);
      if (pgType === "offer_category") {
        // 2026-08-27 (PB1): 'internship' is declared FIRST in Postgres so that
        // a stray `order by offer_category` treats it as the lowest value
        // rather than above 'super_dream'. It is listed last in TypeScript,
        // where order is only a dropdown's order and nothing compares by it.
        // What must not drift is WHICH values exist.
        expect([...labels].sort()).toEqual([...tsValues].sort());
        return;
      }
      expect(labels).toEqual([...tsValues]);
    },
    60_000,
  );

  /**
   * The ordering itself, stated once so it cannot be "tidied" back.
   * `src/db/internship-category-and-stipend.test.ts` proves the same thing
   * from the migration's side.
   */
  it("declares the un-ranked internship category below every rung", async () => {
    const { sql } = await createTestDb();
    const rows = await sql(
      `select e.enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'offer_category' order by e.enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toEqual(["internship", "regular", "dream", "super_dream"]);
  }, 60_000);
});
