import { DEFAULT_SKILL_AREAS } from "@domain/skills";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0037 — the Central Student Skill Repository (PRD §5).
 *
 * Institutional scores per student, maintained by the Central CPC, later fed
 * into shortlisting. Two tables: `skill_areas` (the catalogue, seeded with
 * the areas asked for on 2026-08-06) and `student_skill_scores` (one score
 * per student per area).
 *
 * The RLS matters more than the shape: these are internal assessments that
 * feed an internal shortlist, so a student must never read them — a visible
 * "GitHub strength 34" would leak the institution's private evaluation.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let aptitudeId: string;

const areaId = async (name: string) =>
  (await t.sql(`select id from skill_areas where name = $1`, [name]))[0]?.id as string;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  // current_student_id() maps auth.uid() to the student row.
  await t.sql(`insert into auth.users (id, email) values ($1, 'priya@gmail.com')`, [ids.priyaUser]);
  aptitudeId = await areaId("Aptitude");
}, 60_000);

describe("0037 — skill areas", () => {
  it("is seeded with every default area", async () => {
    const rows = await t.sql(`select name from skill_areas order by name`);
    expect(rows.map((r) => r.name).sort()).toEqual([...DEFAULT_SKILL_AREAS].sort());
  });

  it("refuses a duplicate name, however cased or spaced", async () => {
    await t.expectRejection(
      () => t.sql(`insert into skill_areas (name) values ('  APTITUDE ')`),
      /one_skill_area_per_name|duplicate key/i,
    );
  });

  it("refuses a blank name", async () => {
    await t.expectRejection(
      () => t.sql(`insert into skill_areas (name) values ('   ')`),
      /skill_area_has_a_name/i,
    );
  });

  it("lets the Central CPC add an area", async () => {
    await t.asUser(ids.centralUser, `insert into skill_areas (name) values ('Cloud fundamentals')`);
    expect(await areaId("Cloud fundamentals")).toBeDefined();
  });

  it("refuses an area added by a campus CPC", async () => {
    await t.expectRejection(
      () => t.asUser(ids.cpcUser, `insert into skill_areas (name) values ('Juggling')`),
      /row-level security/i,
    );
  });

  it("is readable by campus staff — they see the same columns the Central CPC scores", async () => {
    const rows = await t.asUser(ids.cpcUser, `select name from skill_areas`);
    expect(rows.length).toBeGreaterThanOrEqual(DEFAULT_SKILL_AREAS.length);
  });
});

describe("0037 — student skill scores", () => {
  it("lets the Central CPC record a score for a student", async () => {
    await t.asUser(
      ids.centralUser,
      `insert into student_skill_scores (student_id, skill_area_id, score, recorded_by)
       values ($1, $2, 4, $3)`,
      [ids.priya, await areaId("Aptitude"), ids.centralUser],
    );

    const [row] = await t.sql(`select score from student_skill_scores where student_id = $1`, [
      ids.priya,
    ]);
    expect(Number(row?.score)).toBe(4);
  });

  it("updates in place: one score per student per area", async () => {
    await t.asUser(
      ids.centralUser,
      `insert into student_skill_scores (student_id, skill_area_id, score, recorded_by)
       values ($1, $2, 5, $3)
       on conflict (student_id, skill_area_id)
       do update set score = excluded.score, recorded_by = excluded.recorded_by`,
      [ids.priya, await areaId("Aptitude"), ids.centralUser],
    );

    const rows = await t.sql(`select score from student_skill_scores where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.score)).toBe(5);
  });

  it("refuses a score outside 1–5 — 0052, Karthik's '1-5 SCALE' (2026-08-19)", async () => {
    for (const bad of [0, 6, 85]) {
      await t.expectRejection(
        () =>
          t.sql(
            `insert into student_skill_scores (student_id, skill_area_id, score)
             values ($1, $2, $3)`,
            [ids.arjun, aptitudeId, bad],
          ),
        /score_within_scale/i,
      );
    }
  });

  it("refuses a half-point — the 5-point scale is whole numbers (0052)", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into student_skill_scores (student_id, skill_area_id, score)
           values ($1, $2, 3.5)`,
          [ids.arjun, aptitudeId],
        ),
      /score_within_scale/i,
    );
  });

  it("refuses a write from a campus CPC — the repository is the Central CPC's", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.cpcUser,
          `insert into student_skill_scores (student_id, skill_area_id, score, recorded_by)
           values ($1, $2, 3, $3)`,
          [ids.priya, aptitudeId, ids.cpcUser],
        ),
      /row-level security/i,
    );
  });

  it("is invisible to the student it scores — an internal assessment stays internal", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `select * from student_skill_scores where student_id = $1`,
      [ids.priya],
    );
    expect(rows).toEqual([]);
  });

  it("cannot be written by the student either", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into student_skill_scores (student_id, skill_area_id, score)
           values ($1, $2, 100)`,
          [ids.priya, aptitudeId],
        ),
      /row-level security/i,
    );
  });

  it("is readable by the campus CPC for their own campus's students", async () => {
    const rows = await t.asUser(ids.cpcUser, `select student_id, score from student_skill_scores`);
    // Priya is on campus A (the CPC's); every returned row must be theirs.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.student_id === ids.priya)).toBe(true);
  });

  it("lets the Central CPC clear a score outright", async () => {
    await t.asUser(
      ids.centralUser,
      `delete from student_skill_scores where student_id = $1 and skill_area_id = $2`,
      [ids.priya, await areaId("Aptitude")],
    );
    const rows = await t.sql(`select 1 from student_skill_scores where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows).toEqual([]);
  });

  it("audits every write — these scores decide shortlists", async () => {
    const [row] = await t.sql(
      `select count(*)::int as entries from audit_log where entity_table = 'student_skill_scores'`,
    );
    expect(Number(row?.entries)).toBeGreaterThan(0);
  });

  it("deleting a skill area does not orphan scores silently — it takes them along", async () => {
    const cloudId = await areaId("Cloud fundamentals");
    await t.asUser(
      ids.centralUser,
      `insert into student_skill_scores (student_id, skill_area_id, score, recorded_by)
       values ($1, $2, 2, $3)`,
      [ids.arjun, cloudId, ids.centralUser],
    );
    await t.sql(`delete from skill_areas where id = $1`, [cloudId]);
    const rows = await t.sql(`select 1 from student_skill_scores where skill_area_id = $1`, [
      cloudId,
    ]);
    expect(rows).toEqual([]);
  });
});
