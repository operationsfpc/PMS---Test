import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * The organisation hierarchy: City -> Campus -> Degree -> Branch.
 *
 * Confirmed 2026-08-02: city is a real table (not free text on the campus),
 * campuses carry a complete mandatory identity, and nothing here is ever
 * deleted - only deactivated, because a campus has students, applications and
 * offers hanging off it.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
}, 60_000);

describe("cities are a first-class table", () => {
  it("carries the state, so it is stored once and cannot drift", async () => {
    const rows = await t.sql(`select state from cities where name = 'Chennai'`);
    expect(rows[0]?.state).toBe("Tamil Nadu");
  });

  it("refuses two cities with the same name", async () => {
    await t.expectRejection(
      () => t.sql(`insert into cities (name, state) values ('Chennai', 'Tamil Nadu')`),
      /duplicate key|unique/i,
    );
  });

  it("refuses a campus that points at no real city", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into campuses (name, city_id, code, address,
                                 primary_contact_name, primary_contact_email, primary_contact_phone)
           values ('Ghost College', gen_random_uuid(), 'GHOST', '1 Nowhere Rd',
                   'A B', 'ab@x.com', '9000000000')`,
        ),
      /foreign key|violates/i,
    );
  });
});

describe("a campus identity is complete and mandatory", () => {
  it("refuses a campus with no primary contact", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into campuses (name, city_id, code, address)
           select 'No Contact College', id, 'NOCON', '2 Somewhere Rd' from cities limit 1`,
        ),
      /null value|not-null/i,
    );
  });

  it("refuses a duplicate campus code", async () => {
    await t.sql(
      `insert into campuses (name, city_id, code, address,
                             primary_contact_name, primary_contact_email, primary_contact_phone)
       select 'First College', id, 'DUP1', '3 Road', 'A B', 'ab@x.com', '9000000001' from cities limit 1`,
    );
    await t.expectRejection(
      () =>
        t.sql(
          `insert into campuses (name, city_id, code, address,
                                 primary_contact_name, primary_contact_email, primary_contact_phone)
           select 'Second College', id, 'DUP1', '4 Road', 'C D', 'cd@x.com', '9000000002' from cities limit 1`,
        ),
      /duplicate key|unique/i,
    );
  });
});

describe("deactivate, never delete", () => {
  it("starts campuses and branches active", async () => {
    const campus = await t.sql(`select is_active from campuses where id = $1`, [ids.campusA]);
    const branch = await t.sql(`select is_active from branches where id = $1`, [ids.branch]);
    expect(campus[0]?.is_active).toBe(true);
    expect(branch[0]?.is_active).toBe(true);
  });

  it("denies deleting a campus to every signed-in user", async () => {
    await t.expectRejection(
      () => t.asUser(ids.adminUser, `delete from campuses where id = $1`, [ids.campusA]),
      /permission denied|denied for table/i,
    );
  });
});

/**
 * Privilege escalation.
 *
 * 0008 grants insert+update on EVERY table to `authenticated`, but only nine
 * tables have RLS enabled. staff_invitations is the allowlist: a row in it is
 * an account waiting to happen, and accept_staff_invitation (0009) turns it
 * into a profile with that role on first sign-in. An unguarded insert there is
 * therefore a straight path from student to admin.
 */
describe("reference and identity tables reject student writes", () => {
  it("stops a student inviting themselves as an admin", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into staff_invitations (email, full_name, role)
           values ('attacker@gmail.com', 'Attacker', 'admin')`,
        ),
      /permission denied|row-level security|violates/i,
    );
  });

  it("stops a student creating a campus", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into campuses (name, city_id, code, address,
                                 primary_contact_name, primary_contact_email, primary_contact_phone)
           select 'Fake College', id, 'FAKE', '5 Road', 'E F', 'ef@x.com', '9000000003' from cities limit 1`,
        ),
      /permission denied|row-level security|violates/i,
    );
  });

  /**
   * Asserted as "the value does not change", not "it throws".
   *
   * Postgres treats the two verbs differently: an INSERT that violates WITH
   * CHECK raises, but an UPDATE filtered by USING simply matches no rows and
   * reports success. Asserting the exception would be asserting the mechanism;
   * what actually protects the student is that the number stays 3.
   */
  it("stops a student relaxing the absence limit", async () => {
    await t.asUser(ids.priyaUser, `update settings set value = '99' where key = 'absence_limit'`);

    // settings.value is jsonb, so this comes back as a JSON number.
    const rows = await t.sql(`select value from settings where key = 'absence_limit'`);
    expect(rows[0]?.value).toBe(3);
  });

  /**
   * The shortest path of all: profiles.id references auth.users(id), and a
   * signed-in student already owns an auth.users row. Writing their own id in
   * with role 'admin' skips the invitation round-trip entirely.
   */
  it("stops a student writing themselves a profile with an admin role", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into profiles (id, email, full_name, role)
           values ($1, 'priya@gmail.com', 'Priya Ramesh', 'admin')`,
          [ids.priyaUser],
        ),
      /permission denied|row-level security|violates/i,
    );
  });

  it("stops a student granting themselves a campus assignment", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into staff_campus_assignments (profile_id, campus_id) values ($1, $2)`,
          [ids.cpcUser, ids.campusB],
        ),
      /permission denied|row-level security|violates/i,
    );
  });
});
