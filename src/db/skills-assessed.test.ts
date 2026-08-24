import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0059 — Skills assessed (2026-08-24, answer 1a).
 *
 * Renaming a skill is allowed — scores follow the row. Removing one is
 * refused while any score exists under it: 0037's ON DELETE CASCADE meant a
 * single delete silently destroyed every evaluation recorded under that
 * skill, which is exactly what the repository exists to keep.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const areaId = async (name: string) =>
  (await t.sql(`select id from skill_areas where name = $1`, [name]))[0]?.id as string;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
}, 60_000);

describe("0059 — removing an assessed skill", () => {
  it("lets the Central CPC rename a skill; the scores follow it", async () => {
    await t.asUser(
      ids.centralUser,
      `insert into student_skill_scores (student_id, skill_area_id, score, recorded_by)
       values ($1, $2, 4, $3)`,
      [ids.priya, await areaId("Aptitude"), ids.centralUser],
    );

    await t.asUser(
      ids.centralUser,
      `update skill_areas set name = 'Aptitude and reasoning'
       where id = $1`,
      [await areaId("Aptitude")],
    );

    const rows = await t.sql(
      `select count(*)::int as n from student_skill_scores where skill_area_id = $1`,
      [await areaId("Aptitude and reasoning")],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("refuses to remove a skill that has scores under it", async () => {
    await t.expectRejection(
      () =>
        t.asUser(ids.centralUser, `delete from skill_areas where name = 'Aptitude and reasoning'`),
      /foreign key|violates/i,
    );
  });

  it("removes a skill nobody has been scored on", async () => {
    await t.asUser(ids.centralUser, `insert into skill_areas (name) values ('Juggling')`);
    await t.asUser(ids.centralUser, `delete from skill_areas where name = 'Juggling'`);
    const rows = await t.sql(`select 1 from skill_areas where name = 'Juggling'`);
    expect(rows).toHaveLength(0);
  });
});
