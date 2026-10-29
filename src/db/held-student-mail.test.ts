import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * What a held student hears, and what they do not (0126).
 *
 * The request was "no notification can get to the student". That is two surfaces:
 * the email (everything funnels through enqueue_notification_email) and the
 * in-app bell (every notifications row a trigger writes). Suppressing only the
 * email would leave the row in the bell, which is the half a student reads on
 * the bus.
 *
 * Every test fires the SAME event at two students — Priya, held, and Arjun,
 * active — and requires Arjun to get his copy. Without that control a typo in
 * the fixture passes by mailing nobody at all, which is how the category ladder
 * ran in the browser for a month while its error was swallowed.
 *
 * Priya's bell and outbox are asserted EMPTY, cumulatively: the tests run in
 * order against one database, so a leak in any earlier event is still visible
 * in every later assertion.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const MANAGER = "63000000-0000-0000-0000-000000000001";
let drive1 = "";
let priyaApp = "";
let arjunApp = "";

const status_of = async (student: string) =>
  (await t.sql(`select participation_status::text c from students where id = $1`, [student]))[0]
    ?.c as string;

/**
 * The placements events 0126 governs.
 *
 * Listed rather than "everything", because this fixture also produces
 * `srf_approved` (0076) and `application_confirmed`: those are about the
 * student's own registration and arrive whether or not they are held. 0126
 * leaves them alone and says why in its header, so counting them here would
 * fail on rows that are not this migration's business.
 */
const PLACEMENT_KINDS = [
  "drive_published",
  "shortlisted",
  "round_scheduled",
  "round_cleared",
  "round_not_selected",
  "meeting_link",
  "offer",
  "absent",
];

/** The placements notifications this student has been sent, as `kind:count`. */
async function bell(student: string) {
  return (
    await t.sql(
      `select kind::text kind, count(*)::int c from notifications
        where student_id = $1 and kind::text = any($2::text[])
        group by kind order by kind`,
      [student, PLACEMENT_KINDS],
    )
  ).map((r) => `${String(r.kind)}:${String(r.c)}`);
}

/** Placement mail the outbox actually staged for one address. */
async function mail(email: string) {
  return (
    await t.sql(
      `select count(*)::int c
         from email_deliveries ed
         join notifications n on n.id = ed.notification_id
        where lower(ed.recipient_email) = $1 and n.kind::text = any($2::text[])`,
      [email.toLowerCase(), PLACEMENT_KINDS],
    )
  )[0]?.c as number;
}

async function drive(company: string, status = "draft") {
  const rows = await t.sql(
    `insert into drives (company_name, created_by, status, drive_type, offer_category,
                         application_start, application_end, role_title, job_description,
                         work_locations, ctc_min_lpa, role_category)
     values ($1, $2, $3, 'placement', 'dream',
             '2026-08-01T00:00:00Z', '2036-08-31T00:00:00Z',
             'Engineer', 'Build things', 'Chennai', 6, 'software_technical')
     returning id`,
    [company, ids.adminUser, status],
  );
  return rows[0]?.id as string;
}

async function application(driveId: string, student: string) {
  // The superuser, on purpose: auth.uid() is null, so enforce_application_gates
  // steps aside (0119:57) and the application exists even though Priya is held.
  // What is under test is what the college's events mail, not whether a held
  // student could have applied the week before.
  const rows = await t.sql(
    `insert into applications (drive_id, student_id, profile_snapshot)
     values ($1, $2, '{}'::jsonb) returning id`,
    [driveId, student],
  );
  return rows[0]?.id as string;
}

async function roundId() {
  const existing = await t.sql(`select id from drive_rounds where drive_id = $1 and sequence = 1`, [
    drive1,
  ]);
  if (existing.length > 0) return existing[0]?.id as string;
  return (
    await t.sql(
      `insert into drive_rounds (drive_id, sequence, name)
       values ($1, 1, 'Aptitude') returning id`,
      [drive1],
    )
  )[0]?.id as string;
}

