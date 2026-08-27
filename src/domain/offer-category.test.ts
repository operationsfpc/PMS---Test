import { describe, expect, it } from "vitest";
import {
  asOfferCategory,
  classifyOfferCategory,
  compareOfferCategory,
  DEFAULT_OFFER_CATEGORY_BANDS,
  describeOfferCategoryBands,
  LADDER_CATEGORIES,
  OFFER_CATEGORIES,
  offerCategoriesFor,
  offerCategoryAllowedFor,
  offerCategoryLabel,
  offerCategoryLabelOf,
  offerCategoryRank,
  offerCategoryRestatesType,
  requiredOfferCategoryFor,
  suggestOfferCategory,
} from "./offer-category";
import { DRIVE_TYPES } from "./types";

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

  /**
   * SPEC CHANGE 2026-08-17 (Karthik, verbatim): "5.00 is dream and 10.00 is
   * super dream."
   *
   * The boundary INVERTED. It used to belong to the band below it — ₹5.00 was
   * regular — which is what put a ₹5 LPA offer in the "Regular" row of the
   * campus overview. A band edge now belongs to the band ABOVE it, so the
   * fields are `dreamMinLpa` and `superDreamMinLpa`: a category is named by
   * where it STARTS, and there is no way left to read the number as a ceiling.
   */
  describe("a band edge belongs to the band above it", () => {
    it("treats ₹4.99 LPA as regular", () => {
      expect(classifyOfferCategory(4.99, bands)).toBe("regular");
    });

    it("treats exactly ₹5.00 LPA as dream", () => {
      expect(classifyOfferCategory(5, bands)).toBe("dream");
    });

    it("treats ₹9.99 LPA as dream", () => {
      expect(classifyOfferCategory(9.99, bands)).toBe("dream");
    });

    it("treats exactly ₹10.00 LPA as super_dream", () => {
      expect(classifyOfferCategory(10, bands)).toBe("super_dream");
    });
  });

  it("classifies a high CTC as super_dream", () => {
    expect(classifyOfferCategory(42, bands)).toBe("super_dream");
  });

  it("honours Admin-configured bands rather than the defaults", () => {
    const custom = { dreamMinLpa: 8, superDreamMinLpa: 20 };
    expect(classifyOfferCategory(7.99, custom)).toBe("regular");
    expect(classifyOfferCategory(8, custom)).toBe("dream");
    expect(classifyOfferCategory(20, custom)).toBe("super_dream");
  });

  describe("rejects unusable input rather than guessing", () => {
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("throws for a CTC of %s", (ctc) => {
      expect(() => classifyOfferCategory(ctc, bands)).toThrow(/ctc/i);
    });

    it("throws when the configured bands are not ascending", () => {
      expect(() => classifyOfferCategory(6, { dreamMinLpa: 10, superDreamMinLpa: 5 })).toThrow(
        /band/i,
      );
    });
  });
});

/**
 * The category ladder (PRD §12). Ordering is the backbone of drive visibility:
 * a placed student only ever sees NEW drives ranked strictly higher.
 */
/**
 * UAT 2026-08-27 (live): the Delivery Head's PIF approval queue died with
 * "Could not load the queue". No request had failed — one PIF in the queue
 * was a **cap-only internship** (0056), which legitimately carries no CTC,
 * and asking `classifyOfferCategory` to classify nothing threw a RangeError
 * that took the whole screen down with it.
 *
 * Classifying nothing is not a programming error, it is an ABSENCE, and the
 * answer to it is "no suggestion" — the Delivery Head chooses. So the strict
 * function stays strict, and screens ask this one.
 */
describe("suggestOfferCategory", () => {
  it("suggests nothing when there is no CTC to go on", () => {
    expect(suggestOfferCategory(null)).toBeNull();
    expect(suggestOfferCategory(undefined)).toBeNull();
  });

  it("suggests nothing for a CTC that cannot be classified", () => {
    expect(suggestOfferCategory(0)).toBeNull();
    expect(suggestOfferCategory(-1)).toBeNull();
    expect(suggestOfferCategory(Number.NaN)).toBeNull();
  });

  it("agrees with the strict rule wherever the strict rule has an answer", () => {
    expect(suggestOfferCategory(4.99)).toBe("regular");
    expect(suggestOfferCategory(5)).toBe("dream");
    expect(suggestOfferCategory(12)).toBe("super_dream");
  });

  it("honours retuned bands", () => {
    expect(suggestOfferCategory(6, { dreamMinLpa: 7, superDreamMinLpa: 14 })).toBe("regular");
  });
});

