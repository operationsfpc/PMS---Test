import { describe, expect, it } from "vitest";
import { describeOfferPay, offerCountsAsPackage, offerPayProblem } from "./offer-pay";

/**
 * Karthik, 2026-08-27: "go with option 1" — an internship offer records a
 * stipend, not a CTC.
 *
 * P10 let a drive go live on a stipend alone. The OFFER at the end of that
 * drive still demanded an annual CTC, so two live internship offers were
 * recorded at ₹10 LPA and ₹12 LPA against a drive paying ₹15,000 a month.
 * Nobody mistyped: the box would not accept anything else.
 */
describe("describeOfferPay", () => {
  it("says an internship's pay the way an internship is paid", () => {
    expect(describeOfferPay({ driveType: "internship", ctcLpa: null, stipendMonthly: 15000 })).toBe(
      "₹15,000 / month",
    );
  });

  it("says a salaried offer's pay in LPA", () => {
    expect(describeOfferPay({ driveType: "placement", ctcLpa: 8, stipendMonthly: null })).toBe(
      "₹8 LPA",
    );
  });

  /** A convertible internship becomes a salary, so it is quoted as one. */
  it("quotes a convertible internship in LPA", () => {
    expect(
      describeOfferPay({ driveType: "internship_convertible", ctcLpa: 6.5, stipendMonthly: null }),
    ).toBe("₹6.5 LPA");
  });

  it("says so plainly when no pay was recorded, rather than printing ₹0", () => {
    expect(describeOfferPay({ driveType: "placement", ctcLpa: null, stipendMonthly: null })).toBe(
      "Pay not recorded",
    );
    expect(describeOfferPay({ driveType: "internship", ctcLpa: null, stipendMonthly: null })).toBe(
      "Pay not recorded",
    );
  });

  /**
   * Zero is a blank somebody typed a zero into — the same reading
   * `describeStipendRange` already takes.
   */
  it("treats zero as nothing recorded, on either side", () => {
    expect(describeOfferPay({ driveType: "internship", ctcLpa: null, stipendMonthly: 0 })).toBe(
      "Pay not recorded",
    );
    expect(describeOfferPay({ driveType: "placement", ctcLpa: 0, stipendMonthly: null })).toBe(
      "Pay not recorded",
    );
  });
});

/**
 * The screen's guard, mirroring the database constraint added in 0070.
 * Change both or neither.
 */
describe("offerPayProblem", () => {
  it("accepts an internship paid a stipend", () => {
    expect(
      offerPayProblem({ driveType: "internship", ctcLpa: null, stipendMonthly: 15000 }),
    ).toBeNull();
  });

  it("accepts a salaried offer paid a CTC", () => {
    expect(offerPayProblem({ driveType: "placement", ctcLpa: 8, stipendMonthly: null })).toBeNull();
  });

  it("refuses an internship with no stipend, naming what is missing", () => {
    expect(
      offerPayProblem({ driveType: "internship", ctcLpa: null, stipendMonthly: null }),
    ).toMatch(/stipend/i);
  });

  it("refuses a salaried offer with no CTC", () => {
    expect(offerPayProblem({ driveType: "placement", ctcLpa: null, stipendMonthly: null })).toMatch(
      /CTC/,
    );
  });

  /**
   * One fact, one spelling. Recording both would leave the reader to decide
   * which is true, and the two screens quoting them would disagree.
   */
  it("refuses an internship that also carries a CTC", () => {
    expect(offerPayProblem({ driveType: "internship", ctcLpa: 10, stipendMonthly: 15000 })).toMatch(
      /internship/i,
    );
  });

  it("refuses a salaried offer that carries a stipend", () => {
    expect(offerPayProblem({ driveType: "placement", ctcLpa: 8, stipendMonthly: 15000 })).toMatch(
      /stipend/i,
    );
  });

  it("refuses a negative or nonsensical figure on either side", () => {
    expect(
      offerPayProblem({ driveType: "placement", ctcLpa: -1, stipendMonthly: null }),
    ).not.toBeNull();
    expect(
      offerPayProblem({ driveType: "internship", ctcLpa: null, stipendMonthly: -500 }),
    ).not.toBeNull();
  });
});

/**
 * The reporting rule, said once. `placementOffers` has excluded internships
 * from the placement record set since the beginning — this states the same
 * rule for anything that quotes an offer's money directly.
 */
describe("offerCountsAsPackage", () => {
  it("counts a placement and a convertible internship", () => {
    expect(offerCountsAsPackage("placement")).toBe(true);
    expect(offerCountsAsPackage("internship_convertible")).toBe(true);
  });

  it("does not count a plain internship — a stipend is not a package", () => {
    expect(offerCountsAsPackage("internship")).toBe(false);
  });
});
