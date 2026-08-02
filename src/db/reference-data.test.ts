import { describe, expect, it } from "vitest";
import { createTestDb } from "./harness";

/**
 * Seeded reference data (PIF Q13).
 *
 * Confirmed 2026-08-02: the eligible-degree list is the fixed six from the
 * PIF. They are seeded into the existing `degrees` table rather than hardcoded
 * in the form, so a seventh degree is a row, not a release.
 *
 * "Any degree" is deliberately NOT a row. It is the ABSENCE of a restriction:
 * evaluateEligibility treats an empty eligible-degrees list as "no filter"
 * (`allowed.length > 0`). Storing it as a degree would silently break
 * eligibility, because no student's degree is ever literally "Any degree".
 */
describe("seeded degrees", () => {
  it("contains exactly the five real degrees from PIF Q13", async () => {
    const { sql } = await createTestDb();
    const rows = await sql("select name from degrees order by name");

    expect(rows.map((r) => r.name)).toEqual([
      "B.E / B.Tech (CSE / IT / allied)",
      "B.Sc CS / CT",
      "BCA",
      "M.Sc CS",
      "MCA",
    ]);
  }, 60_000);

  it("does not store 'Any degree' as a degree", async () => {
    const { sql } = await createTestDb();
    const rows = await sql("select name from degrees where name ilike '%any%'");
    expect(rows).toHaveLength(0);
  }, 60_000);
});
