import { describe, expect, it } from "vitest";
import {
  classifyOfferCategory,
  compareOfferCategory,
  DEFAULT_OFFER_CATEGORY_BANDS,
  describeOfferCategoryBands,
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

/**
 * 2026-08-17 (Karthik): the Delivery Head classifies every drive and the
 * classification is immutable afterwards (§3.3) — so the bands have to be on
 * the screen at the moment of the click, not in a policy document.
 *
 * The prose is DERIVED from the bands rather than typed next to them. Bands
 * are Admin-configurable; a hardcoded "up to ₹5 LPA" would start lying the
 * first time anybody retunes them.
 */
describe("describeOfferCategoryBands", () => {
  it("describes each band as a sentence a Delivery Head can act on", () => {
    expect(describeOfferCategoryBands(DEFAULT_OFFER_CATEGORY_BANDS)).toEqual([
      { category: "regular", label: "Regular", range: "up to ₹5 LPA" },
      { category: "dream", label: "Dream", range: "above ₹5 LPA and up to ₹10 LPA" },
      { category: "super_dream", label: "Super Dream", range: "above ₹10 LPA" },
    ]);
  });

  it("follows the bands when they are retuned", () => {
    expect(describeOfferCategoryBands({ regularMaxLpa: 4, dreamMaxLpa: 8 })).toEqual([
      { category: "regular", label: "Regular", range: "up to ₹4 LPA" },
      { category: "dream", label: "Dream", range: "above ₹4 LPA and up to ₹8 LPA" },
      { category: "super_dream", label: "Super Dream", range: "above ₹8 LPA" },
    ]);
  });

  /** Keeps decimals rather than rounding them away: ₹7.5 LPA is a real band edge. */
  it("keeps fractional band edges intact", () => {
    const [regular] = describeOfferCategoryBands({ regularMaxLpa: 4.5, dreamMaxLpa: 9 });
    expect(regular?.range).toBe("up to ₹4.5 LPA");
  });

  /** The same guard classifyOfferCategory applies: a description of nonsense bands is worse than none. */
  it("refuses bands that do not ascend", () => {
    expect(() => describeOfferCategoryBands({ regularMaxLpa: 10, dreamMaxLpa: 5 })).toThrow(
      RangeError,
    );
  });

  /** The boundary the prose claims must be the boundary the classifier enforces. */
  it("agrees with classifyOfferCategory at every boundary", () => {
    const bands = DEFAULT_OFFER_CATEGORY_BANDS;
    expect(classifyOfferCategory(bands.regularMaxLpa, bands)).toBe("regular");
    expect(classifyOfferCategory(bands.regularMaxLpa + 0.01, bands)).toBe("dream");
    expect(classifyOfferCategory(bands.dreamMaxLpa, bands)).toBe("dream");
    expect(classifyOfferCategory(bands.dreamMaxLpa + 0.01, bands)).toBe("super_dream");
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