/**
 * Karthik, 2026-08-27: "when he approves, he has three categories only for
 * placement (Regular, dream and super dream). add one more there, as
 * Internship."
 *
 * The three are RUNGS on a ladder (`offerCategoryRank`) that decides which
 * drives a placed student may still see (R5) and what counts as their
 * placement (R9). Internship is not a rung — a plain internship has never
 * been on that ladder (PRD §11). So it is a member of the enum and NOT a
 * member of the ladder, and asking for its rank is a bug, not a number.
 */
describe("the ladder and the categories are not the same list", () => {
  it("carries Internship as a storable category", () => {
    expect(OFFER_CATEGORIES).toContain("internship");
  });

  it("keeps Internship off the ladder", () => {
    expect(LADDER_CATEGORIES).toEqual(["regular", "dream", "super_dream"]);
    expect(LADDER_CATEGORIES).not.toContain("internship");
  });

  it("refuses to rank Internship rather than ranking it lowest or highest", () => {
    expect(() => offerCategoryRank("internship")).toThrow(/ladder/i);
  });

  it("never suggests Internship from a CTC — a band is not a drive type", () => {
    expect(classifyOfferCategory(0.5)).not.toBe("internship");
    expect(classifyOfferCategory(50)).not.toBe("internship");
    expect(suggestOfferCategory(null)).toBeNull();
  });

  it("labels it", () => {
    expect(offerCategoryLabel("internship")).toBe("Internship");
  });
});

/**
 * Answer 3 (2026-08-27): "only for internship". The Delivery Head is never
 * offered a choice the database would refuse — an internship drive can carry
 * only the internship category, and no other drive type can carry it at all.
 */
describe("offerCategoriesFor", () => {
  it("offers an internship drive exactly one category", () => {
    expect(offerCategoriesFor("internship")).toEqual(["internship"]);
  });

  it("offers the three rungs to a drive that sits on the ladder", () => {
    expect(offerCategoriesFor("placement")).toEqual(LADDER_CATEGORIES);
    expect(offerCategoriesFor("internship_convertible")).toEqual(LADDER_CATEGORIES);
  });

  it("offers the rungs when the type is not known yet — never the internship one", () => {
    expect(offerCategoriesFor(null)).toEqual(LADDER_CATEGORIES);
  });
});

describe("requiredOfferCategoryFor", () => {
  it("an internship drive has no decision to make — its category is the type", () => {
    expect(requiredOfferCategoryFor("internship")).toBe("internship");
  });

  it("every other type is the Delivery Head's judgement, not a derivation", () => {
    expect(requiredOfferCategoryFor("placement")).toBeNull();
    expect(requiredOfferCategoryFor("internship_convertible")).toBeNull();
    expect(requiredOfferCategoryFor(null)).toBeNull();
  });
});

