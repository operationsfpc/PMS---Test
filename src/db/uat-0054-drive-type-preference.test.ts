import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * `0054` — UAT 2026-08-19:
 *
 * D1: students declare which DRIVE TYPES they want (placement / internship /
 *     convertible), and the apply gate holds them to it the same way it holds
 *     the role-category area — a preference below R5a's override, where an
 *     empty list means "no opinion", never "nothing".
 *
 * F6: a round's schedule reaches its participants as a notification, and a
 *     per-student meeting link reaches THAT student.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const AE_USER = "62000000-0000-0000-0000-000000000001";

let seq = 0;
async function makeDrive(over: Partial<Record<string, unknown>> = {}): Promise<string> {
  seq += 1;
  const defaults: Record<string, unknown> = {
    company_name: `Pref Drive ${seq}`,
    created_by: AE_USER,
    status: "live",
    drive_type: "placement",
    offer_category: "dream",
    application_start: "2026-08-01T00:00:00Z",
    application_end: "2036-08-31T00:00:00Z",
    open_to_all_override: false,
    role_title: "Engineer",
    job_description: "Build things",
    work_locations: "Chennai",
    ctc_min_lpa: 6,
    role_category: "software_technical",
  };
  const row = { ...defaults, ...over };
  const cols = Object.keys(row);
  const inserted = await t.sql(
    `insert into drives (${cols.join(",")})
     values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    Object.values(row),
  );
  return inserted[0]?.id as string;
}

const applyAs = (driveId: string) =>
  t.asUser(
    ids.priyaUser,
    `insert into applications (drive_id, student_id, profile_snapshot)
     values ($1, $2, '{}'::jsonb) returning id`,
    [driveId, ids.priya],
  );

const setPreferences = (prefs: readonly string[]) =>
  t.sql(`update students set drive_type_preferences = $1::drive_type[] where id = $2`, [
    `{${prefs.join(",")}}`,
    ids.priya,
  ]);

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-pref@faceprep.in','AE Pref','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-pref@faceprep.in')`, [AE_USER]);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
}, 60_000);

describe("D1 — the drive-type preference gate", () => {
  it("defaults to an empty list, which is 'no opinion' — every type open", async () => {
    const [row] = await t.sql(`select drive_type_preferences from students where id = $1`, [
      ids.priya,
    ]);
    // PGlite hands an enum[] back in its text form.
    expect(String(row?.drive_type_preferences)).toBe("{}");

    const drive = await makeDrive();
    expect(await applyAs(drive)).toHaveLength(1);
  });

  it("refuses a drive whose type the student did not ask for", async () => {
    await setPreferences(["internship"]);
    const drive = await makeDrive({ drive_type: "placement" });
    await t.expectRejection(() => applyAs(drive), /drive type/i);
    await setPreferences([]);
  });

  it("accepts a drive whose type IS among the preferences", async () => {
    await setPreferences(["placement", "internship_convertible"]);
    const drive = await makeDrive({ drive_type: "placement" });
    expect(await applyAs(drive)).toHaveLength(1);
    await setPreferences([]);
  });

  it("the R5a override bypasses the preference — it is below the line", async () => {
    await setPreferences(["internship"]);
    const drive = await makeDrive({
      drive_type: "placement",
      open_to_all_override: true,
      open_to_all_reason: "High-brand drive — client asked for the full cohort",
    });
    expect(await applyAs(drive)).toHaveLength(1);
    await setPreferences([]);
  });

  it("the student updates their OWN preferences (D3 — no approval needed)", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `update students set drive_type_preferences = '{internship}'::drive_type[]
        where id = $1 returning drive_type_preferences`,
      [ids.priya],
    );
    expect(String(rows[0]?.drive_type_preferences)).toBe("{internship}");
    await setPreferences([]);
  });
});

describe("F6 — the round's schedule reaches the student", () => {
  async function roundWithParticipant() {
    const drive = await makeDrive();
    const [round] = await t.sql(
      `insert into drive_rounds (drive_id, sequence, name) values ($1, 1, 'Interview') returning id`,
      [drive],
    );
    const [app] = await applyAs(drive);
    await t.sql(`insert into round_participants (round_id, application_id) values ($1, $2)`, [
      round?.id,
      app?.id,
    ]);
    return { roundId: round?.id as string, applicationId: app?.id as string };
  }

  const notesFor = (kind: string) =>
    t.sql(`select title, body from notifications where student_id = $1 and kind = $2`, [
      ids.priya,
      kind,
    ]);

  it("notifies every participant when the round's details change", async () => {
    const { roundId } = await roundWithParticipant();
    await t.sql(
      `update drive_rounds
          set round_mode = 'virtual', round_scheduled_at = '2026-09-01T05:00:00Z',
              round_interview_link = 'https://meet.google.com/shared'
        where id = $1`,
      [roundId],
    );

    const notes = await notesFor("round_scheduled");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.at(-1)?.body).toMatch(/virtual/i);
    expect(notes.at(-1)?.body).toMatch(/meet\.google\.com\/shared/);
  });

  it("says nothing when an unrelated column changes", async () => {
    const { roundId } = await roundWithParticipant();
    const before = (await notesFor("round_scheduled")).length;
    await t.sql(`update drive_rounds set name = 'Renamed Interview' where id = $1`, [roundId]);
    expect((await notesFor("round_scheduled")).length).toBe(before);
  });

  it("sends the student THEIR link when one is assigned", async () => {
    const { roundId, applicationId } = await roundWithParticipant();
    await t.sql(
      `update round_participants
          set meeting_link = 'https://meet.google.com/priya-own',
              participant_scheduled_at = '2026-09-01T05:30:00Z'
        where round_id = $1 and application_id = $2`,
      [roundId, applicationId],
    );

    const notes = await notesFor("meeting_link");
    expect(notes.at(-1)?.body).toMatch(/meet\.google\.com\/priya-own/);
  });

  it("never notifies an opted-out student", async () => {
    const { roundId } = await roundWithParticipant();
    await t.sql(`update students set participation_status = 'opted_out' where id = $1`, [
      ids.priya,
    ]);
    const before = (await notesFor("round_scheduled")).length;

    await t.sql(`update drive_rounds set round_mode = 'on_campus' where id = $1`, [roundId]);

    expect((await notesFor("round_scheduled")).length).toBe(before);
    // opting out is irreversible (0009) — this student stays opted out; the
    // earlier tests already ran, so nothing else needs her active again.
  });
});
