import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

/**
 * Runs the real migrations against real PostgreSQL (PGlite, WASM).
 *
 * No Docker required, so the schema is verified on every `pnpm test` rather
 * than being hoped-at until deploy day.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = join(ROOT, "supabase/migrations");
const SHIM = join(ROOT, "supabase/local/00_supabase_shim.sql");

export interface TestDb {
  readonly db: PGlite;
  /** Run SQL as the Postgres superuser, bypassing RLS. */
  sql(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Run SQL as an authenticated end user, with RLS enforced. */
  asUser(
    userId: string | null,
    query: string,
    params?: unknown[],
  ): Promise<Record<string, unknown>[]>;
  expectRejection(fn: () => Promise<unknown>, matching: RegExp): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create();

  await db.exec(readFileSync(SHIM, "utf8"));
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith(".sql")) continue;
    try {
      await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  const sql = async (query: string, params: unknown[] = []) =>
    (await db.query(query, params)).rows as Record<string, unknown>[];

  const asUser = async (userId: string | null, query: string, params: unknown[] = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    try {
      return (await db.query(query, params)).rows as Record<string, unknown>[];
    } finally {
      await db.exec("reset role");
    }
  };

  const expectRejection = async (fn: () => Promise<unknown>, matching: RegExp): Promise<void> => {
    let message: string | undefined;
    try {
      await fn();
    } catch (error) {
      message = (error as Error).message;
    }
    if (message === undefined) {
      throw new Error(`Expected the database to reject this, but it succeeded. (${matching})`);
    }
    if (!matching.test(message)) {
      throw new Error(`Expected rejection matching ${matching}, got: ${message}`);
    }
  };

  return { db, sql, asUser, expectRejection };
}

/** A minimal but complete world: campus, degree, staff, and two students. */
export async function seed(t: TestDb) {
  const ids = {
    campusA: "10000000-0000-0000-0000-000000000001",
    campusB: "10000000-0000-0000-0000-000000000002",
    degree: "20000000-0000-0000-0000-000000000001",
    branch: "20000000-0000-0000-0000-000000000002",
    cpcUser: "30000000-0000-0000-0000-000000000001",
    adminUser: "30000000-0000-0000-0000-000000000002",
    centralUser: "30000000-0000-0000-0000-000000000003",
    priyaUser: "40000000-0000-0000-0000-000000000001",
    arjunUser: "40000000-0000-0000-0000-000000000002",
    priya: "50000000-0000-0000-0000-000000000001",
    arjun: "50000000-0000-0000-0000-000000000002",
  };

  await t.sql(
    `insert into campuses (id, name, city) values ($1,'Alliance University','Chennai'), ($2,'VIT Bangalore','Bengaluru')`,
    [ids.campusA, ids.campusB],
  );
  await t.sql(`insert into degrees (id, name) values ($1, 'B.E')`, [ids.degree]);
  await t.sql(`insert into branches (id, degree_id, name) values ($1, $2, 'CSE')`, [
    ids.branch,
    ids.degree,
  ]);

  // Invite staff, then sign them in. The invitation is the allowlist entry and
  // the profile row is materialised by the accept_staff_invitation trigger --
  // exactly the path a real staff member takes.
  for (const [uid, email, name, role] of [
    [ids.cpcUser, "cpc@faceprep.in", "CPC One", "campus_placement_coordinator"],
    [ids.adminUser, "admin@faceprep.in", "Admin", "admin"],
    [ids.centralUser, "central@faceprep.in", "Central CPC", "central_placement_coordinator"],
  ] as const) {
    await t.sql(
      `insert into staff_invitations (email, full_name, role) values ($1,$2,$3::app_role)
       on conflict (email) do nothing`,
      [email, name, role],
    );
    await t.sql(`insert into auth.users (id, email) values ($1, $2)`, [uid, email]);
  }

  await t.sql(`insert into staff_campus_assignments (profile_id, campus_id) values ($1, $2)`, [
    ids.cpcUser,
    ids.campusA,
  ]);

  await t.sql(
    `insert into students (id, campus_id, degree_id, branch_id, roll_number, full_name, email, passing_year, srf_status, overall_cgpa, consent_given_at)
     values
       ($1,$3,$4,$5,'21CSE1042','Priya Ramesh','priya@gmail.com',2026,'srf_approved',8.24, now()),
       ($2,$6,$4,$5,'21CSE9001','Arjun Menon','arjun@gmail.com',2026,'srf_approved',7.10, now())`,
    [ids.priya, ids.arjun, ids.campusA, ids.degree, ids.branch, ids.campusB],
  );

  return ids;
}
