import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * 0048 — the board behind a school mark, who awarded a diploma, and telling a
 * student their form was sent back (2026-08-18).
 *
 * The board rules are stated TWICE on purpose: `validateBoardSelection` in the
 * domain, and check constraints here. That is not duplication for its own sake
 * — a screen can be bypassed and a payload can be hand-written, and a state
 * stored against a CBSE board would be shown to a coordinator beside the
 * marksheet and read as a fact about the student.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
}, 60_000);

describe("the board behind each school figure", () => {
  it("records a named board with no second answer", async () => {
    await t.sql(`update students set tenth_board = 'cbse', twelfth_board = 'cisce' where id = $1`, [
      ids.priya,
    ]);

    const rows = await t.sql(`select tenth_board, twelfth_board from students where id = $1`, [
      ids.priya,
    ]);
    expect(rows[0]?.tenth_board).toBe("cbse");
    expect(rows[0]?.twelfth_board).toBe("cisce");
  });

  it("records a state board together with its state", async () => {
    await t.sql(
      `update students set tenth_board = 'state_board', tenth_board_state = 'Tamil Nadu'
        where id = $1`,
      [ids.priya],
    );

    const rows = await t.sql(`select tenth_board_state from students where id = $1`, [ids.priya]);
    expect(rows[0]?.tenth_board_state).toBe("Tamil Nadu");
  });

  it("refuses a state board that does not name its state", async () => {
    await t.expectRejection(
      () => t.sql(`update students set tenth_board = 'state_board' where id = $1`, [ids.priya]),
      /tenth_state_board_names_its_state/i,
    );
  });

  it("refuses a state against a board that does not have one", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `update students set twelfth_board = 'cbse', twelfth_board_state = 'Kerala'
            where id = $1`,
          [ids.priya],
        ),
      /twelfth_board_state_only_for_state_board/i,
    );
  });

  it("refuses Other without naming the board", async () => {
    await t.expectRejection(
      () => t.sql(`update students set twelfth_board = 'other' where id = $1`, [ids.priya]),
      /twelfth_other_board_is_named/i,
    );
  });

  it("refuses a typed board name against a board that is not Other", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `update students set tenth_board = 'nios', tenth_board_other = 'NIOS' where id = $1`,
          [ids.priya],
        ),
      /tenth_board_other_only_for_other/i,
    );
  });

  it("refuses a board outside the vocabulary", async () => {
    await t.expectRejection(
      () => t.sql(`update students set tenth_board = 'icse' where id = $1`, [ids.priya]),
      /invalid input value for enum school_board/i,
    );
  });

  /**
   * Five students registered before boards existed. Leaving them alone was the
   * whole reason these columns are nullable: a backfilled board would be a
   * claim nobody has checked against a document.
   */
  it("leaves a student who registered before boards existed alone", async () => {
    const rows = await t.sql(
      `select tenth_board, twelfth_board, diploma_university from students where id = $1`,
      [ids.priya],
    );
    expect(rows[0]?.tenth_board).toBeNull();
    expect(rows[0]?.twelfth_board).toBeNull();
    expect(rows[0]?.diploma_university).toBeNull();
  });
});

describe("who awarded the diploma", () => {
  it("records the awarding university or board", async () => {
    await t.sql(`update students set diploma_university = $1 where id = $2`, [
      "DOTE, Tamil Nadu",
      ids.priya,
    ]);

    const rows = await t.sql(`select diploma_university from students where id = $1`, [ids.priya]);
    expect(rows[0]?.diploma_university).toBe("DOTE, Tamil Nadu");
  });
});

/**
 * A screen can only tell somebody who visits it. A form sent back for changes
 * is the one thing in this flow that REQUIRES the student to act on it.
 */
describe("the student is told their form was sent back", () => {
  const reject = async (reason: string | null) =>
    await t.sql(
      `update students set srf_status = 'srf_rejected', srf_rejection_reason = $1 where id = $2`,
      [reason, ids.priya],
    );

  beforeEach(async () => {
    await t.sql(`update students set srf_status = 'srf_submitted' where id = $1`, [ids.priya]);
    /**
     * Signing in is what binds `auth_user_id`, and `students_update_self` keys
     * off it. Without this the "as the student" test would prove nothing: RLS
     * is a filter, so the update would match no row and quietly do nothing -
     * which is exactly how it first failed here.
     */
    await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [
      ids.priyaUser,
    ]);
  });

  it("writes one notification carrying the coordinator's own words", async () => {
    await reject("Your semester 2 marksheet is missing.");

    const rows = await t.sql(`select kind, title, body from notifications where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("srf_rejected");
    expect(String(rows[0]?.title)).toMatch(/sent back for changes/i);
    expect(String(rows[0]?.body)).toMatch(/semester 2 marksheet is missing/i);
    // And what to do about it - a notification with no next step is an alarm.
    expect(String(rows[0]?.body)).toMatch(/submit it again/i);
  });

  it("still says something useful when no reason was recorded", async () => {
    await reject(null);

    const rows = await t.sql(`select body from notifications where student_id = $1`, [ids.priya]);
    expect(String(rows[0]?.body)).toMatch(/asked for changes/i);
  });

  it("does not notify twice when the coordinator saves the same decision again", async () => {
    await reject("Fix the 12th board.");
    await t.sql(`update students set srf_rejection_reason = 'Fix the 12th board.' where id = $1`, [
      ids.priya,
    ]);

    const rows = await t.sql(`select id from notifications where student_id = $1`, [ids.priya]);
    expect(rows).toHaveLength(1);
  });

  /** D7's rule: someone who has left the placement process is not chased. */
  it("never notifies a student who has opted out", async () => {
    await t.sql(`update students set participation_status = 'opted_out' where id = $1`, [
      ids.priya,
    ]);

    await reject("Your 10th board does not match the marksheet.");

    const rows = await t.sql(`select id from notifications where student_id = $1`, [ids.priya]);
    expect(rows).toHaveLength(0);
  });

  it("says nothing to anybody else", async () => {
    await reject("Your semester 2 marksheet is missing.");

    const rows = await t.sql(`select id from notifications where student_id = $1`, [ids.arjun]);
    expect(rows).toHaveLength(0);
  });

  it("does not notify on approval", async () => {
    await t.sql(`update students set srf_status = 'srf_approved' where id = $1`, [ids.priya]);

    const rows = await t.sql(
      `select id from notifications where student_id = $1 and kind = 'srf_rejected'`,
      [ids.priya],
    );
    expect(rows).toHaveLength(0);
  });

  /**
   * 0020 has permitted this since long before the screen offered it, and this
   * test is what proves the round trip the client asked for: rejected, edited,
   * resubmitted, decided again.
   */
  it("lets the student resubmit the form they were sent back", async () => {
    await reject("Add semester 2.");

    await t.asUser(
      ids.priyaUser,
      `update students set srf_status = 'srf_submitted' where id = $1`,
      [ids.priya],
    );

    const rows = await t.sql(
      `select srf_status, srf_rejection_reason from students where id = $1`,
      [ids.priya],
    );
    expect(rows[0]?.srf_status).toBe("srf_submitted");
    // Kept, deliberately: it is how the coordinator sees what they asked for
    // when the corrected form arrives back in their queue.
    expect(rows[0]?.srf_rejection_reason).toBe("Add semester 2.");
  });
});
