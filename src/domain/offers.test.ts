import { describe, expect, it } from "vitest";
import {
  highestOfferCategory,
  isInternshipCapConsumed,
  type Offer,
  resolveDisplayedPlacement,
  resolvePlacementRecord,
} from "./offers";

const offer = (over: Partial<Offer> & Pick<Offer, "id">): Offer => ({
  driveId: `drive-${over.id}`,
  driveType: "placement",
  offerCategory: "regular",
  ctcLpa: 4,
  declaredAt: new Date("2026-01-01T00:00:00Z"),
  source: "on_campus",
  ...over,
});

/** R3 — the ladder position a student currently occupies. PRD §12. */
describe("highestOfferCategory", () => {
  it("returns null for a student with no offers", () => {
    expect(highestOfferCategory([])).toBeNull();
  });

  it("returns the single offer's category", () => {
    expect(highestOfferCategory([offer({ id: "a", offerCategory: "dream" })])).toBe("dream");
  });

  it("returns the highest category across several offers", () => {
    expect(
      highestOfferCategory([
        offer({ id: "a", offerCategory: "regular" }),
        offer({ id: "b", offerCategory: "super_dream" }),
        offer({ id: "c", offerCategory: "dream" }),
      ]),
    ).toBe("super_dream");
  });

  it("counts internship-convertible offers — they sit on the ladder", () => {
    expect(
      highestOfferCategory([
        offer({ id: "a", driveType: "internship_convertible", offerCategory: "dream" }),
      ]),
    ).toBe("dream");
  });

  it("ignores plain internships — they are a parallel track", () => {
    expect(
      highestOfferCategory([offer({ id: "a", driveType: "internship", offerCategory: null })]),
    ).toBeNull();
  });

  it("counts an approved self-placed offer with a category (D5, 2026-08-12 — reverses PRD §16.2's ladder half)", () => {
    expect(
      highestOfferCategory([
        offer({ id: "a", source: "self_placed", offerCategory: "super_dream" }),
      ]),
    ).toBe("super_dream");
  });

  it("a self-placed dream offer blocks regular exactly as an on-campus one would", () => {
    expect(
      highestOfferCategory([offer({ id: "a", source: "self_placed", offerCategory: "dream" })]),
    ).toBe("dream");
  });

  it("ignores a self-placed internship on the ladder — internships are never ladder offers", () => {
    expect(
      highestOfferCategory([
        offer({ id: "a", source: "self_placed", driveType: "internship", offerCategory: null }),
      ]),
    ).toBeNull();
  });

  it("ignores an on-campus offer that somehow carries no category", () => {
    expect(highestOfferCategory([offer({ id: "a", offerCategory: null })])).toBeNull();
  });
});

/** R4 — the one-internship cap. PRD §11. */
describe("isInternshipCapConsumed", () => {
  it("is not consumed with no offers", () => {
    expect(isInternshipCapConsumed([])).toBe(false);
  });

  it("is consumed by a plain internship", () => {
    expect(isInternshipCapConsumed([offer({ id: "a", driveType: "internship" })])).toBe(true);
  });

  it("is consumed by an internship-convertible offer (it counts twice over)", () => {
    expect(isInternshipCapConsumed([offer({ id: "a", driveType: "internship_convertible" })])).toBe(
      true,
    );
  });

  it("is not consumed by a pure placement", () => {
    expect(isInternshipCapConsumed([offer({ id: "a", driveType: "placement" })])).toBe(false);
  });

  it("IS consumed by a self-placed internship (D5 correction, 2026-08-12)", () => {
    // "Self internships will lead to exclusion from internships similar to
    // placements" — confirmed at spec approval.
    expect(
      isInternshipCapConsumed([offer({ id: "a", driveType: "internship", source: "self_placed" })]),
    ).toBe(true);
  });

  it("is not consumed by a self-placed job offer", () => {
    expect(
      isInternshipCapConsumed([offer({ id: "a", driveType: "placement", source: "self_placed" })]),
    ).toBe(false);
  });
});

