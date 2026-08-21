import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * `0057` — 21/08 batches B & C:
 *
 * B2: a round with recorded facts can be neither renamed nor removed — the
 *     0055 freeze extended to a round's name and existence. An untouched
 *     round can be both, and removal renumbers in the repository.
 * C6: marking a student absent writes them an in-app notification, once —
 *     never on re-save, never to an opted-out student.
 * C3: drives.completed_reason exists for the early-completion audit trail.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const AE_USER = "65000000-0000-0000-0000-000000000001";

let drive: string;
let touchedRound: string;
let untouchedRound: string;
let priyaApp: string;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-0057@faceprep.in','AE 0057','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-0057@faceprep.in')`, [AE_USER]);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);

  drive = (
    await t.sql(
      `insert into drives (company_name, created_by, status, drive_type, offer_category,
                           application_start, application_end, role_title, job_description,
                           work_locations, ctc_min_lpa, role_category)
       values ('Deloitte', $1, 'in_rounds', 'placement', 'regular',
               '2026-08-01T00:00:00Z', '2036-08-31T00:00:00Z', 'Associate', 'Advise',
               'Chennai', 4.5, 'operations_business') returning id`,
      [AE_USER],
    )
  )[0]?.id as string;

  touchedRound = (
    await t.sql(
      `insert into drive_rounds (drive_id, sequence, name) values ($1, 1, 'Aptitude') returning id`,
      [drive],
    )
  )[0]?.id as string;
  untouchedRound = (
    await t.sql(
      `insert into drive_rounds (drive_id, sequence, name) values ($1, 2, 'HR') returning id`,
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

  // The FACT that freezes round 1: Priya is scheduled into it.
  await t.sql(`insert into round_participants (round_id, application_id) values ($1, $2)`, [
    touchedRound,
    priyaApp,
  ]);
}, 60_000);

describe("B2 — renaming and removing rounds", () => {
  it("renames an untouched round", async () => {
    await t.sql(`update drive_rounds set name = 'HR discussion' where id = $1`, [untouchedRound]);
    const [row] = await t.sql(`select name from drive_rounds where id = $1`, [untouchedRound]);
    expect(row?.name).toBe("HR discussion");
  });

  it("refuses to rename a round students are scheduled into", async () => {
    await t.expectRejection(
      () => t.sql(`update drive_rounds set name = 'Renamed' where id = $1`, [touchedRound]),
      /cannot be renamed.*scheduled/i,
    );
  });

  it("refuses to remove it, and names the strongest fact", async () => {
    await t.sql(
      `insert into round_results (round_id, application_id, result)
       values ($1, $2, 'selected')`,
      [touchedRound, priyaApp],
    );
    await t.expectRejection(
      () => t.sql(`delete from drive_rounds where id = $1`, [touchedRound]),
      /cannot be removed.*results/i,
    );
  });

  it("still allows renumbering a frozen round — removal elsewhere must close gaps", async () => {
    await t.sql(`update drive_rounds set sequence = 5 where id = $1`, [touchedRound]);
    const [row] = await t.sql(`select sequence from drive_rounds where id = $1`, [touchedRound]);
    expect(Number(row?.sequence)).toBe(5);
    await t.sql(`update drive_rounds set sequence = 1 where id = $1`, [touchedRound]);
  });

  it("removes an untouched round entirely", async () => {
    const doomed = (
      await t.sql(
        `insert into drive_rounds (drive_id, sequence, name) values ($1, 3, 'Doomed') returning id`,
        [drive],
      )
    )[0]?.id as string;
    await t.sql(`delete from drive_rounds where id = $1`, [doomed]);
    const rows = await t.sql(`select id from drive_rounds where id = $1`, [doomed]);
    expect(rows).toHaveLength(0);
  });
});

describe("C6 — the absent alert", () => {
  const absentAlerts = () =>
    t.sql(`select title, body from notifications where student_id = $1 and kind = 'absent'`, [
      ids.priya,
    ]);

  it("notifies the student the moment they are marked absent", async () => {
    await t.sql(
      `insert into attendance (round_id, application_id, status) values ($1, $2, 'scheduled')`,
      [touchedRound, priyaApp],
    );
    expect(await absentAlerts()).toHaveLength(0);

    await t.sql(
      `update attendance set status = 'absent' where round_id = $1 and application_id = $2`,
      [touchedRound, priyaApp],
    );

    const alerts = await absentAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.title).toMatch(/absent.*Deloitte/i);
    expect(alerts[0]?.body).toMatch(/Aptitude/);
  });

  it("does not notify again when the absent row is merely re-saved", async () => {
    await t.sql(
      `update attendance set status = 'absent' where round_id = $1 and application_id = $2`,
      [touchedRound, priyaApp],
    );
    expect(await absentAlerts()).toHaveLength(1);
  });

  it("never notifies an opted-out student (D7)", async () => {
    await t.sql(`update students set participation_status = 'opted_out' where id = $1`, [
      ids.arjun,
    ]);
    const app = (
      await t.sql(
        `insert into applications (drive_id, student_id, profile_snapshot)
         values ($1, $2, '{}'::jsonb) returning id`,
        [drive, ids.arjun],
      )
    )[0]?.id as string;
    await t.sql(
      `insert into attendance (round_id, application_id, status) values ($1, $2, 'absent')`,
      [untouchedRound, app],
    );
    const rows = await t.sql(
      `select id from notifications where student_id = $1 and kind = 'absent'`,
      [ids.arjun],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("C3 — the early-completion reason", () => {
  it("exists, nullable, and holds the typed reason", async () => {
    await t.sql(
      `update drives set status = 'completed',
              completed_reason = 'Company closed the process after Round 1' where id = $1`,
      [drive],
    );
    const [row] = await t.sql(`select status, completed_reason from drives where id = $1`, [drive]);
    expect(row?.status).toBe("completed");
    expect(row?.completed_reason).toMatch(/closed the process/);
  });
});
