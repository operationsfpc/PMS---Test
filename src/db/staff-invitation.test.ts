import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Campus assignments made at invitation time.
 *
 * A profile does not exist until the invitee first signs in, so a campus
 * assignment chosen by the Admin has nowhere to live in the meantime. It is
 * staged against the invited email and applied by the same trigger that
 * materialises the profile - otherwise a CPC signs in successfully, is scoped
 * to no campus, and sees an empty application.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
}, 60_000);

describe("staged campus assignments", () => {
  it("applies the staged campuses when the invitee first signs in", async () => {
    await t.sql(
      `insert into staff_invitations (email, full_name, role)
       values ('newcpc@faceprep.in', 'New CPC', 'campus_placement_coordinator')`,
    );
    await t.sql(
      `insert into staff_campus_invitations (email, campus_id) values ('newcpc@faceprep.in', $1)`,
      [ids.campusB],
    );

    const userId = "30000000-0000-0000-0000-0000000000aa";
    await t.sql(`insert into auth.users (id, email) values ($1, 'newcpc@faceprep.in')`, [userId]);

    const assignments = await t.sql(
      `select campus_id from staff_campus_assignments where profile_id = $1`,
      [userId],
    );
    expect(assignments.map((a) => a.campus_id)).toEqual([ids.campusB]);
  });

  it("still creates the profile when no campus was staged", async () => {
    await t.sql(
      `insert into staff_invitations (email, full_name, role)
       values ('lonead@faceprep.in', 'Lone AE', 'account_executive')`,
    );

    const userId = "30000000-0000-0000-0000-0000000000bb";
    await t.sql(`insert into auth.users (id, email) values ($1, 'lonead@faceprep.in')`, [userId]);

    const profiles = await t.sql(`select role from profiles where id = $1`, [userId]);
    expect(profiles[0]?.role).toBe("account_executive");
  });

  it("keeps a staged assignment pointing at a real campus", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into staff_campus_invitations (email, campus_id)
           values ('ghost@faceprep.in', gen_random_uuid())`,
        ),
      /foreign key|violates/i,
    );
  });

  it("is not writable by a student", async () => {
    await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [
      ids.priyaUser,
    ]);
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into staff_campus_invitations (email, campus_id) values ('x@y.com', $1)`,
          [ids.campusA],
        ),
      /permission denied|row-level security|violates/i,
    );
  });
});