describe("offerCategoryAllowedFor", () => {
  it("mirrors the database constraint, so the screen never proposes a refusal", () => {
    expect(offerCategoryAllowedFor("internship", "internship")).toBe(true);
    expect(offerCategoryAllowedFor("internship", "dream")).toBe(false);
    expect(offerCategoryAllowedFor("placement", "internship")).toBe(false);
    expect(offerCategoryAllowedFor("placement", "dream")).toBe(true);
    expect(offerCategoryAllowedFor("internship_convertible", "super_dream")).toBe(true);
    expect(offerCategoryAllowedFor("internship_convertible", "internship")).toBe(false);
  });

  it("a drive with no type yet may not be given the internship category", () => {
    expect(offerCategoryAllowedFor(null, "internship")).toBe(false);
    expect(offerCategoryAllowedFor(null, "regular")).toBe(true);
  });
});

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
      { category: "regular", label: "Regular", range: "below ₹5 LPA" },
      { category: "dream", label: "Dream", range: "₹5 LPA and above, below ₹10 LPA" },
      { category: "super_dream", label: "Super Dream", range: "₹10 LPA and above" },
    ]);
  });

  it("follows the bands when they are retuned", () => {
    expect(describeOfferCategoryBands({ dreamMinLpa: 4, superDreamMinLpa: 8 })).toEqual([
      { category: "regular", label: "Regular", range: "below ₹4 LPA" },
      { category: "dream", label: "Dream", range: "₹4 LPA and above, below ₹8 LPA" },
      { category: "super_dream", label: "Super Dream", range: "₹8 LPA and above" },
    ]);
  });

  /** Keeps decimals rather than rounding them away: ₹7.5 LPA is a real band edge. */
  it("keeps fractional band edges intact", () => {
    const [regular] = describeOfferCategoryBands({ dreamMinLpa: 4.5, superDreamMinLpa: 9 });
    expect(regular?.range).toBe("below ₹4.5 LPA");
  });

  /** The same guard classifyOfferCategory applies: a description of nonsense bands is worse than none. */
  it("refuses bands that do not ascend", () => {
    expect(() => describeOfferCategoryBands({ dreamMinLpa: 10, superDreamMinLpa: 5 })).toThrow(
      RangeError,
    );
  });

  /**
   * The boundary the prose claims must be the boundary the classifier
   * enforces. This is the test that would have caught the ₹5 LPA offer sitting
   * in the "Regular" row while the banner said otherwise.
   */
  it("agrees with classifyOfferCategory at every boundary", () => {
    const bands = DEFAULT_OFFER_CATEGORY_BANDS;
    expect(classifyOfferCategory(bands.dreamMinLpa - 0.01, bands)).toBe("regular");
    expect(classifyOfferCategory(bands.dreamMinLpa, bands)).toBe("dream");
    expect(classifyOfferCategory(bands.superDreamMinLpa - 0.01, bands)).toBe("dream");
    expect(classifyOfferCategory(bands.superDreamMinLpa, bands)).toBe("super_dream");
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

/**
 * UAT 2026-08-27 (`docs/inbox/WhatsApp Image 2026-08-27 at 17.40.11.jpeg`):
 * the drive record page showed "Internship" twice — once as the offer
 * category, once as the drive type. PB3 answered this for the student card
 * with a literal `!== "internship"` written into the JSX; every other screen
 * that shows both facts kept the duplicate. The rule belongs here.
 */
describe("offerCategoryRestatesType", () => {
  it("is true when the category only repeats what the type tag already said", () => {
    expect(offerCategoryRestatesType("internship", "internship")).toBe(true);
  });

  it("is false for a rung, which the type never states", () => {
    expect(offerCategoryRestatesType("placement", "regular")).toBe(false);
    expect(offerCategoryRestatesType("placement", "dream")).toBe(false);
    expect(offerCategoryRestatesType("internship_convertible", "super_dream")).toBe(false);
  });

  it("is false when there is no category to repeat", () => {
    expect(offerCategoryRestatesType("internship", null)).toBe(false);
    expect(offerCategoryRestatesType("placement", null)).toBe(false);
  });

  /**
   * A drive with no declared type has said nothing, so the category is the
   * only thing the reader has. Suppressing it there would hide the fact
   * entirely rather than de-duplicate it.
   */
  it("is false when the drive never declared a type", () => {
    expect(offerCategoryRestatesType(null, "internship")).toBe(false);
  });

  /** One rule, two callers: it must agree with the pairing it is derived from. */
  it("agrees with requiredOfferCategoryFor for every type and category", () => {
    for (const type of [...DRIVE_TYPES, null]) {
      for (const category of OFFER_CATEGORIES) {
        expect(offerCategoryRestatesType(type, category)).toBe(
          requiredOfferCategoryFor(type) === category,
        );
      }
    }
  });
});

/**
 * The counterpart of `asDriveType`. Three screens hold `offer_category` as a
 * bare string and spelled it with `replaceAll("_", " ")` — "super dream",
 * "internship" — while every other screen said "Super Dream". Two spellings of
 * one fact is two facts to the person reading them.
 */
describe("asOfferCategory", () => {
  it("recognises every category", () => {
    for (const category of OFFER_CATEGORIES) {
      expect(asOfferCategory(category)).toBe(category);
    }
  });

  it("answers null for anything that is not a category", () => {
    expect(asOfferCategory("")).toBeNull();
    expect(asOfferCategory("super dream")).toBeNull();
    expect(asOfferCategory("Dream")).toBeNull();
    expect(asOfferCategory(null)).toBeNull();
    expect(asOfferCategory(undefined)).toBeNull();
  });
});

/**
 * The label, for a caller holding a string. Unknown values are handed back
 * untouched rather than swallowed: a category nobody recognises is a data
 * problem, and printing nothing would hide it.
 */
describe("offerCategoryLabelOf", () => {
  it("gives the domain's spelling for every category", () => {
    expect(offerCategoryLabelOf("super_dream")).toBe("Super Dream");
    expect(offerCategoryLabelOf("internship")).toBe("Internship");
    expect(offerCategoryLabelOf("regular")).toBe("Regular");
  });

  it("hands back an unrecognised value rather than hiding it", () => {
    expect(offerCategoryLabelOf("mystery_band")).toBe("mystery_band");
  });

  it("agrees with offerCategoryLabel for every category", () => {
    for (const category of OFFER_CATEGORIES) {
      expect(offerCategoryLabelOf(category)).toBe(offerCategoryLabel(category));
    }
  });
});
