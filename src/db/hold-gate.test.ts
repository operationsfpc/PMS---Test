import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Placement holds, enforced in the database (0124/0125/0130).
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
      /review date cannot fall before/i,
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

  /**
   * The student's own half of 0130: a request that touches nothing until a
   * Campus Manager confirms it. The risk this block exists for is the one the
   * feature would otherwise invite — a self-report that closes a student's own
   * drives the moment they type it.
   */
  describe("a student's self-placed request", () => {
    // `storage_path` is unique, so every filing gets its own key even when two
    // tests file the same kinds for the same student.
    let filed = 0;
    const fileDocument = (as: string, student: string, kind: string) => {
      filed += 1;
      return t.asUser(
        as,
        `insert into student_documents (student_id, kind, storage_path, size_bytes)
         values ($1, $2::document_kind, $3, 1024) returning id`,
        [student, kind, `${student}/17900000${String(filed).padStart(6, "0")}-${kind}.pdf`],
      );
    };

    /** Both documents the request needs, filed by the student themselves. */
    const evidence = async (as: string, student: string) => ({
      offer: (await fileDocument(as, student, "offer_letter"))[0]?.id as string,
      declaration: (await fileDocument(as, student, "self_placement_declaration"))[0]?.id as string,
    });

    const request = (
      as: string,
      offer: string,
      declaration: string,
      args: [string, string, string, string, string, number] = [
        "Took an off-campus offer",
        "2026-10-29",
        "2026-12-15",
        "Zoho",
        "Software Engineer",
        8.5,
      ],
    ) =>
      t.asUser(
        as,
        `select request_self_placed_hold($1, $2, $3, $4::date, $5::date, $6, $7, $8) as id`,
        [offer, declaration, args[0], args[1], args[2], args[3], args[4], args[5]],
      );

    const confirm = (as: string, hold: string) =>
      t.asUser(as, `select confirm_student_hold($1) as id`, [hold]);

    const holdRow = async (student: string) =>
      (
        await t.sql(
          `select id::text id, kind::text kind, confirmed_at, confirmed_by, held_by,
                  document_id, declaration_id
             from student_holds where student_id = $1`,
          [student],
        )
      )[0] as Record<string, unknown> | undefined;

    /** Priya files a full request and the id of the waiting row comes back. */
    const filedRequest = async () => {
      const { offer, declaration } = await evidence(ids.priyaUser, ids.priya);
      return (await request(ids.priyaUser, offer, declaration))[0]?.id as string;
    };

    it("files the request and closes nothing until the college confirms it", async () => {
      const { offer, declaration } = await evidence(ids.priyaUser, ids.priya);
      await request(ids.priyaUser, offer, declaration);

      // Waiting, not in force: the drives stay open and the mail keeps coming.
      expect(await status(ids.priya)).toBe("active");
      const row = await holdRow(ids.priya);
      expect(row).toMatchObject({ kind: "self_placed", confirmed_at: null, held_by: null });
      expect(String(row?.document_id)).toBe(offer);
      expect(String(row?.declaration_id)).toBe(declaration);

      // The offer request 0014 owns is written in the same statement.
      const [placement] = await t.sql(
        `select company_name, ctc_lpa::text ctc, offer_letter_id
           from self_placement_requests where student_id = $1`,
        [ids.priya],
      );
      expect(placement).toMatchObject({ company_name: "Zoho", offer_letter_id: offer });

      // And the student can read the row that is waiting on them.
      const own = await t.asUser(
        ids.priyaUser,
        `select kind::text kind from student_holds where released_at is null`,
      );
      expect(own).toHaveLength(1);
    });

    it("closes the student's drives when a manager confirms it", async () => {
      const hold = await filedRequest();
      const confirmed = await confirm(MANAGER_A, hold);
      expect(String(confirmed[0]?.id)).toBe(ids.priya);
      expect(await status(ids.priya)).toBe("on_hold");

      const row = await holdRow(ids.priya);
      expect(row?.confirmed_at).not.toBeNull();
      expect(String(row?.confirmed_by)).toBe(
        String((await t.sql(`select id from profiles where email = 'mgr.a@faceprep.in'`))[0]?.id),
      );

      // Confirming twice says so instead of flipping the state again.
      await t.expectRejection(() => confirm(MANAGER_A, hold), /already confirmed/);
    });

    it("is confirmed only by a manager at the student's own college", async () => {
      const hold = await filedRequest();

      await t.expectRejection(() => confirm(MANAGER_B, hold), /only confirm a hold at a college/);
      await t.expectRejection(() => confirm(NO_SEAT, hold), /only confirm a hold at a college/);
      await t.expectRejection(() => confirm(ids.centralUser, hold), /Only a Campus Manager/);
      // And a student cannot confirm the request they filed themselves.
      await t.expectRejection(() => confirm(ids.priyaUser, hold), /signed-in staff member/);

      expect(await status(ids.priya)).toBe("active");
      expect((await holdRow(ids.priya))?.confirmed_at).toBeNull();
    });

    it("is the student's own action, not a manager's", async () => {
      const { offer, declaration } = await evidence(ids.priyaUser, ids.priya);
      await t.expectRejection(
        () => request(MANAGER_A, offer, declaration),
        /filed by the student themselves/,
      );
      expect(await holdRow(ids.priya)).toBeUndefined();
    });

    it("files only against the student's own two documents", async () => {
      const { declaration } = await evidence(ids.priyaUser, ids.priya);
      const arjunOffer = (await fileDocument(ids.arjunUser, ids.arjun, "offer_letter"))[0]
        ?.id as string;

      await t.expectRejection(
        () => request(ids.priyaUser, arjunOffer, declaration),
        /File your offer letter first/,
      );
      expect(await status(ids.priya)).toBe("active");
      expect(await holdRow(ids.priya)).toBeUndefined();
    });

    it("refuses a second request while one is still waiting", async () => {
      const { offer, declaration } = await evidence(ids.priyaUser, ids.priya);
      await request(ids.priyaUser, offer, declaration);
      await t.expectRejection(
        () => request(ids.priyaUser, offer, declaration),
        /already a hold, or a request waiting/,
      );
      expect(
        await t.sql(`select count(*)::int c from student_holds where student_id = $1`, [ids.priya]),
      ).toEqual([{ c: 1 }]);
    });

    it("declines without taking the student out of placements", async () => {
      const hold = await filedRequest();
      await release(MANAGER_A, hold, "The letter does not match the offer.");

      expect(await status(ids.priya)).toBe("active");
      const row = await holdRow(ids.priya);
      expect(row?.confirmed_at).toBeNull();

      // A declined request is closed for good, not confirmable later.
      await t.expectRejection(() => confirm(MANAGER_A, hold), /already declined/);
    });

    it("places a pause the same way as any other hold", async () => {
      await place(MANAGER_A, ids.priya, [
        "pause",
        "Medical leave agreed with the college",
        "2026-10-29",
        "2026-12-15",
      ]);
      expect(await status(ids.priya)).toBe("on_hold");
      expect((await liveHold(ids.priya))?.kind).toBe("pause");

      await release(MANAGER_A, await holdId(ids.priya));
      expect(await status(ids.priya)).toBe("active");
    });
  });

  /**
   * 0131: a fee dispute outliving the review date it was guessed at. The
   * date moves forward under the same rules as place and release; pulling it
   * earlier is deliberately not this function's job — that is what release is
   * for, and the record should say which happened.
   */
  describe("extending a hold", () => {
    const extend = (as: string, hold: string, to: string) =>
      t.asUser(as, `select extend_student_hold($1, $2::date) as id`, [hold, to]);

    /**
     * A pending (unconfirmed) row, written directly rather than through the
     * student RPC: this block tests the extension gate, and the constraint
     * only asks for the shape.
     */
    const pendingRow = async () => {
      const offer = (
        await t.sql(
          `insert into student_documents (student_id, kind, storage_path, size_bytes)
           values ($1, 'offer_letter', $2, 1024) returning id`,
          [ids.priya, `${ids.priya}/1790000002000-offer.pdf`],
        )
      )[0]?.id as string;
      const declaration = (
        await t.sql(
          `insert into student_documents (student_id, kind, storage_path, size_bytes)
           values ($1, 'self_placement_declaration', $2, 1024) returning id`,
          [ids.priya, `${ids.priya}/1790000002001-declaration.pdf`],
        )
      )[0]?.id as string;
      return (
        await t.sql(
          `insert into student_holds (student_id, kind, reason, starts_at, ends_at,
                                      document_id, declaration_id)
           values ($1, 'self_placed', 'Asked to be held', '2026-10-29', '2026-12-15', $2, $3)
           returning id`,
          [ids.priya, offer, declaration],
        )
      )[0]?.id as string;
    };

    it("moves a confirmed hold's review date forward, and nothing else", async () => {
      const hold = (await place(MANAGER_A, ids.priya))[0]?.id as string;
      await extend(MANAGER_A, hold, "2027-01-15");

      expect((await liveHold(ids.priya))?.ends_at).toBe("2027-01-15");
      // The student is still held, by the same hold, for the same reason.
      expect(await status(ids.priya)).toBe("on_hold");
      expect((await liveHold(ids.priya))?.reason).toBe("Two semesters of fees unpaid");
    });

    it("refuses a date that is not after the current review date", async () => {
      const hold = (await place(MANAGER_A, ids.priya))[0]?.id as string;
      await t.expectRejection(() => extend(MANAGER_A, hold, "2026-12-15"), /must fall after/);
      await t.expectRejection(() => extend(MANAGER_A, hold, "2026-11-01"), /must fall after/);
      expect((await liveHold(ids.priya))?.ends_at).toBe("2026-12-15");
    });

    it("is a Campus Manager's action at their own college", async () => {
      const hold = (await place(MANAGER_A, ids.priya))[0]?.id as string;
      await t.expectRejection(
        () => extend(ids.centralUser, hold, "2027-01-15"),
        /Only a Campus Manager/,
      );
      await t.expectRejection(
        () => extend(MANAGER_B, hold, "2027-01-15"),
        /only extend a hold at a college/,
      );
      await t.expectRejection(
        () => extend(ids.priyaUser, hold, "2027-01-15"),
        /signed-in staff member/,
      );
      expect((await liveHold(ids.priya))?.ends_at).toBe("2026-12-15");
    });

    it("will not touch a released hold", async () => {
      const hold = (await place(MANAGER_A, ids.priya))[0]?.id as string;
      await release(MANAGER_A, hold, "Fees cleared.");
      await t.expectRejection(() => extend(MANAGER_A, hold, "2027-01-15"), /already released/);
      expect(await status(ids.priya)).toBe("active");
    });

    it("will not extend a request nobody has confirmed", async () => {
      const hold = await pendingRow();
      await t.expectRejection(() => extend(MANAGER_A, hold, "2027-01-15"), /no hold to extend/);
      expect((await liveHold(ids.priya))?.ends_at).toBe("2026-12-15");
      expect(await status(ids.priya)).toBe("active");
    });
  });
});
