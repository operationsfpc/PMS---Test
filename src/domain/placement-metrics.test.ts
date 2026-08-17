import { describe, expect, it } from "vitest";
import {
  type MetricDrive,
  type MetricOffer,
  type MetricStudent,
  meetsSixtyPercentBar,
  summariseDriveMetrics,
  summariseStudentMetrics,
} from "./placement-metrics";

/**
 * 2026-08-17 (Karthik). The placement overview's headline boxes, respecified:
 *
 *   Row 1 — students registered · students eligible (60% in 10th, 12th and
 *   graduation, post-graduation as well if applicable) · unique students
 *   placed · placement offers · and the same last two again for internships.
 *
 *   Row 2 — drives completed and drives in progress, placement and internship
 *   counted separately.
 *
 * The rule that ties it together: "Internship convertible to placement is
 * treated as placement." So `internship_convertible` counts in the placement
 * columns and NEVER in the internship ones, which is the same definition
 * `placementOffers` already uses for the ladder.
 *
 * Unique-vs-total is the distinction the boxes exist to draw: one student with
 * three offers is 1 placed and 3 offers. Reporting only one of those numbers
 * is how a placement rate and an offer count end up contradicting each other
 * in the same deck.
 */
const ug = (over: Partial<MetricStudent> = {}): MetricStudent => ({
  studentId: "s1",
  programmeLevel: "ug",
  srfStatus: "srf_approved",
  tenthPercentage: 80,
  twelfthPercentage: 75,
  overallCgpa: 8,
  ugAggregateCgpa: null,
  ...over,
});

describe("meetsSixtyPercentBar", () => {
  it("passes an undergraduate clear of the bar everywhere", () => {
    expect(meetsSixtyPercentBar(ug())).toBe(true);
  });

  it.each([
    ["10th", { tenthPercentage: 59.9 }],
    ["12th", { twelfthPercentage: 59.9 }],
    ["graduation", { overallCgpa: 5.9 }],
  ])("fails an undergraduate short in %s", (_where, over) => {
    expect(meetsSixtyPercentBar(ug(over))).toBe(false);
  });

  /** Exactly 60 is AT the bar, and "60% and above" includes 60. */
  it.each([[{ tenthPercentage: 60 }], [{ twelfthPercentage: 60 }], [{ overallCgpa: 6 }]])(
    "counts a mark exactly on the bar as meeting it",
    (over) => {
      expect(meetsSixtyPercentBar(ug(over))).toBe(true);
    },
  );

  /**
   * "Post graduation as well if applicable". A PG student has FOUR marks to
   * clear: school, their undergraduate degree, and the postgraduate one they
   * are currently in. `overall_cgpa` is the current programme, so for a PG
   * student it is the post-graduation figure and `ugAggregateCgpa` is their
   * graduation.
   */
  it("holds a postgraduate to their UG aggregate as well", () => {
    const pg = ug({ programmeLevel: "pg", ugAggregateCgpa: 5.5, overallCgpa: 8 });
    expect(meetsSixtyPercentBar(pg)).toBe(false);
  });

  it("passes a postgraduate clear of all four", () => {
    const pg = ug({ programmeLevel: "pg", ugAggregateCgpa: 7, overallCgpa: 8 });
    expect(meetsSixtyPercentBar(pg)).toBe(true);
  });

  it("fails a postgraduate short in the postgraduate degree itself", () => {
    const pg = ug({ programmeLevel: "pg", ugAggregateCgpa: 7, overallCgpa: 5 });
    expect(meetsSixtyPercentBar(pg)).toBe(false);
  });

  /**
   * An undergraduate has no UG aggregate, and a missing number must not be
   * read as a failing one - nor as a passing one. It simply does not apply.
   */
  it("does not hold an undergraduate to a UG aggregate they never declare", () => {
    expect(meetsSixtyPercentBar(ug({ ugAggregateCgpa: null }))).toBe(true);
  });

  /**
   * A mark that has not been declared is NOT evidence of meeting the bar.
   * Counting an unfilled form as eligible is how a cohort of 600 reports 600
   * eligible students on day one.
   */
  it.each([
    ["10th", { tenthPercentage: null }],
    ["12th", { twelfthPercentage: null }],
    ["graduation", { overallCgpa: null }],
  ])("does not count an undeclared %s as a pass", (_where, over) => {
    expect(meetsSixtyPercentBar(ug(over))).toBe(false);
  });

  it("fails a postgraduate who has not declared their UG aggregate", () => {
    expect(meetsSixtyPercentBar(ug({ programmeLevel: "pg", ugAggregateCgpa: null }))).toBe(false);
  });
});

const offer = (over: Partial<MetricOffer> = {}): MetricOffer => ({
  studentId: "s1",
  driveType: "placement",
  source: "on_campus",
  ...over,
});

