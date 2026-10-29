import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Placement holds, enforced in the database (0124/0125).
 *
 * A hold is the college's bar on a student, and the whole point is that it bites
 * where the student actually goes: the apply gate and the mail. Both are read
 * here as a real user through RLS, never as the superuser, because a check the
 * browser makes is a suggestion.
 *
 * The mail half lives in 0126 and is asserted in held-student-mail.test.ts; this
 * file is the table, the two functions and the seats.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

/** Campus Manager seats: one at campusA, one at campusB, one with none. */
const MANAGER_A = "62000000-0000-0000-0000-000000000001";
const MANAGER_B = "62000000-0000-0000-0000-000000000002";
const NO_SEAT = "62000000-0000-0000-0000-000000000003";

const status = async (student: string) =>
  (await t.sql(`select participation_status::text c from students where id = $1`, [student]))[0]
    ?.c as string;

const liveHold = async (student: string) =>
  (
    await t.sql(
      `select id::text id, kind::text kind, reason, starts_at::text starts_at,
              ends_at::text ends_at, held_by, released_at
         from student_holds where student_id = $1 and released_at is null`,
      [student],
    )
  )[0] as Record<string, unknown> | undefined;

/**
 * The id of the live hold. Throws instead of `!`, because "cannot read property
 * of undefined" would not say which student had no hold to release.
 */
const holdId = async (student: string) => {
  const hold = await liveHold(student);
  if (!hold) throw new Error(`no live hold on ${student} to release`);
  return hold.id as string;
};

const place = (
  as: string,
  student: string,
  args: [string, string, string, string] = [
    "fees",
    "Two semesters of fees unpaid",
    "2026-10-29",
    "2026-12-15",
  ],
) =>
  t.asUser(as, `select place_student_hold($1, $2::hold_kind, $3, $4::date, $5::date, null) as id`, [
    student,
    args[0],
    args[1],
    args[2],
    args[3],
  ]);

const release = (as: string, hold: string, note?: string) =>
  t.asUser(as, `select release_student_hold($1, $2) as id`, [hold, note ?? null]);

async function invite(as: string, email: string, name: string, role: string) {
  await t.sql(
    `insert into staff_invitations (email, full_name, role) values ($1,$2,$3::app_role)`,
    [email, name, role],
  );
  await t.sql(`insert into auth.users (id, email) values ($1, $2)`, [as, email]);
}

