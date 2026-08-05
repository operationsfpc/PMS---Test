import { describe, expect, it } from "vitest";
import { type DriveParticipation, driveFunnel } from "./drive-funnel";

/**
 * F5 (UAT 2026-08-06): "There has to be another box to track drive specific
 * data. Within this, should have information of eligible students (students to
 * whom a drive is opened), applied students, attendance and clearance in each
 * round till final offer."
 *
 * This is the half of the old registration funnel that never belonged there.
 * Its denominator is one drive's audience, not the roster, and it has as many
 * middle stages as the drive has rounds.
 */
const drive = (over: Partial<DriveParticipation> = {}): DriveParticipation => ({
  eligible: 0,
  applied: 0,
  shortlisted: 0,
  rounds: [],
  offers: 0,
  ...over,
});

describe("driveFunnel", () => {
  it("opens with the students the drive was opened to", () => {
    const funnel = driveFunnel(drive({ eligible: 120, applied: 40 }));

    expect(funnel.eligible).toBe(120);
    expect(funnel.applied).toBe(40);
  });

  it("reports applications as a share of the audience, not of the roster", () => {
    const funnel = driveFunnel(drive({ eligible: 200, applied: 50 }));

    expect(funnel.applicationRate).toBe(25);
  });

  it("reports offers as a share of those who applied", () => {
    const funnel = driveFunnel(drive({ eligible: 200, applied: 50, offers: 5 }));

    expect(funnel.offerRate).toBe(10);
  });

  it("orders the rounds by sequence however they arrive", () => {
    const funnel = driveFunnel(
      drive({
        rounds: [
          { roundId: "r2", sequence: 2, name: "Technical", participants: [] },
          { roundId: "r1", sequence: 1, name: "Aptitude", participants: [] },
        ],
      }),
    );

    expect(funnel.rounds.map((r) => r.name)).toEqual(["Aptitude", "Technical"]);
  });

  it("counts who was called to a round, whatever happened next", () => {
    const funnel = driveFunnel(
      drive({
        rounds: [
          {
            roundId: "r1",
            sequence: 1,
            name: "Aptitude",
            participants: [
              { studentId: "a", attendance: "present", result: "selected" },
              { studentId: "b", attendance: "absent", result: null },
              { studentId: "c", attendance: "scheduled", result: null },
            ],
          },
        ],
      }),
    );

    expect(funnel.rounds[0]?.scheduled).toBe(3);
  });

  /**
   * A `provisional` check-in is a QR scan nobody has confirmed. It is not an
   * absence (src/domain/attendance.ts) and it is not proof of attendance
   * either, so it is reported as neither — reporting it as present is how a
   * coordinator stops confirming them.
   */
  it("counts confirmed attendance only, and says how many are still unconfirmed", () => {
    const funnel = driveFunnel(
      drive({
        rounds: [
          {
            roundId: "r1",
            sequence: 1,
            name: "Aptitude",
            participants: [
              { studentId: "a", attendance: "present", result: null },
              { studentId: "b", attendance: "absent", result: null },
              { studentId: "c", attendance: "provisional", result: null },
              { studentId: "d", attendance: "scheduled", result: null },
            ],
          },
        ],
      }),
    );

    expect(funnel.rounds[0]?.present).toBe(1);
    expect(funnel.rounds[0]?.absent).toBe(1);
    expect(funnel.rounds[0]?.unconfirmed).toBe(2);
  });

  /**
   * Only `selected` clears a round (Q10, src/domain/attendance.ts). Counting
   * `waitlisted` or `on_hold` as cleared would make this screen disagree with
   * who the next round is actually scheduled for.
   */
  it("clears only the students who were selected", () => {
    const funnel = driveFunnel(
      drive({
        rounds: [
          {
            roundId: "r1",
            sequence: 1,
            name: "Aptitude",
            participants: [
              { studentId: "a", attendance: "present", result: "selected" },
              { studentId: "b", attendance: "present", result: "waitlisted" },
              { studentId: "c", attendance: "present", result: "on_hold" },
              { studentId: "d", attendance: "present", result: "rejected" },
            ],
          },
        ],
      }),
    );

    expect(funnel.rounds[0]?.cleared).toBe(1);
  });

  /**
   * Clearance is measured against who TURNED UP. A student who never attended
   * did not fail the round, and dividing by them makes every round with
   * absentees look like a harder filter than it was.
   */
  it("measures clearance against attendance, not against who was called", () => {
    const funnel = driveFunnel(
      drive({
        rounds: [
          {
            roundId: "r1",
            sequence: 1,
            name: "Aptitude",
            participants: [
              { studentId: "a", attendance: "present", result: "selected" },
              { studentId: "b", attendance: "present", result: "rejected" },
              { studentId: "c", attendance: "absent", result: null },
              { studentId: "d", attendance: "absent", result: null },
            ],
          },
        ],
      }),
    );

    expect(funnel.rounds[0]?.clearanceRate).toBe(50);
  });

  it("reports a round nobody has attended as zero rather than dividing by nobody", () => {
    const funnel = driveFunnel(
      drive({
        rounds: [
          {
            roundId: "r1",
            sequence: 1,
            name: "Aptitude",
            participants: [{ studentId: "a", attendance: "scheduled", result: null }],
          },
        ],
      }),
    );

    expect(funnel.rounds[0]?.clearanceRate).toBe(0);
    expect(funnel.rounds[0]?.attendanceRate).toBe(0);
  });

  it("reports attendance as a share of who was called", () => {
    const funnel = driveFunnel(
      drive({
        rounds: [
          {
            roundId: "r1",
            sequence: 1,
            name: "Aptitude",
            participants: [
              { studentId: "a", attendance: "present", result: null },
              { studentId: "b", attendance: "present", result: null },
              { studentId: "c", attendance: "absent", result: null },
              { studentId: "d", attendance: "absent", result: null },
            ],
          },
        ],
      }),
    );

    expect(funnel.rounds[0]?.attendanceRate).toBe(50);
  });

  /** R5a can open a drive to more students than the criteria admit. */
  it("never reports more than 100% applied", () => {
    const funnel = driveFunnel(drive({ eligible: 10, applied: 14 }));

    expect(funnel.applicationRate).toBe(100);
  });

  it("reports a drive nobody is eligible for as zero rather than dividing by nobody", () => {
    const funnel = driveFunnel(drive());

    expect(funnel.applicationRate).toBe(0);
    expect(funnel.offerRate).toBe(0);
    expect(funnel.rounds).toEqual([]);
  });

  it("carries the shortlist between applying and the first round", () => {
    const funnel = driveFunnel(drive({ eligible: 100, applied: 60, shortlisted: 20 }));

    expect(funnel.shortlisted).toBe(20);
  });

  /** The whole point of the box: read left to right, it must never widen. */
  it("names the stages in order, ending at the final offer", () => {
    const funnel = driveFunnel(
      drive({
        eligible: 100,
        applied: 60,
        shortlisted: 20,
        offers: 4,
        rounds: [
          { roundId: "r1", sequence: 1, name: "Aptitude", participants: [] },
          { roundId: "r2", sequence: 2, name: "Technical", participants: [] },
        ],
      }),
    );

    expect(funnel.stages.map((s) => s.label)).toEqual([
      "Eligible",
      "Applied",
      "Shortlisted",
      "1. Aptitude",
      "2. Technical",
      "Final offer",
    ]);
  });

  it("gives each round stage the number who cleared it, not the number called", () => {
    const funnel = driveFunnel(
      drive({
        eligible: 10,
        applied: 8,
        shortlisted: 6,
        offers: 1,
        rounds: [
          {
            roundId: "r1",
            sequence: 1,
            name: "Aptitude",
            participants: [
              { studentId: "a", attendance: "present", result: "selected" },
              { studentId: "b", attendance: "present", result: "rejected" },
            ],
          },
        ],
      }),
    );

    expect(funnel.stages.map((s) => s.count)).toEqual([10, 8, 6, 1, 1]);
  });
});
