import { describe, expect, it } from "vitest";
import type { Offer } from "./offers";
import type { AcademicProfile } from "./types";
import {
  canApply,
  isDriveVisibleToStudent,
  type StudentContext,
  type VisibleDrive,
} from "./visibility";

const academics: AcademicProfile = {
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  overallCgpa: 8.2,
  tenthPercentage: 91,
  twelfthPercentage: 88,
  currentArrears: 0,
  historyOfArrears: 0,
  city: "Chennai",
  campus: "Alliance University",
};

const student = (over: Partial<StudentContext> = {}): StudentContext => ({
  srfStatus: "srf_approved",
  participationStatus: "active",
  academics,
  offers: [],
  ...over,
});

const drive = (over: Partial<VisibleDrive> = {}): VisibleDrive => ({
  id: "drive-1",
  status: "live",
  driveType: "placement",
  offerCategory: "dream",
  openToAllOverride: false,
  applicationStart: new Date("2026-06-01T00:00:00Z"),
  applicationEnd: new Date("2026-06-30T23:59:59Z"),
  criteria: {
    eligibleDegrees: [],
    eligibleBranches: [],
    eligiblePassingYears: [],
    minOverallCgpa: null,
    minTenthPercentage: null,
    minTwelfthPercentage: null,
    arrearPolicy: "flexible",
    targetCities: [],
    targetCampuses: [],
  },
  ...over,
});

const offer = (over: Partial<Offer> & Pick<Offer, "id">): Offer => ({
  driveId: `d-${over.id}`,
  driveType: "placement",
  offerCategory: "regular",
  ctcLpa: 4,
  declaredAt: new Date("2026-01-01T00:00:00Z"),
  source: "on_campus",
  ...over,
});

describe("isDriveVisibleToStudent", () => {
  it("shows an eligible, unplaced student a live drive", () => {
    expect(isDriveVisibleToStudent(student(), drive()).visible).toBe(true);
  });

  describe("gating that the CPC override can never bypass", () => {
    it("hides drives from a student whose SRF is not approved", () => {
      const result = isDriveVisibleToStudent(
        student({ srfStatus: "srf_submitted" }),
        drive({ openToAllOverride: true }),
      );
      expect(result).toMatchObject({ visible: false, reason: "srf_not_approved" });
    });

    it("hides drives from an opted-out student even with the override on", () => {
      const result = isDriveVisibleToStudent(
        student({ participationStatus: "opted_out" }),
        drive({ openToAllOverride: true }),
      );
      expect(result).toMatchObject({ visible: false, reason: "opted_out" });
    });

    it("hides drives from a disbarred student even with the override on", () => {
      const result = isDriveVisibleToStudent(
        student({ participationStatus: "disbarred" }),
        drive({ openToAllOverride: true }),
      );
      expect(result).toMatchObject({ visible: false, reason: "disbarred" });
    });

    it("hides drives the student is not academically eligible for", () => {
      const result = isDriveVisibleToStudent(
        student(),
        drive({
          openToAllOverride: true,
          criteria: { ...drive().criteria, minOverallCgpa: 9.5 },
        }),
      );
      expect(result).toMatchObject({ visible: false, reason: "not_eligible" });
    });

    it("explains every eligibility failure", () => {
      const result = isDriveVisibleToStudent(
        student(),
        drive({
          criteria: { ...drive().criteria, minOverallCgpa: 9.5, eligibleBranches: ["ECE"] },
        }),
      );
      expect(result.visible).toBe(false);
      expect(result.failures?.map((f) => f.code)).toEqual(["branch", "overall_cgpa"]);
    });
  });

  describe("the category ladder — new drives only (PRD §12)", () => {
    const placedAt = (category: "regular" | "dream" | "super_dream"): StudentContext =>
      student({ offers: [offer({ id: "o1", offerCategory: category })] });

    it("shows a higher-category drive to a placed student", () => {
      expect(
        isDriveVisibleToStudent(placedAt("regular"), drive({ offerCategory: "dream" })).visible,
      ).toBe(true);
    });

    it("hides an equal-category drive from a placed student", () => {
      const result = isDriveVisibleToStudent(placedAt("dream"), drive({ offerCategory: "dream" }));
      expect(result).toMatchObject({ visible: false, reason: "placed_at_equal_or_higher" });
    });

    it("hides a lower-category drive from a placed student", () => {
      const result = isDriveVisibleToStudent(
        placedAt("super_dream"),
        drive({ offerCategory: "regular" }),
      );
      expect(result).toMatchObject({ visible: false, reason: "placed_at_equal_or_higher" });
    });

    it("hides everything from a Super Dream student — there is nothing above", () => {
      expect(
        isDriveVisibleToStudent(placedAt("super_dream"), drive({ offerCategory: "super_dream" }))
          .visible,
      ).toBe(false);
    });

    it("a self-placed offer climbs the ladder exactly like an on-campus one (D5, 2026-08-12)", () => {
      const selfPlaced = student({
        offers: [offer({ id: "sp", source: "self_placed", offerCategory: "dream" })],
      });
      expect(isDriveVisibleToStudent(selfPlaced, drive({ offerCategory: "regular" })).reason).toBe(
        "placed_at_equal_or_higher",
      );
      expect(isDriveVisibleToStudent(selfPlaced, drive({ offerCategory: "dream" })).visible).toBe(
        false,
      );
      // Higher rungs stay open — the ladder, not a blanket ban.
      expect(
        isDriveVisibleToStudent(selfPlaced, drive({ offerCategory: "super_dream" })).visible,
      ).toBe(true);
    });

    it("a self-placed internship consumes the cap and blocks internship drives (D5 correction)", () => {
      const selfInterned = student({
        offers: [
          offer({ id: "sp", source: "self_placed", driveType: "internship", offerCategory: null }),
        ],
      });
      expect(isDriveVisibleToStudent(selfInterned, drive({ driveType: "internship" })).reason).toBe(
        "internship_cap_consumed",
      );
      // But a plain placement stays open — the cap is about internships only.
      expect(isDriveVisibleToStudent(selfInterned, drive({ driveType: "placement" })).visible).toBe(
        true,
      );
    });
  });

  describe("the internship cap is checked BEFORE the ladder (decision Q2)", () => {
    const withInternship = student({
      offers: [offer({ id: "i1", driveType: "internship", offerCategory: null })],
    });

    it("hides plain internship drives once the cap is consumed", () => {
      const result = isDriveVisibleToStudent(
        withInternship,
        drive({ driveType: "internship", offerCategory: null }),
      );
      expect(result).toMatchObject({ visible: false, reason: "internship_cap_consumed" });
    });

    it("hides internship-convertible drives once the cap is consumed", () => {
      const result = isDriveVisibleToStudent(
        withInternship,
        drive({ driveType: "internship_convertible", offerCategory: "dream" }),
      );
      expect(result).toMatchObject({ visible: false, reason: "internship_cap_consumed" });
    });

    it("hides a SUPER DREAM internship-convertible drive once the cap is consumed", () => {
      // The ladder would have allowed this. The cap wins.
      const result = isDriveVisibleToStudent(
        withInternship,
        drive({ driveType: "internship_convertible", offerCategory: "super_dream" }),
      );
      expect(result).toMatchObject({ visible: false, reason: "internship_cap_consumed" });
    });

    it("still shows plain placement drives — the tracks are independent", () => {
      expect(
        isDriveVisibleToStudent(withInternship, drive({ driveType: "placement" })).visible,
      ).toBe(true);
    });

    it("shows a plain internship to a PLACED student who has no internship yet", () => {
      const placed = student({ offers: [offer({ id: "p", offerCategory: "super_dream" })] });
      expect(
        isDriveVisibleToStudent(placed, drive({ driveType: "internship", offerCategory: null }))
          .visible,
      ).toBe(true);
    });
  });

  describe("R5a — the Central CPC's open_to_all_override for prestige drives", () => {
    it("opens a lower-category drive to an already-placed student", () => {
      const placed = student({ offers: [offer({ id: "o", offerCategory: "super_dream" })] });
      expect(
        isDriveVisibleToStudent(
          placed,
          drive({ offerCategory: "regular", openToAllOverride: true }),
        ).visible,
      ).toBe(true);
    });

    it("opens an internship drive to a student who has used their cap", () => {
      const capped = student({
        offers: [offer({ id: "i", driveType: "internship", offerCategory: null })],
      });
      expect(
        isDriveVisibleToStudent(
          capped,
          drive({ driveType: "internship", offerCategory: null, openToAllOverride: true }),
        ).visible,
      ).toBe(true);
    });

    it("opens a drive to a student blocked by both the cap and the ladder", () => {
      const both = student({
        offers: [
          offer({ id: "p", offerCategory: "super_dream" }),
          offer({ id: "i", driveType: "internship", offerCategory: null }),
        ],
      });
      expect(
        isDriveVisibleToStudent(
          both,
          drive({
            driveType: "internship_convertible",
            offerCategory: "regular",
            openToAllOverride: true,
          }),
        ).visible,
      ).toBe(true);
    });
  });
});

