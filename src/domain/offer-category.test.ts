import { describe, expect, it } from "vitest";
import {
  classifyOfferCategory,
  compareOfferCategory,
  DEFAULT_OFFER_CATEGORY_BANDS,
  offerCategoryRank,
} from "./offer-category";

/**
 * R1 — classifyOfferCategory
 * PRD §10. Bands are Admin-configurable reference guidance; the Delivery Head
 * makes the final call at PIF approval (decision Q1). This function only suggests.
 */
describe("classifyOfferCategory", () => {
  const bands = DEFAULT_OFFER_CATEGORY_BANDS;

  it("classifies a CTC below the regular ceiling as regular", () => {
    expect(classifyOfferCategory(3.5, bands)).toBe("regular");
  });

  describe("boundaries are exact and inclusive of the lower band", () => {
    it("treats exactly ₹5.00 LPA as regular", () => {
      expect(classifyOfferCategory(5, bands)).toBe("regular");
    });

    it("treats ₹5.01 LPA as dream", () => {
      expect(classifyOfferCategory(5.01, bands)).toBe("dream");
    });

    it("treats exactly ₹10.00 LPA as dream", () => {
      expect(classifyOfferCategory(10, bands)).toBe("dream");
    });

    it("treats ₹10.01 LPA as super_dream", () => {
      expect(classifyOfferCategory(10.01, bands)).toBe("super_dream");
    });
  });

  it("classifies a high CTC as super_dream", () => {
    expect(classifyOfferCategory(42, bands)).toBe("super_dream");
  });

  it("honours Admin-configured bands rather than the defaults", () => {
    const custom = { regularMaxLpa: 8, dreamMaxLpa: 20 };
    expect(classifyOfferCategory(8, custom)).toBe("regular");
    expect(classifyOfferCategory(12, custom)).toBe("dream");
    expect(classifyOfferCategory(20.5, custom)).toBe("super_dream");
  });

  describe("rejects unusable input rather than guessing", () => {
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("throws for a CTC of %s", (ctc) => {
      expect(() => classifyOfferCategory(ctc, bands)).toThrow(/ctc/i);
    });

    it("throws when the configured bands are not ascending", () => {
      expect(() => classifyOfferCategory(6, { regularMaxLpa: 10, dreamMaxLpa: 5 })).toThrow(
        /band/i,
      );
    });
  });
});

/**
 * The category ladder (PRD §12). Ordering is the backbone of drive visibility:
 * a placed student only ever sees NEW drives ranked strictly higher.
 */
describe("offerCategoryRank", () => {
  it("ranks regular below dream below super_dream", () => {
    expect(offerCategoryRank("regular")).toBeLessThan(offerCategoryRank("dream"));
    expect(offerCategoryRank("dream")).toBeLessThan(offerCategoryRank("super_dream"));
  });
});

describe("compareOfferCategory", () => {
  it("returns a negative number when the first category is lower", () => {
    expect(compareOfferCategory("regular", "super_dream")).toBeLessThan(0);
  });

  it("returns zero for equal categories", () => {
    expect(compareOfferCategory("dream", "dream")).toBe(0);
  });

  it("returns a positive number when the first category is higher", () => {
    expect(compareOfferCategory("super_dream", "dream")).toBeGreaterThan(0);
  });
});