describe("a placement hold", () => {
  beforeAll(async () => {
    t = await createTestDb();
    ids = await seed(t);

    // The students are rostered but not yet signed in. Without these rows
    // `current_student_id()` is NULL, `claim_student_record` (0009:25) never
    // binds auth_user_id, and a student acting through RLS dies at the policy
    // with "new row violates row-level security" instead of reaching the gate
    // that is supposed to answer them in words.
    await t.sql(
      `insert into auth.users (id, email) values ($1,'priya@gmail.com'), ($2,'arjun@gmail.com')`,
      [ids.priyaUser, ids.arjunUser],
    );

    await invite(MANAGER_A, "mgr.a@faceprep.in", "Manager A", "campus_manager");
    await invite(MANAGER_B, "mgr.b@faceprep.in", "Manager B", "campus_manager");
    await invite(NO_SEAT, "mgr.none@faceprep.in", "Manager Without A Seat", "campus_manager");

    await t.sql(
      `insert into staff_campus_assignments (profile_id, campus_id) values
         ((select id from profiles where email = 'mgr.a@faceprep.in'), $1),
         ((select id from profiles where email = 'mgr.b@faceprep.in'), $2)`,
      [ids.campusA, ids.campusB],
    );
  });

  /**
   * Every test that holds Priya leaves her held, and `place` refuses a student
   * who is already held — so without this, the first test's hold is the reason
   * the next nine fail. Priya only: Arjun is reset by nobody because leaving
   * opted_out is forbidden (0009:141) and the last test puts him there.
   */
  beforeEach(async () => {
    await t.sql(`delete from student_holds`);
    await t.sql(`delete from applications`);
    await t.sql(`update students set participation_status = 'active' where id = $1`, [ids.priya]);
  });

  it("takes the student out of placements, and hands them back", async () => {
    expect(await status(ids.priya)).toBe("active");

    const placed = (await place(MANAGER_A, ids.priya))[0]?.id as string;
    expect(await status(ids.priya)).toBe("on_hold");

    const hold = await liveHold(ids.priya);
    expect(hold).toMatchObject({
      kind: "fees",
      reason: "Two semesters of fees unpaid",
      ends_at: "2026-12-15",
    });
    expect(String(hold?.held_by)).toBe(
      (await t.sql(`select id from profiles where email = 'mgr.a@faceprep.in'`))[0]?.id,
    );

    await release(MANAGER_A, placed, "Fees cleared with accounts on 3 Nov.");
    expect(await status(ids.priya)).toBe("active");
    expect(await liveHold(ids.priya)).toBeUndefined();

    // The row is history, not debris.
    const kept = (
      await t.sql(
        `select kind::text kind, released_by is not null released, release_note
           from student_holds where student_id = $1`,
        [ids.priya],
      )
    )[0];
    expect(kept).toMatchObject({ kind: "fees", released: true, release_note: expect.any(String) });
  });

  it("refuses the application at the gate", async () => {
    const drive = (
      await t.sql(
        `insert into drives (company_name, created_by, status, drive_type, offer_category,
                             application_start, application_end, role_title, job_description,
                             work_locations, ctc_min_lpa, role_category)
         values ('Held Out Ltd', $1, 'live', 'placement', 'dream',
                 '2026-08-01T00:00:00Z', '2036-08-31T00:00:00Z', 'Engineer', 'Build things',
                 'Chennai', 6, 'software_technical')
         returning id`,
        [ids.adminUser],
      )
    )[0]?.id as string;

    await place(MANAGER_A, ids.priya);
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into applications (drive_id, student_id, profile_snapshot)
           values ($1, $2, '{}'::jsonb)`,
          [drive, ids.priya],
        ),
      // 0119 refused every non-active state with one guessed sentence, "You have
      // opted out of campus placements or are not currently eligible". 0126 made
      // it name the state, and a held student now hears about their hold.
      /hold on your placements/,
    );

    await release(MANAGER_A, await holdId(ids.priya));
    const applied = await t.asUser(
      ids.priyaUser,
      `insert into applications (drive_id, student_id, profile_snapshot)
       values ($1, $2, '{}'::jsonb) returning id`,
      [drive, ids.priya],
    );
    expect(applied).toHaveLength(1);
    await t.sql(`delete from applications where student_id = $1`, [ids.priya]);
  });

  it("gives a college one live hold per student, and says so", async () => {
    await place(MANAGER_A, ids.priya);
    await t.expectRejection(
      () =>
        place(MANAGER_A, ids.priya, [
          "idle",
          "Not applying to anything",
          "2026-10-29",
          "2026-12-15",
        ]),
      /status: on_hold.*nothing to hold/s,
    );
    expect(
      await t.sql(`select count(*)::int c from student_holds where student_id = $1`, [ids.priya]),
    ).toEqual([{ c: 1 }]);

    await release(MANAGER_A, await holdId(ids.priya));
    await place(MANAGER_A, ids.priya, [
      "idle",
      "Not applying to anything",
      "2026-10-29",
      "2026-12-15",
    ]);
    expect((await liveHold(ids.priya))?.kind).toBe("idle");
    await release(MANAGER_A, await holdId(ids.priya));
  });

  it("stays inside the manager's own college", async () => {
    // Priya is campusA; Manager B holds campusB.
    await t.expectRejection(() => place(MANAGER_B, ids.priya), /only hold a student at a college/);
    // And the one with no seat at all holds nobody.
    await t.expectRejection(() => place(NO_SEAT, ids.priya), /only hold a student at a college/);

    await t.expectRejection(
      () => place(MANAGER_A, "90000000-0000-0000-0000-000000000009"),
      /No such student/,
    );
    expect(await status(ids.priya)).toBe("active");
  });

  it("is a Campus Manager's action and nobody else's", async () => {
    for (const [who, label] of [
      [ids.adminUser, "admin"],
      [ids.centralUser, "central placement coordinator"],
      [ids.cpcUser, "campus placement coordinator"],
    ] as const) {
      await t.expectRejection(() => place(who, ids.priya), /Only a Campus Manager/);
      expect(await status(ids.priya), label).toBe("active");
    }

    // A student cannot hold themselves out of placements.
    await t.expectRejection(() => place(ids.priyaUser, ids.priya), /signed-in staff member/);

    // Releasing is the same test, or the first manager's colleagues could undo it.
    await place(MANAGER_A, ids.priya);
    const hold = await holdId(ids.priya);
    await t.expectRejection(() => release(ids.centralUser, hold), /Only a Campus Manager/);
    await t.expectRejection(() => release(MANAGER_B, hold), /Only a Campus Manager|assigned to/);
    expect(await status(ids.priya)).toBe("on_hold");
    await release(MANAGER_A, hold);
  });

  it("will not lift a stronger decision that arrived while it was on", async () => {
    await place(MANAGER_A, ids.priya);
    const hold = await holdId(ids.priya);

    // Disbarment is Central's and outranks a college's hold.
    await t.sql(`update students set participation_status = 'disbarred' where id = $1`, [
      ids.priya,
    ]);
    await release(MANAGER_A, hold, "Fees paid, but the sanction stands.");

    // The hold is closed...
    expect(await liveHold(ids.priya)).toBeUndefined();
    // ...and the student is NOT quietly back in placements.
    expect(await status(ids.priya)).toBe("disbarred");

    await t.sql(`update students set participation_status = 'active' where id = $1`, [ids.priya]);
  });

  it("refuses a window that ends before it starts", async () => {
    await t.expectRejection(
      () => place(MANAGER_A, ids.priya, ["fees", "Fees", "2026-12-01", "2026-11-01"]),
      /hold_window_is_ordered/,
    );
    expect(await status(ids.priya)).toBe("active");
  });

  it("is written by the function alone", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          MANAGER_A,
          `insert into student_holds (student_id, kind, reason, held_by)
           values ($1, 'fees', 'Direct write', $2)`,
          [ids.priya, MANAGER_A],
        ),
      /permission denied|row-level security/i,
    );
    expect(await status(ids.priya)).toBe("active");
  });

  /**
   * The attachment the feature asked for and 0125 could not file: the object
   * lands in the private `hold-orders` bucket, and this row is what names it.
   */
  it("files a hold order, and only a hold order", async () => {
    const filed = await t.asUser(
      MANAGER_A,
      `insert into student_documents (student_id, kind, storage_path, size_bytes)
       values ($1, 'hold_order', $2, 1024) returning id`,
      [ids.priya, `${ids.priya}/1790000000000-fee-demand.pdf`],
    );
    const document = filed[0]?.id as string;

    const hold = (
      await t.asUser(
        MANAGER_A,
        `select place_student_hold($1, 'fees', 'Two semesters of fees unpaid',
                                   '2026-10-29', '2026-12-15', $2) as id`,
        [ids.priya, document],
      )
    )[0]?.id as string;

    const attached = (
      await t.sql(`select document_id from student_holds where id = $1`, [hold])
    )[0];
    expect(String(attached?.document_id)).toBe(document);

    // Not an offer letter, not a marksheet: the manager's insert right is the
    // one kind a hold needs, and nothing wider.
    await t.expectRejection(
      () =>
        t.asUser(
          MANAGER_A,
          `insert into student_documents (student_id, kind, storage_path, size_bytes)
           values ($1, 'offer_letter', $2, 1024)`,
          [ids.priya, `${ids.priya}/1790000000001-offer.pdf`],
        ),
      /row-level security/,
    );

    // And only for a student at the college they sit on.
    await t.expectRejection(
      () =>
        t.asUser(
          MANAGER_B,
          `insert into student_documents (student_id, kind, storage_path, size_bytes)
           values ($1, 'hold_order', $2, 1024)`,
          [ids.priya, `${ids.priya}/1790000000002-other-college.pdf`],
        ),
      /row-level security/,
    );
  });

  it("shows the student their own hold and nothing else's", async () => {
    await place(MANAGER_A, ids.priya);
    await place(MANAGER_B, ids.arjun, [
      "self_placed",
      "Took an off-campus offer",
      "2026-10-29",
      "2026-11-30",
    ]);

    const own = await t.asUser(
      ids.priyaUser,
      `select kind::text kind, reason, ends_at, document_id from student_holds`,
    );
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ kind: "fees", reason: "Two semesters of fees unpaid" });

    // Arjun cannot read Priya's row, and Priya cannot read his.
    const other = await t.asUser(
      ids.arjunUser,
      `select reason from student_holds where student_id = $1`,
      [ids.priya],
    );
    expect(other).toHaveLength(0);

    const sighted = await t.asUser(MANAGER_A, `select count(*) c from student_holds`);
    expect(String(sighted[0]?.c)).toBe("1");
    const central = await t.asUser(ids.centralUser, `select count(*) c from student_holds`);
    expect(String(central[0]?.c)).toBe("2");

    await release(MANAGER_A, await holdId(ids.priya));
    await release(MANAGER_B, await holdId(ids.arjun));
  });

  it("records both halves of the decision in the audit log", async () => {
    const before = (
      await t.sql(`select count(*)::int c from audit_log where entity_table = 'student_holds'`)
    )[0]?.c as number;

    const hold = (await place(MANAGER_A, ids.priya))[0]?.id as string;
    await release(MANAGER_A, hold, "Cleared with accounts.");

    const rows = await t.sql(
      `select action, actor_id, reason, after_data ->> 'release_note' as note
         from audit_log where entity_table = 'student_holds'
        order by id`,
    );
    const fresh = rows.slice(before);
    expect(fresh.map((r) => r.action)).toEqual(["insert", "update"]);
    // audit_row() takes the actor from auth.uid(), which inside a SECURITY DEFINER
    // function is still the caller's claim — so the manager is named, not postgres.
    expect(String(fresh[0]?.actor_id)).toBe(
      String((await t.sql(`select id from profiles where email = 'mgr.a@faceprep.in'`))[0]?.id),
    );
    expect(fresh[0]?.reason).toBe("Two semesters of fees unpaid");
    expect(fresh[1]?.note).toBe("Cleared with accounts.");
  });

  it("refuses to hold a student who has already left", async () => {
    // Last, and it stays last: Arjun leaves placements for good here, because
    // 0009:141 forbids leaving opted_out, and beforeEach cannot put him back.
    await t.sql(`update students set participation_status = 'opted_out' where id = $1`, [
      ids.arjun,
    ]);
    await t.expectRejection(
      () => place(MANAGER_B, ids.arjun),
      /status: opted_out.*nothing to hold/s,
    );
    expect(
      await t.sql(`select count(*)::int c from student_holds where student_id = $1`, [ids.arjun]),
    ).toEqual([{ c: 0 }]);
    expect(await status(ids.arjun)).toBe("opted_out");
  });
});