/** R6 — the application window. PRD §7.4, §22.6. */
describe("canApply", () => {
  const during = new Date("2026-06-15T12:00:00Z");

  it("allows an eligible student inside the window", () => {
    expect(canApply(student(), drive(), during).allowed).toBe(true);
  });

  it("refuses when the drive is not visible", () => {
    const result = canApply(student({ participationStatus: "disbarred" }), drive(), during);
    expect(result).toMatchObject({ allowed: false, reason: "disbarred" });
    expect(result.failures).toBeUndefined();
  });

  it("forwards the eligibility failures so the student can be told why", () => {
    const result = canApply(
      student(),
      drive({ criteria: { ...drive().criteria, minOverallCgpa: 9.5 } }),
      during,
    );
    expect(result).toMatchObject({ allowed: false, reason: "not_eligible" });
    expect(result.failures?.map((f) => f.code)).toEqual(["overall_cgpa"]);
  });

  it("refuses before the window opens", () => {
    const result = canApply(student(), drive(), new Date("2026-05-31T23:59:59Z"));
    expect(result).toMatchObject({ allowed: false, reason: "window_not_open" });
  });

  it("refuses after the window closes", () => {
    const result = canApply(student(), drive(), new Date("2026-07-01T00:00:00Z"));
    expect(result).toMatchObject({ allowed: false, reason: "window_closed" });
  });

  it("allows application exactly on the opening instant", () => {
    expect(canApply(student(), drive(), new Date("2026-06-01T00:00:00Z")).allowed).toBe(true);
  });

  it("allows application exactly on the closing instant", () => {
    expect(canApply(student(), drive(), new Date("2026-06-30T23:59:59Z")).allowed).toBe(true);
  });

  it("refuses a drive that is not live", () => {
    const result = canApply(student(), drive({ status: "approved" }), during);
    expect(result).toMatchObject({ allowed: false, reason: "drive_not_live" });
  });

  it("refuses a second application to the same drive", () => {
    const result = canApply(student(), drive({ id: "drive-1" }), during, ["drive-1"]);
    expect(result).toMatchObject({ allowed: false, reason: "already_applied" });
  });

  it("allows application when the student applied to a different drive", () => {
    expect(canApply(student(), drive({ id: "drive-1" }), during, ["drive-9"]).allowed).toBe(true);
  });
});
