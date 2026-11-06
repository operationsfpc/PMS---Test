import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * 0139: the advance waits for the round it leaves behind.
 *
 * The Rounds & results screen refuses to move students out of a round whose
 * own date has not arrived yet (src/domain/round-timing.ts). The button is the
 * courtesy; this function is the fact — a stale tab in another window calls it
 * directly, and so does anything else that reaches the API.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const AE_USER = "65000000-0000-0000-0000-000000000001";

let drive: string;
let round1: string;
let round2: string;
let priyaApp: string;

/** The RPC the advance calls, with one student in it. */
const advanceInto = (into: string, applicationId: string) =>
  t.sql(`select schedule_round_participants($1, array[$2]::uuid[], $3)`, [
    into,
    applicationId,
    ids.centralUser,
  ]);

async function schedule(psql: string, roundId: string): Promise<void> {
  await t.sql(`update drive_rounds set round_scheduled_at = ${psql} where id = $1`, [roundId]);
}

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-timing@faceprep.in','AE Timing','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-timing@faceprep.in')`, [AE_USER]);

  drive = (
    await t.sql(
      `insert into drives (company_name, created_by, status, drive_type, offer_category,
                           application_start, application_end, role_title, job_description,
                           work_locations, ctc_min_lpa, role_category)
       values ('Zoho', $1, 'live', 'placement', 'dream',
               '2026-08-01T00:00:00Z', '2036-08-31T00:00:00Z', 'Engineer', 'Build',
               'Chennai', 6, 'software_technical') returning id`,
      [AE_USER],
    )
  )[0]?.id as string;

  round1 = (
    await t.sql(
      `insert into drive_rounds (drive_id, sequence, name) values ($1, 1, 'Aptitude') returning id`,
      [drive],
    )
  )[0]?.id as string;
  round2 = (
    await t.sql(
      `insert into drive_rounds (drive_id, sequence, name) values ($1, 2, 'Technical') returning id`,
      [drive],
    )
  )[0]?.id as string;

  priyaApp = (
    await t.sql(
      `insert into applications (drive_id, student_id, profile_snapshot)
       values ($1, $2, '{}'::jsonb) returning id`,
      [drive, ids.priya],
    )
  )[0]?.id as string;
});

describe("the advance waits for the round it leaves behind (0139)", () => {
  it("refuses to move students into Round 2 while Round 1 is still ahead", async () => {
    await schedule("now() + interval '8 days'", round1);

    await t.expectRejection(
      () =>
        t.asUser(ids.centralUser, `select schedule_round_participants($1, array[$2]::uuid[], $3)`, [
          round2,
          priyaApp,
          ids.centralUser,
        ]),
      /Round 1 \(Aptitude\) is scheduled for .* and has not been held yet/i,
    );

    // Refused means NOTHING was written — not participants without attendance.
    expect(
      await t.sql(`select id from round_participants where round_id = $1`, [round2]),
    ).toHaveLength(0);
    expect(await t.sql(`select id from attendance where round_id = $1`, [round2])).toHaveLength(0);
  });

  it("takes the same students the moment that round's own time has passed", async () => {
    await schedule("now() - interval '1 hour'", round1);

    await advanceInto(round2, priyaApp);

    const rows = await t.sql(
      `select status from attendance where round_id = $1 and application_id = $2`,
      [round2, priyaApp],
    );
    expect(rows[0]?.status).toBe("scheduled");
  });

  it("holds no round whose date nobody set", async () => {
    // Most drives predate `round_scheduled_at` (0053). An absent fact is not
    // evidence, so it must not become a lock the office cannot open.
    await schedule("null", round1);

    await t.sql(`delete from round_participants where round_id = $1`, [round2]);
    await t.sql(`delete from attendance where round_id = $1`, [round2]);
    await advanceInto(round2, priyaApp);

    expect(
      await t.sql(`select id from round_participants where round_id = $1`, [round2]),
    ).toHaveLength(1);
  });

  it("says the date in the calendar the placement office reads", async () => {
    await t.sql(`delete from round_participants where round_id = $1`, [round2]);
    await t.sql(`delete from attendance where round_id = $1`, [round2]);
    await schedule(`timestamptz '2031-08-27 14:00:00+05:30'`, round1);

    let message = "";
    try {
      await advanceInto(round2, priyaApp);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/27 Aug 2031, 2:00 PM/);
  });

  it("leaves Round 1 alone, because nothing comes before it", async () => {
    // The shortlist schedules into Round 1 by trigger (0043), and Round 2's own
    // date is nobody's business when the students are ARRIVING in it.
    await schedule("null", round1);
    await schedule("now() + interval '8 days'", round2);
    await t.sql(`delete from round_participants where round_id = $1`, [round1]);
    await t.sql(`delete from attendance where round_id = $1`, [round1]);

    await advanceInto(round1, priyaApp);

    expect(
      await t.sql(`select id from round_participants where round_id = $1`, [round1]),
    ).toHaveLength(1);
  });
});
