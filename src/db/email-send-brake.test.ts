import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * The outbound-email brake (0140), for backfilling rounds and results on drives
 * that ended years ago without mailing those students all over again.
 *
 * The brake sits on the INSERT into email_deliveries, not on any one of the
 * paths that write it, because the paths are many and still growing: the
 * notification outbox (0126), the staff lifecycle triggers (0080/0129), the
 * campus digests (0113), the reminder crons (0114), and the admin screen's own
 * invitation insert. A brake on the shortlist path alone would leave the
 * coordinator's copy - the "and others" of the request - running.
 *
 * Arjun is mailed with the switch off, before the tests that pull it, so a typo
 * in the switch cannot quietly mail nobody at all.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let oldDrive = "";
let nextDrive = "";
let priyaApp = "";
let arjunApp = "";
let arjunNextApp = "";

const brake = (on: boolean) =>
  t.sql(`update settings set value = $1::jsonb where key = 'email_send_paused'`, [
    on ? "true" : "false",
  ]);

/** The status of the shortlist mail staged for one student, oldest first. */
async function shortlistMail(student: string) {
  return (
    await t.sql(
      `select ed.status status from email_deliveries ed
         join notifications n on n.id = ed.notification_id
        where n.student_id = $1 and n.kind::text = 'shortlisted'
        order by ed.updated_at`,
      [student],
    )
  ).map((r) => String(r.status));
}

async function drive(company: string) {
  const rows = await t.sql(
    `insert into drives (company_name, created_by, status, drive_type, offer_category,
                         application_start, application_end, role_title, job_description,
                         work_locations, ctc_min_lpa, role_category)
     values ($1, $2, 'live', 'placement', 'dream',
             '2024-01-01T00:00:00Z', '2024-01-20T00:00:00Z',
             'Engineer', 'Build things', 'Chennai', 6, 'software_technical')
     returning id`,
    [company, ids.adminUser],
  );
  return rows[0]?.id as string;
}

async function application(driveId: string, student: string) {
  const rows = await t.sql(
    `insert into applications (drive_id, student_id, profile_snapshot)
     values ($1, $2, '{}'::jsonb) returning id`,
    [driveId, student],
  );
  return rows[0]?.id as string;
}

/** The write the backfill actually does, and the one this brake is for. */
const shortlist = (applicationId: string) =>
  t.sql(
    `insert into shortlist_entries (application_id, included, decided_by)
     values ($1, true, $2)`,
    [applicationId, ids.cpcUser],
  );

describe("the email brake", () => {
  beforeAll(async () => {
    t = await createTestDb();
    ids = await seed(t);

    oldDrive = await drive("Old Visit Ltd");
    nextDrive = await drive("Next Visit Ltd");
    priyaApp = await application(oldDrive, ids.priya);
    arjunApp = await application(oldDrive, ids.arjun);
    arjunNextApp = await application(nextDrive, ids.arjun);
  });

  it("stages mail to be sent while the switch is off, which is how it ships", async () => {
    await shortlist(arjunApp);

    expect(await shortlistMail(ids.arjun)).toEqual(["queued"]);
  });

  it("holds shortlist mail the moment the switch is on, but still tells the student", async () => {
    await brake(true);
    await shortlist(priyaApp);

    // Born 'suppressed', never 'queued': claim_email_deliveries takes only
    // 'queued' rows and the instant-dispatch trigger only fires on 'queued',
    // so nothing is sent - and nothing waits to flood out when the brake is off.
    expect(await shortlistMail(ids.priya)).toEqual(["suppressed"]);

    // The in-app bell is not this brake's business; 0140's header says so.
    const bell = await t.sql(
      `select count(*)::int c from notifications
        where student_id = $1 and kind::text = 'shortlisted'`,
      [ids.priya],
    );
    expect(bell[0]?.c).toBe(1);
  });

  it("holds the staff copy too, the one with no notification behind it", async () => {
    // The shape src/features/admin/staff-repository.ts writes for an invitation
    // and enqueue_direct_email (0080) writes for a coordinator: pre-built HTML,
    // no student, no notification_id.
    const staff = await t.sql(
      `insert into email_deliveries (recipient_email, status, subject, html_body)
       values ('cpc@faceprep.in', 'queued', 'Round results recorded', '<p>x</p>')
       returning status`,
    );
    expect(staff[0]?.status).toBe("suppressed");
  });

  it("leaves mail already queued when it went live, which is why the paste holds it first", async () => {
    // The brake decides at INSERT time. Arjun's row from the first test is
    // already sitting 'queued', so the dispatcher would still take it - the
    // paste that pulls the brake holds that backlog in the same statement.
    expect(await shortlistMail(ids.arjun)).toEqual(["queued"]);
  });

  it("does not let go of what it held when the switch comes back off", async () => {
    await brake(false);

    expect(await shortlistMail(ids.priya)).toEqual(["suppressed"]);

    // And off means off: the very next shortlist is staged to be sent, so
    // resuming needs no second migration.
    await shortlist(arjunNextApp);
    expect(await shortlistMail(ids.arjun)).toEqual(["queued", "queued"]);
  });

  it("holds nothing down: one statement releases a suppressed delivery", async () => {
    const released = await t.sql(
      `update email_deliveries ed set status = 'queued'
         from notifications n
        where ed.notification_id = n.id and n.student_id = $1
          and ed.status = 'suppressed'
        returning ed.id`,
      [ids.priya],
    );
    expect(released).toHaveLength(1);

    expect(await shortlistMail(ids.priya)).toEqual(["queued"]);
  });
});