/** R9 — which offer is THE placement record for statistics. PRD §12. */
describe("resolvePlacementRecord", () => {
  it("returns null when there are no on-campus offers", () => {
    expect(resolvePlacementRecord([])).toBeNull();
  });

  it("picks the highest CTC by default", () => {
    const record = resolvePlacementRecord([
      offer({ id: "a", ctcLpa: 6 }),
      offer({ id: "b", ctcLpa: 14 }),
      offer({ id: "c", ctcLpa: 9 }),
    ]);
    expect(record?.id).toBe("b");
  });

  it("breaks ties on identical CTC by earliest declared (decision Q3)", () => {
    const record = resolvePlacementRecord([
      offer({ id: "later", ctcLpa: 10, declaredAt: new Date("2026-03-01T00:00:00Z") }),
      offer({ id: "earlier", ctcLpa: 10, declaredAt: new Date("2026-02-01T00:00:00Z") }),
    ]);
    expect(record?.id).toBe("earlier");
  });

  it("includes internship-convertible offers in the placement record set", () => {
    const record = resolvePlacementRecord([
      offer({ id: "a", ctcLpa: 5 }),
      offer({ id: "b", driveType: "internship_convertible", ctcLpa: 12 }),
    ]);
    expect(record?.id).toBe("b");
  });

  it("excludes plain internships from the placement record", () => {
    const record = resolvePlacementRecord([
      offer({ id: "a", ctcLpa: 5 }),
      offer({ id: "b", driveType: "internship", ctcLpa: 99 }),
    ]);
    expect(record?.id).toBe("a");
  });

  it("STILL excludes self-placed offers — the reporting line stays separate (D5 reverses only the ladder)", () => {
    const record = resolvePlacementRecord([
      offer({ id: "a", ctcLpa: 5 }),
      offer({ id: "b", source: "self_placed", ctcLpa: 40 }),
    ]);
    expect(record?.id).toBe("a");
  });

  describe("Central CPC manual override", () => {
    it("honours an override even when it is not the highest CTC", () => {
      const record = resolvePlacementRecord(
        [offer({ id: "a", ctcLpa: 5 }), offer({ id: "b", ctcLpa: 20 })],
        "a",
      );
      expect(record?.id).toBe("a");
    });

    it("rejects an override pointing at an offer outside the placement set", () => {
      expect(() =>
        resolvePlacementRecord(
          [offer({ id: "a", ctcLpa: 5 }), offer({ id: "intern", driveType: "internship" })],
          "intern",
        ),
      ).toThrow(/override/i);
    });

    it("rejects an override pointing at an unknown offer", () => {
      expect(() => resolvePlacementRecord([offer({ id: "a" })], "ghost")).toThrow(/override/i);
    });
  });
});

/**
 * C1 (UAT 2026-08-19): "Thanush has been placed and his off-campus offer was
 * approved … but he still appears under Not Placed in the All Students view."
 *
 * The DISPLAY of a student's placement is a different question from R9's
 * reporting record. A coordinator looking at the directory asks "does this
 * student have a job?", and a self-placed student does. R9's statistics keep
 * excluding self-placed — that separation is the PRD's and stands.
 */
describe("resolveDisplayedPlacement", () => {
  it("returns null for a student with no offers", () => {
    expect(resolveDisplayedPlacement([])).toBeNull();
  });

  it("shows a self-placed student as placed — the C1 bug", () => {
    const shown = resolveDisplayedPlacement([
      offer({ id: "self", source: "self_placed", ctcLpa: 3.5 }),
    ]);
    expect(shown?.id).toBe("self");
  });

  it("prefers the on-campus record over any self-placed offer, even a richer one", () => {
    const shown = resolveDisplayedPlacement([
      offer({ id: "campus", ctcLpa: 4 }),
      offer({ id: "self", source: "self_placed", ctcLpa: 40 }),
    ]);
    expect(shown?.id).toBe("campus");
  });

  it("picks the best self-placed offer by the same highest-CTC rule", () => {
    const shown = resolveDisplayedPlacement([
      offer({ id: "low", source: "self_placed", ctcLpa: 3 }),
      offer({ id: "high", source: "self_placed", ctcLpa: 6 }),
    ]);
    expect(shown?.id).toBe("high");
  });

  it("breaks a self-placed CTC tie to the earliest declared", () => {
    const shown = resolveDisplayedPlacement([
      offer({ id: "later", source: "self_placed", ctcLpa: 5, declaredAt: new Date("2026-02-01") }),
      offer({
        id: "earlier",
        source: "self_placed",
        ctcLpa: 5,
        declaredAt: new Date("2026-01-01"),
      }),
    ]);
    expect(shown?.id).toBe("earlier");
  });

  it("a self-placed plain internship is not a placement", () => {
    expect(
      resolveDisplayedPlacement([
        offer({ id: "intern", source: "self_placed", driveType: "internship" }),
      ]),
    ).toBeNull();
  });
});
