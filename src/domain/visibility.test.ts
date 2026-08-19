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

/**
 * A drive reaches the students who asked for that kind of work (2026-08-18).
 *
 * "a drive has to be classified into one of these areas by the AE while raising
 * a PIF. This should go to the students only showing interest in that area."
 *
 * The five areas are the same vocabulary the student picked on their
 * registration form, which is what makes the match meaningful - and, since
 * 0049, what makes it possible at all.
 */
describe("R5 — the area the drive is for", () => {
  const softwareDrive = drive({ roleCategory: "software_technical" });

  it("shows a software drive to a student who asked for software", () => {
    expect(
      isDriveVisibleToStudent(student({ roleCategories: ["software_technical"] }), softwareDrive)
        .visible,
    ).toBe(true);
  });

  it("hides it from a student who asked only for sales", () => {
    const result = isDriveVisibleToStudent(student({ roleCategories: ["sales"] }), softwareDrive);

    expect(result.visible).toBe(false);
    expect(result.reason).toBe("area_not_chosen");
  });

  it("shows it to a student who asked for several areas including this one", () => {
    expect(
      isDriveVisibleToStudent(
        student({ roleCategories: ["sales", "software_technical"] }),
        softwareDrive,
      ).visible,
    ).toBe(true);
  });

  /**
   * A drive with no area declared predates the rule (and `role_category` is
   * nullable on `drives` for drafts). Hiding it from everybody would silently
   * empty the audience for every drive raised before today.
   */
  it("shows a drive that declares no area to everybody", () => {
    expect(
      isDriveVisibleToStudent(student({ roleCategories: ["sales"] }), drive({ roleCategory: null }))
        .visible,
    ).toBe(true);
  });

  /**
   * A student who has chosen nothing has not opted out of everything - they
   * have not answered. Treating silence as refusal would hide every drive from
   * anybody whose form predates 0049, with no message they could act on.
   */
  it("shows the drive to a student who has chosen no area at all", () => {
    expect(isDriveVisibleToStudent(student({ roleCategories: [] }), softwareDrive).visible).toBe(
      true,
    );
  });

  /** It is a preference, not a sanction: the CPC override still bypasses it. */
  it("is bypassed by the R5a override, like the other preference gates", () => {
    expect(
      isDriveVisibleToStudent(
        student({ roleCategories: ["sales"] }),
        drive({ roleCategory: "software_technical", openToAllOverride: true }),
      ).visible,
    ).toBe(true);
  });

  it("refuses the application too, not just the listing", () => {
    const result = canApply(
      student({ roleCategories: ["sales"] }),
      softwareDrive,
      new Date("2026-06-15T00:00:00Z"),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("area_not_chosen");
  });
});

/**
 * D1 (UAT 2026-08-19): "Students should only see drives matching the job-type
 * preference set in the PIF." The same shape as the area rule above — a
 * PREFERENCE below R5a's override, where silence means "no opinion".
 */
describe("R5 — the drive-type preference", () => {
  const placementDrive = drive({ driveType: "placement" });

  it("shows a placement to a student who asked for placements", () => {
    expect(
      isDriveVisibleToStudent(student({ driveTypePreferences: ["placement"] }), placementDrive)
        .visible,
    ).toBe(true);
  });

  it("hides it from a student who asked only for internships", () => {
    const result = isDriveVisibleToStudent(
      student({ driveTypePreferences: ["internship"] }),
      placementDrive,
    );

    expect(result.visible).toBe(false);
    expect(result.reason).toBe("drive_type_not_preferred");
  });

  it("shows every type to a student who has expressed no preference", () => {
    expect(
      isDriveVisibleToStudent(student({ driveTypePreferences: [] }), placementDrive).visible,
    ).toBe(true);
    expect(isDriveVisibleToStudent(student(), placementDrive).visible).toBe(true);
  });

  it("is bypassed by the R5a override, like the other preference gates", () => {
    expect(
      isDriveVisibleToStudent(
        student({ driveTypePreferences: ["internship"] }),
        drive({ driveType: "placement", openToAllOverride: true }),
      ).visible,
    ).toBe(true);
  });

  it("refuses the application too, not just the listing", () => {
    const result = canApply(
      student({ driveTypePreferences: ["internship"] }),
      placementDrive,
      new Date("2026-06-15T00:00:00Z"),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("drive_type_not_preferred");
  });
});
