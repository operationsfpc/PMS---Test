import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0058 — the AE reads the assessed-skills catalogue.
 *
 * Spec 2026-08-21 part A, approved 2026-08-24: the PIF's mandatory skills are
 * picked from `skill_areas`, so the AE must be able to read the NAMES. The
 * student SCORES stay exactly as private as 0037 made them — an AE reading
 * "GitHub strength 2" would leak the institution's evaluation to the person
 * talking to recruiters.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let aeUser: string;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  aeUser = "30000000-0000-0000-0000-0000000000ae";
  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-skills@faceprep.in','Skills AE','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-skills@faceprep.in')`, [aeUser]);
}, 60_000);

describe("0058 — the AE and the skill catalogue", () => {
  it("lets the AE read the catalogue names", async () => {
    const rows = await t.asUser(aeUser, `select name from skill_areas order by name`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("still refuses the AE a student's scores", async () => {
    await t.asUser(
      ids.centralUser,
      `insert into student_skill_scores (student_id, skill_area_id, score, recorded_by)
       select $1, id, 3, $2 from skill_areas limit 1`,
      [ids.priya, ids.centralUser],
    );

    const rows = await t.asUser(aeUser, `select * from student_skill_scores`);
    expect(rows).toHaveLength(0);
  });

  it("still refuses the AE any change to the catalogue", async () => {
    await t.expectRejection(
      () => t.asUser(aeUser, `insert into skill_areas (name) values ('Juggling')`),
      /row-level security/i,
    );
  });
});
