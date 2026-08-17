import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

/**
 * SPEC CHANGE 2026-08-17 (Karthik, verbatim): "5.00 is dream and 10.00 is
 * super dream."
 *
 * A band edge used to belong to the band BELOW it, which is how a ₹5 LPA offer
 * came to sit in the "Regular" row of the campus overview. The edge now
 * belongs to the band above.
 *
 * The bands exist in three places and all three had the old rule written into
 * them: `src/domain/offer-category.ts`, the `settings` row seeded by 0002, and
 * the backfill in 0041. Changing the domain alone would have left the database
 * disagreeing with the screen, which is the failure mode this file exists to
 * catch.
 */
describe("offer category bands, after the 2026-08-17 boundary change", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });

  /**
   * Nothing in the app reads this row today — the domain carries the defaults.
   * That is exactly why it is dangerous: it is the row an Admin screen would
   * one day load, and it would have loaded the superseded rule.
   */
  it("stores the bands as the floors they now are", async () => {
    const [row] = await t.sql(`select value from settings where key = 'offer_category_bands'`);
    expect(row?.value).toEqual({ dreamMinLpa: 5, superDreamMinLpa: 10 });
  });

  it("keeps no trace of the superseded ceiling-shaped keys", async () => {
    const [row] = await t.sql(
      `select value::text as text from settings where key = 'offer_category_bands'`,
    );
    expect(row?.text).not.toMatch(/regularMaxLpa|dreamMaxLpa/);
  });

  /**
   * The ladder decides which drives a student holding an offer may still apply
   * to (R1/D5). An offer banded too low understates what they hold and lets
   * them apply to drives they should already be blocked from — so a stale
   * classification is not cosmetic, it is an eligibility bug.
   */
  describe("the classification helper the database applies", () => {
    it.each([
      [4.99, "regular"],
      [5, "dream"],
      [9.99, "dream"],
      [10, "super_dream"],
      [42, "super_dream"],
    ])("bands ₹%s LPA as %s", async (ctc, expected) => {
      const [row] = await t.sql(`select classify_offer_category($1::numeric) as category`, [ctc]);
      expect(row?.category).toBe(expected);
    });
  });

  /** The database and `src/domain/offer-category.ts` must not be able to drift. */
  it("agrees with the domain rule at both edges", async () => {
    const { classifyOfferCategory, DEFAULT_OFFER_CATEGORY_BANDS } = await import(
      "../domain/offer-category"
    );

    for (const ctc of [1, 4.99, 5, 5.01, 9.99, 10, 10.01, 30]) {
      const [row] = await t.sql(`select classify_offer_category($1::numeric) as category`, [ctc]);
      expect(row?.category).toBe(classifyOfferCategory(ctc, DEFAULT_OFFER_CATEGORY_BANDS));
    }
  });
});