describe("a held student", () => {
  beforeAll(async () => {
    t = await createTestDb();
    ids = await seed(t);

    // Without these the students are rostered but not claimed, so
    // current_student_id() is NULL and a student write dies at RLS before any
    // gate under test ever runs.
    await t.sql(
      `insert into auth.users (id, email) values ($1,'priya@gmail.com'), ($2,'arjun@gmail.com')`,
      [ids.priyaUser, ids.arjunUser],
    );

    await t.sql(
      `insert into staff_invitations (email, full_name, role) values ($1,'Manager','campus_manager')`,
      ["mgr@faceprep.in"],
    );
    await t.sql(`insert into auth.users (id, email) values ($1,'mgr@faceprep.in')`, [MANAGER]);
    await t.sql(
      `insert into staff_campus_assignments (profile_id, campus_id)
       values ((select id from profiles where email = 'mgr@faceprep.in'), $1)`,
      [ids.campusA],
    );

    // drive1 starts as a DRAFT so going live is a test, not setup noise, and
    // neither student has been mailed before the hold lands.
    drive1 = await drive("Control Ltd");
    priyaApp = await application(drive1, ids.priya);
    arjunApp = await application(drive1, ids.arjun);

    await t.asUser(
      MANAGER,
      `select place_student_hold($1, 'fees', 'Two semesters of fees unpaid',
                                '2026-10-29'::date, '2026-12-15'::date, null)`,
      [ids.priya],
    );
    expect(await status_of(ids.priya)).toBe("on_hold");

    expect(await bell(ids.priya)).toEqual([]);
    expect(await mail("priya@gmail.com")).toBe(0);
    expect(await mail("arjun@gmail.com")).toBe(0);
  });

  it("is mailed nothing when the drive goes live, while an active student is", async () => {
    await t.sql(`update drives set status = 'live' where id = $1`, [drive1]);

    expect(await bell(ids.priya)).toEqual([]);
    expect(await bell(ids.arjun)).toContain("drive_published:1");
    expect(await mail("priya@gmail.com")).toBe(0);
    expect(await mail("arjun@gmail.com")).toBe(1);
  });

  it("is not told they are shortlisted, even with the override reason", async () => {
    // Priya's row needs the override the guard demands (see the shortlist test
    // below); the point here is that overriding the guard does not re-open the
    // mail. Arjun is the control, shortlisted with no reason needed.
    await t.sql(
      `insert into shortlist_entries (application_id, included, decided_by, opt_out_override_reason)
       values ($1, true, $2, 'Called in by the company at the manager request.')`,
      [priyaApp, ids.cpcUser],
    );
    await t.sql(
      `insert into shortlist_entries (application_id, included, decided_by)
       values ($1, true, $2)`,
      [arjunApp, ids.cpcUser],
    );

    expect(await bell(ids.priya)).toEqual([]);
    expect(await bell(ids.arjun)).toContain("shortlisted:1");
    expect(await mail("priya@gmail.com")).toBe(0);
  });

  it("is not told the round moved", async () => {
    const round = await roundId();
    for (const app of [priyaApp, arjunApp]) {
      await t.sql(
        `insert into round_participants (round_id, application_id, added_by)
         values ($1, $2, $3)`,
        [round, app, ids.cpcUser],
      );
    }

    await t.sql(`update drive_rounds set venue = 'Seminar Hall B' where id = $1`, [round]);

    expect(await bell(ids.priya)).toEqual([]);
    expect(await bell(ids.arjun)).toContain("round_scheduled:1");
    expect(await mail("priya@gmail.com")).toBe(0);
  });

  it("is not told the result of a round", async () => {
    const round = await roundId();
    for (const app of [priyaApp, arjunApp]) {
      await t.sql(
        `insert into round_results (round_id, application_id, result, declared_by)
         values ($1, $2, 'selected', $3)`,
        [round, app, ids.cpcUser],
      );
    }

    expect(await bell(ids.priya)).toEqual([]);
    expect(await bell(ids.arjun)).toContain("round_cleared:1");
    expect(await mail("priya@gmail.com")).toBe(0);
  });

  it("is not given a meeting slot", async () => {
    const round = await roundId();
    await t.sql(
      `update round_participants
          set meeting_link = 'https://meet.example/room',
              participant_scheduled_at = '2026-11-20T10:00:00Z'
        where round_id = $1`,
      [round],
    );

    expect(await bell(ids.priya)).toEqual([]);
    expect(await bell(ids.arjun)).toContain("meeting_link:1");
    expect(await mail("priya@gmail.com")).toBe(0);
  });

  it("is not told about an offer, nor about being marked absent", async () => {
    await t.sql(
      `insert into offers (student_id, drive_id, source, company_name, drive_type,
                           offer_category, ctc_lpa, declared_by)
       values ($1, $4, 'on_campus', 'Control Ltd', 'placement', 'dream', 9.5, $3),
              ($2, $4, 'on_campus', 'Control Ltd', 'placement', 'dream', 8.5, $3)`,
      [ids.priya, ids.arjun, ids.cpcUser, drive1],
    );

    const round = await roundId();
    await t.sql(
      `insert into attendance (round_id, application_id, status, marked_by)
       values ($1, $2, 'absent', $3), ($1, $4, 'absent', $3)`,
      [round, priyaApp, ids.cpcUser, arjunApp],
    );

    expect(await bell(ids.priya)).toEqual([]);
    expect(await bell(ids.arjun)).toContain("offer:1");
    expect(await bell(ids.arjun)).toContain("absent:1");
    expect(await mail("priya@gmail.com")).toBe(0);
  });

  it("cannot be shortlisted without a reason, and the reason names the hold", async () => {
    // A held student who can be shortlisted is scheduled into Round 1 and given
    // an attendance row with no notice at all — the silent half-state. So the
    // 0043 guard covers the hold too, and says which state it is refusing.
    const second = await drive("Second Ltd", "live");
    const heldApp = await application(second, ids.priya);

    await t.expectRejection(
      () =>
        t.sql(
          `insert into shortlist_entries (application_id, included, decided_by)
           values ($1, true, $2)`,
          [heldApp, ids.cpcUser],
        ),
      /on a hold placed by their college/,
    );
    expect(await bell(ids.priya)).toEqual([]);

    // Arjun, active, is the control on the other side of the same write.
    const control = await application(second, ids.arjun);
    await t.sql(
      `insert into shortlist_entries (application_id, included, decided_by)
       values ($1, true, $2)`,
      [control, ids.cpcUser],
    );
    expect(await bell(ids.arjun)).toContain("shortlisted:2");
  });

  it("is told which decision bars them, in the words the screen uses", async () => {
    const live = await drive("Refusal Ltd", "live");
    const apply = () =>
      t.asUser(
        ids.priyaUser,
        `insert into applications (drive_id, student_id, profile_snapshot)
         values ($1, $2, '{}'::jsonb)`,
        [live, ids.priya],
      );

    // Before 0126 all three of these got the same guessed sentence, "You have
    // opted out of campus placements or are not currently eligible", which
    // accused a held student of a decision they never made.
    await t.expectRejection(apply, /Your college has placed a hold on your placements/);

    await t.asUser(
      MANAGER,
      `select release_student_hold(h.id, 'Fees cleared with accounts.')
         from student_holds h where h.student_id = $1 and h.released_at is null`,
      [ids.priya],
    );
    expect(await status_of(ids.priya)).toBe("active");

    await t.sql(`update students set participation_status = 'disbarred' where id = $1`, [
      ids.priya,
    ]);
    await t.expectRejection(apply, /not currently eligible to apply/);
    // 0126's disclosed side effect, stated in its header: a disbarred student
    // was mailed until now, because every gate asked only about opted_out.
    expect(await mail("priya@gmail.com")).toBe(0);

    await t.sql(`update students set participation_status = 'opted_out' where id = $1`, [
      ids.priya,
    ]);
    await t.expectRejection(apply, /You have opted out of campus placements/);
  });
});