describe("summariseStudentMetrics", () => {
  const students = [
    ug({ studentId: "s1" }),
    ug({ studentId: "s2" }),
    ug({ studentId: "s3", tenthPercentage: 40 }),
  ];

  /**
   * CONFIRMED 2026-08-17 (Karthik), asked and answered: "[registered students]
   * are students whose addition to the portal has been approved."
   *
   * So this is NOT the registration FORM. A student is registered the moment
   * an administrator adds them through Add students - the addition is the
   * approval, because only an Admin can make one. Where they have got to with
   * their own form is the Students overview's question, not this box's.
   */
  it("counts every student on the portal, whatever their form says", () => {
    const rows = [
      ug({ studentId: "a", srfStatus: "invited" }),
      ug({ studentId: "b", srfStatus: "registered" }),
      ug({ studentId: "c", srfStatus: "srf_submitted" }),
      ug({ studentId: "d", srfStatus: "srf_approved" }),
      ug({ studentId: "e", srfStatus: "srf_rejected" }),
    ];
    expect(summariseStudentMetrics(rows, []).registered).toBe(5);
  });

  it("counts eligible students against the 60% bar", () => {
    expect(summariseStudentMetrics(students, []).eligible).toBe(2);
  });

  /** One student, three offers: 1 placed, 3 offers. */
  it("separates unique placed students from the offer count", () => {
    const offers = [
      offer({ studentId: "s1" }),
      offer({ studentId: "s1" }),
      offer({ studentId: "s2" }),
    ];
    const metrics = summariseStudentMetrics(students, offers);
    expect(metrics.placedStudents).toBe(2);
    expect(metrics.placementOffers).toBe(3);
  });

  /** The headline rule: convertible internships are placements. */
  it("counts an internship_convertible offer as a placement, never as an internship", () => {
    const metrics = summariseStudentMetrics(students, [
      offer({ studentId: "s1", driveType: "internship_convertible" }),
    ]);
    expect(metrics.placedStudents).toBe(1);
    expect(metrics.placementOffers).toBe(1);
    expect(metrics.internStudents).toBe(0);
    expect(metrics.internshipOffers).toBe(0);
  });

  it("counts a plain internship only in the internship boxes", () => {
    const metrics = summariseStudentMetrics(students, [
      offer({ studentId: "s1", driveType: "internship" }),
      offer({ studentId: "s1", driveType: "internship" }),
      offer({ studentId: "s2", driveType: "internship" }),
    ]);
    expect(metrics.internStudents).toBe(2);
    expect(metrics.internshipOffers).toBe(3);
    expect(metrics.placedStudents).toBe(0);
  });

  /**
   * Self-placed offers are the student's own find. Every placement figure on
   * this dashboard excludes them (PRD 16.2); they are reported separately.
   */
  it("leaves self-placed offers out of both counts", () => {
    const metrics = summariseStudentMetrics(students, [
      offer({ studentId: "s1", source: "self_placed" }),
      offer({ studentId: "s2", source: "self_placed", driveType: "internship" }),
    ]);
    expect(metrics.placedStudents).toBe(0);
    expect(metrics.internshipOffers).toBe(0);
  });

  it("is all zeroes for an empty cohort", () => {
    expect(summariseStudentMetrics([], [])).toEqual({
      registered: 0,
      eligible: 0,
      placedStudents: 0,
      placementOffers: 0,
      internStudents: 0,
      internshipOffers: 0,
    });
  });
});

const drive = (over: Partial<MetricDrive> = {}): MetricDrive => ({
  driveId: "d1",
  driveType: "placement",
  status: "completed",
  ...over,
});

describe("summariseDriveMetrics", () => {
  it("splits completed and in-progress by placement and internship", () => {
    const metrics = summariseDriveMetrics([
      drive({ driveId: "1", driveType: "placement", status: "completed" }),
      drive({ driveId: "2", driveType: "placement", status: "in_rounds" }),
      drive({ driveId: "3", driveType: "placement", status: "live" }),
      drive({ driveId: "4", driveType: "internship", status: "completed" }),
      drive({ driveId: "5", driveType: "internship", status: "applications_closed" }),
    ]);

    expect(metrics).toEqual({
      placementCompleted: 1,
      placementInProgress: 2,
      internshipCompleted: 1,
      internshipInProgress: 1,
    });
  });

  it("counts a convertible internship drive as a placement drive", () => {
    const metrics = summariseDriveMetrics([
      drive({ driveType: "internship_convertible", status: "completed" }),
    ]);
    expect(metrics.placementCompleted).toBe(1);
    expect(metrics.internshipCompleted).toBe(0);
  });

  /**
   * A drive nobody has published is not "in progress" - it is not a drive the
   * cohort can see. Counting drafts here would let the number grow without a
   * single student being told about anything.
   */
  it.each(["draft", "submitted", "approved", "rejected"] as const)(
    "does not count a %s drive as in progress",
    (status) => {
      const metrics = summariseDriveMetrics([drive({ status })]);
      expect(metrics.placementInProgress).toBe(0);
      expect(metrics.placementCompleted).toBe(0);
    },
  );

  it("is all zeroes when there are no drives", () => {
    expect(summariseDriveMetrics([])).toEqual({
      placementCompleted: 0,
      placementInProgress: 0,
      internshipCompleted: 0,
      internshipInProgress: 0,
    });
  });
});
