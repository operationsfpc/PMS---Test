import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * The SRF submission, run as the student, against the real triggers.
 *
 * Reported from UAT 2026-08-05: "the student registration form is still not
 * getting submitted successfully."
 *
 * It never could. `protect_verified_academics` (0009) refuses any student
 * change to `tenth_percentage`, `twelfth_percentage` or `srf_status` — and the
 * SRF writes all three in one statement. Every submission failed with
 * "Verified academic data can only be changed by a placement coordinator".
 *
 * Nothing caught it because the layers were tested apart: srf-repository is
 * tested against MSW, which has no triggers, and the trigger was tested with
 * raw SQL that never resembled the submission. This file is that missing
 * middle — the exact statement the repository issues, as the student who
 * issues it.
 *
 * The guard is still the point. A student may DECLARE their own marks and send
 * the form for checking; they may never mark it approved, and once a
 * coordinator has approved it the figures are theirs no longer.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

/** Exactly what src/features/srf/srf-repository.ts writes. */
const SUBMIT = `
  update students set
    full_name = $2, mobile = '9840000000',
    tenth_percentage = 91.4, twelfth_percentage = 88.2,
    passing_year = 2026, programme_level = 'ug',
    technical_skills = 'TypeScript', consent_given_at = now(),
    srf_status = 'srf_submitted', srf_submitted_at = now()
  where auth_user_id = $1
  returning id, srf_status
`;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [ids.arjunUser]);
  // The seed approves both students; a real submitter has not been approved yet.
  await t.sql(`update students set srf_status = 'registered' where id in ($1,$2)`, [
    ids.priya,
    ids.arjun,
  ]);
}, 60_000);

describe("a student can submit their own registration form", () => {
  it("accepts the submission the application actually sends", async () => {
    const rows = await t.asUser(ids.priyaUser, SUBMIT, [ids.priyaUser, "Priya Ramesh"]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.srf_status).toBe("srf_submitted");
  });

  it("records the marks the student declared", async () => {
    const rows = await t.sql(`select tenth_percentage from students where id = $1`, [ids.priya]);

    expect(Number(rows[0]?.tenth_percentage)).toBe(91.4);
  });

  /** A1: a rejected student edits and resubmits; the coordinator sees it afresh. */
  it("lets a student whose form was sent back submit it again", async () => {
    await t.sql(`update students set srf_status = 'srf_rejected' where id = $1`, [ids.arjun]);

    const rows = await t.asUser(ids.arjunUser, SUBMIT, [ids.arjunUser, "Arjun Menon"]);

    expect(rows[0]?.srf_status).toBe("srf_submitted");
  });
});

describe("what a student still may not do", () => {
  it("refuses a student approving their own form", async () => {
    await t.expectRejection(
      () =>
        t.asUser(ids.priyaUser, `update students set srf_status = 'srf_approved' where id = $1`, [
          ids.priya,
        ]),
      /placement coordinator/i,
    );
  });

  it("refuses a student rejecting their own form to dodge verification", async () => {
    await t.expectRejection(
      () =>
        t.asUser(ids.priyaUser, `update students set srf_status = 'srf_rejected' where id = $1`, [
          ids.priya,
        ]),
      /placement coordinator/i,
    );
  });

  /**
   * The heart of the guard: declaring marks is fine until someone checks them.
   * After that the figures are the coordinator's, and a student editing them
   * would silently change what every eligibility rule has already been run
   * against.
   */
  it("refuses a change to marks once a coordinator has approved the form", async () => {
    await t.sql(`update students set srf_status = 'srf_approved' where id = $1`, [ids.priya]);

    await t.expectRejection(
      () =>
        t.asUser(ids.priyaUser, `update students set tenth_percentage = 99 where id = $1`, [
          ids.priya,
        ]),
      /placement coordinator/i,
    );
  });

  it("refuses a student resubmitting once approved, which would undo the verification", async () => {
    await t.expectRejection(
      () => t.asUser(ids.priyaUser, SUBMIT, [ids.priyaUser, "Priya Ramesh"]),
      /placement coordinator/i,
    );
  });

  it("still refuses the fields a student never owns", async () => {
    for (const column of [
      "roll_number = 'HACKED'",
      "overall_cgpa = 9.9",
      "current_arrears = 3",
      "participation_status = 'opted_out'",
    ]) {
      await t.expectRejection(
        () => t.asUser(ids.arjunUser, `update students set ${column} where id = $1`, [ids.arjun]),
        /placement coordinator|irreversible/i,
      );
    }
  });

  it("still refuses one student writing to another's record", async () => {
    const rows = await t.asUser(
      ids.arjunUser,
      `update students set full_name = 'Hacked' where id = $1 returning id`,
      [ids.priya],
    );

    expect(rows).toHaveLength(0);
  });
});

describe("a coordinator is unaffected", () => {
  it("may still approve a form", async () => {
    const rows = await t.asUser(
      ids.cpcUser,
      `update students set srf_status = 'srf_approved' where id = $1 returning srf_status`,
      [ids.priya],
    );

    expect(rows[0]?.srf_status).toBe("srf_approved");
  });

  it("may still correct verified marks directly", async () => {
    const rows = await t.asUser(
      ids.cpcUser,
      `update students set tenth_percentage = 92 where id = $1 returning id`,
      [ids.priya],
    );

    expect(rows).toHaveLength(1);
  });
});
