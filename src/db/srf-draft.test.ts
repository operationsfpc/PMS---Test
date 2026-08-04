import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Saving the registration form as a draft.
 *
 * UAT 2026-08-05: "the registration form does not save the student's progress
 * as a draft... so students can continue the registration later without losing
 * their data."
 *
 * The draft is the student's own working copy, so it is stored on their row
 * and governed by the policies that already protect it: their own to write,
 * nobody else's to read. It deliberately holds no authority - eligibility
 * never reads it, and submitting is still what moves the form forward.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [ids.arjunUser]);
}, 60_000);

describe("a student's draft", () => {
  it("is theirs to save", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `update students set srf_draft = $2, srf_draft_saved_at = now()
        where auth_user_id = $1 returning srf_draft`,
      [ids.priyaUser, JSON.stringify({ mobile: "9876543210", semesters: [{ cgpa: 8.2 }] })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.srf_draft).toMatchObject({ mobile: "9876543210" });
  });

  it("survives being read back, so the student resumes where they left off", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `select srf_draft, srf_draft_saved_at from students`,
    );

    expect(rows[0]?.srf_draft).toMatchObject({ semesters: [{ cgpa: 8.2 }] });
    expect(rows[0]?.srf_draft_saved_at).not.toBeNull();
  });

  it("is invisible to every other student", async () => {
    const rows = await t.asUser(ids.arjunUser, `select srf_draft from students`);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.srf_draft).toBeNull();
  });

  it("cannot be written to another student's row", async () => {
    const rows = await t.asUser(
      ids.arjunUser,
      `update students set srf_draft = '{"mobile":"0000000000"}'::jsonb
        where id = $1 returning id`,
      [ids.priya],
    );

    expect(rows).toHaveLength(0);
  });

  /**
   * The draft is a convenience, never a credential. A student who could smuggle
   * an approval into it would have found a way around verification entirely.
   */
  it("does not let a draft carry the student past verification", async () => {
    // The seed leaves her approved; an approved student self-approving is a
    // no-op, not an escalation. Put her back where a real attacker would be.
    await t.sql(`update students set srf_status = 'registered' where id = $1`, [ids.priya]);

    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `update students set srf_draft = '{}'::jsonb, srf_status = 'srf_approved'
            where auth_user_id = $1`,
          [ids.priyaUser],
        ),
      /placement coordinator/i,
    );
  });

  it("is visible to the coordinator who has to help when a student is stuck", async () => {
    const rows = await t.asUser(ids.cpcUser, `select srf_draft from students where id = $1`, [
      ids.priya,
    ]);

    expect(rows[0]?.srf_draft).not.toBeNull();
  });
});
