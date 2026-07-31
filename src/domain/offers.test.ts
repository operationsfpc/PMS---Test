import { describe, expect, it } from "vitest";
import {
  highestOfferCategory,
  isInternshipCapConsumed,
  type Offer,
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

  it("ignores self-placed offers entirely (PRD §16.2)", () => {
    expect(
      highestOfferCategory([
        offer({ id: "a", source: "self_placed", offerCategory: "super_dream" }),
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

  it("is not consumed by a self-placed internship (PRD §16.2)", () => {
    // Self-placed offers must not affect on-campus eligibility in any way.
    expect(
      isInternshipCapConsumed([offer({ id: "a", driveType: "internship", source: "self_placed" })]),
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

  it("excludes self-placed offers — they are a separate statistic line", () => {
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
