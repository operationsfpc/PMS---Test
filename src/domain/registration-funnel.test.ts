import { describe, expect, it } from "vitest";
import { type FunnelStudent, registrationFunnel } from "./registration-funnel";

/**
 * "Total registered students, through to number of students placed."
 *
 * The funnel is the question every stakeholder actually asks: of everyone on
 * the roster, how many finished registering, how many were verified, how many
 * applied to anything, how many are placed. Each stage answers "where are we
 * losing people?", which no single count on its own can.
 *
 * The stages must be MONOTONIC — a later stage can never exceed an earlier
 * one — because a funnel that widens is not a funnel, it is a bug that will be
 * read as good news.
 */
const student = (over: Partial<FunnelStudent> = {}): FunnelStudent => ({
  srfStatus: "invited",
  participationStatus: "active",
  hasApplied: false,
  hasOnCampusPlacement: false,
  ...over,
});

describe("registrationFunnel", () => {
  it("counts everyone on the roster at the top, whatever state they are in", () => {
    const funnel = registrationFunnel([
      student(),
      student({ srfStatus: "srf_approved" }),
      student({ participationStatus: "opted_out" }),
    ]);

    expect(funnel[0]?.key).toBe("on_roster");
    expect(funnel[0]?.count).toBe(3);
  });

  it("counts a submitted form as registered", () => {
    const funnel = registrationFunnel([
      student({ srfStatus: "srf_submitted" }),
      student({ srfStatus: "registered" }),
      student({ srfStatus: "invited" }),
    ]);

    expect(funnel.find((s) => s.key === "submitted")?.count).toBe(1);
  });

  /** An approved form was necessarily submitted; it must not fall out of the stage above. */
  it("counts an approved form as submitted as well as verified", () => {
    const funnel = registrationFunnel([student({ srfStatus: "srf_approved" })]);

    expect(funnel.find((s) => s.key === "submitted")?.count).toBe(1);
    expect(funnel.find((s) => s.key === "verified")?.count).toBe(1);
  });

  /** A rejected form was also submitted — it just did not pass. */
  it("counts a rejected form as submitted but not verified", () => {
    const funnel = registrationFunnel([student({ srfStatus: "srf_rejected" })]);

    expect(funnel.find((s) => s.key === "submitted")?.count).toBe(1);
    expect(funnel.find((s) => s.key === "verified")?.count).toBe(0);
  });

  /**
   * F5 (UAT 2026-08-06): "4 should not be in that flow. Applied to a drive is
   * drive specific data. The other 4 are not drive specific."
   *
   * Applying is measured against ONE drive's audience, not against the roster,
   * so a cohort-wide percentage of it is a number with no denominator anyone
   * can name. It moved to `driveFunnel`.
   */
  it("does not carry the drive-specific applied stage", () => {
    const funnel = registrationFunnel([
      student({ srfStatus: "srf_approved", hasApplied: true }),
      student({ srfStatus: "srf_approved" }),
    ]);

    expect(funnel.find((s) => s.key === "applied")).toBeUndefined();
  });

  /** Applying still proves the stages above it were reached. */
  it("counts an applicant as submitted and verified even if their status lags", () => {
    const funnel = registrationFunnel([student({ srfStatus: "invited", hasApplied: true })]);

    expect(funnel.find((s) => s.key === "submitted")?.count).toBe(1);
    expect(funnel.find((s) => s.key === "verified")?.count).toBe(1);
  });

  it("counts who ended up placed on campus", () => {
    const funnel = registrationFunnel([
      student({ srfStatus: "srf_approved", hasApplied: true, hasOnCampusPlacement: true }),
      student({ srfStatus: "srf_approved", hasApplied: true }),
    ]);

    expect(funnel.find((s) => s.key === "placed")?.count).toBe(1);
  });

  it("never widens as it descends, whatever the data says", () => {
    // Deliberately contradictory: placed without ever applying or registering.
    const funnel = registrationFunnel([
      student({ srfStatus: "invited", hasApplied: false, hasOnCampusPlacement: true }),
    ]);

    const counts = funnel.map((s) => s.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("expresses each stage as a share of the roster", () => {
    const funnel = registrationFunnel([
      student({ srfStatus: "srf_approved" }),
      student({ srfStatus: "srf_approved" }),
      student(),
      student(),
    ]);

    expect(funnel.find((s) => s.key === "verified")?.percentOfRoster).toBe(50);
  });

  it("reports an empty roster as all zeroes rather than dividing by nobody", () => {
    const funnel = registrationFunnel([]);

    expect(funnel.every((s) => s.count === 0 && s.percentOfRoster === 0)).toBe(true);
  });

  it("labels every stage for a human", () => {
    const funnel = registrationFunnel([student()]);

    expect(funnel.map((s) => s.label)).toEqual([
      "On the roster",
      "Registration form submitted",
      "Verified by a coordinator",
      "Placed",
    ]);
  });

  /**
   * An opted-out student leaves the placement DENOMINATOR (statistics.ts), but
   * they are still on the roster and still registered. Dropping them here
   * would make the funnel disagree with the roster count on the same screen.
   */
  it("keeps an opted-out student in the stages they genuinely reached", () => {
    const funnel = registrationFunnel([
      student({ srfStatus: "srf_approved", participationStatus: "opted_out" }),
    ]);

    expect(funnel.find((s) => s.key === "on_roster")?.count).toBe(1);
    expect(funnel.find((s) => s.key === "verified")?.count).toBe(1);
    expect(funnel.find((s) => s.key === "placed")?.count).toBe(0);
  });
});
