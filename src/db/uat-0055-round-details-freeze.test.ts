import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * `0055` — UAT 2026-08-20, G6c (Q5 answer a): a round's details — mode, time,
 * link, venue — freeze the moment participation is a RECORDED fact: attendance
 * marked present or absent, or a result declared. The UI refuses first
 * (`roundDetailsFrozen`); this trigger is the far side of that pair, because a
 * rule enforced only in the browser is a suggestion.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
}, 60_000);

async function roundWithParticipant() {
  // 'draft' keeps the fixture clear of live_requires_complete_record — the
  // freeze cares about the ROUND's recorded facts, not the drive's status.
  const [drive] = await t.sql(
    `insert into drives (company_name, status) values ('Freeze Co', 'draft') returning id`,
  );
  const [round] = await t.sql(
    `insert into drive_rounds (drive_id, sequence, name) values ($1, 1, 'Aptitude') returning id`,
    [drive?.id],
  );
  const [application] = await t.sql(
    `insert into applications (drive_id, student_id, profile_snapshot)
     values ($1, $2, '{}'::jsonb) returning id`,
    [drive?.id, ids.priya],
  );
  await t.sql(`insert into round_participants (round_id, application_id) values ($1, $2)`, [
    round?.id,
    application?.id,
  ]);
  await t.sql(
    `insert into attendance (round_id, application_id, status) values ($1, $2, 'scheduled')`,
    [round?.id, application?.id],
  );
  return { roundId: round?.id as string, applicationId: application?.id as string };
}

const setDetails = (roundId: string) =>
  t.sql(`update drive_rounds set round_mode = 'on_campus', venue = 'Main block' where id = $1`, [
    roundId,
  ]);

describe("round details freeze once participation is recorded (0055)", () => {
  it("stays editable while everyone is merely scheduled", async () => {
    const { roundId } = await roundWithParticipant();
    await setDetails(roundId);

    const [row] = await t.sql(`select venue from drive_rounds where id = $1`, [roundId]);
    expect(row?.venue).toBe("Main block");
  });

  it("refuses a detail change once attendance is marked present", async () => {
    const { roundId, applicationId } = await roundWithParticipant();
    await t.sql(
      `update attendance set status = 'present' where round_id = $1 and application_id = $2`,
      [roundId, applicationId],
    );

    await expect(setDetails(roundId)).rejects.toThrow(/locked|begun participating/i);
  });

  it("refuses a detail change once a result is declared", async () => {
    const { roundId, applicationId } = await roundWithParticipant();
    await t.sql(
      `insert into round_results (round_id, application_id, result) values ($1, $2, 'selected')`,
      [roundId, applicationId],
    );

    await expect(setDetails(roundId)).rejects.toThrow(/locked|begun participating/i);
  });

  it("does not freeze on a provisional self check-in — nobody has confirmed it", async () => {
    const { roundId, applicationId } = await roundWithParticipant();
    await t.sql(
      `update attendance set status = 'provisional' where round_id = $1 and application_id = $2`,
      [roundId, applicationId],
    );

    await setDetails(roundId);
    const [row] = await t.sql(`select venue from drive_rounds where id = $1`, [roundId]);
    expect(row?.venue).toBe("Main block");
  });

  it("still accepts the advance proof — the advance is exactly when results exist", async () => {
    const { roundId, applicationId } = await roundWithParticipant();
    await t.sql(
      `insert into round_results (round_id, application_id, result) values ($1, $2, 'selected')`,
      [roundId, applicationId],
    );

    await t.sql(`update drive_rounds set advance_proof_path = 'r/proof.pdf' where id = $1`, [
      roundId,
    ]);
    const [row] = await t.sql(`select advance_proof_path from drive_rounds where id = $1`, [
      roundId,
    ]);
    expect(row?.advance_proof_path).toBe("r/proof.pdf");
  });
});
