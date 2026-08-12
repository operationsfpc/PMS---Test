import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * The full round cycle (0043) — D7/D8/D9, confirmed 2026-08-12.
 *
 * Three things in one migration because they are one story:
 *
 * 1. THE ROUND TABLES HAD NO RLS AT ALL. round_participants, round_results
 *    and attendance were created without policies while 0008 grants
 *    insert/update on every table — so any signed-in student could write
 *    themselves a 'selected' result. Same class of hole 0030 closed for the
 *    drive link tables.
 * 2. The shortlist now REACHES the student: inclusion schedules Round 1 and
 *    writes an in-app notification; results notify (selected AND rejected —
 *    the client asked for both); an offer notifies.
 * 3. An opted-out student cannot be shortlisted without an explicit override
 *    reason, and is never notified of anything.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const AE_USER = "63000000-0000-0000-0000-000000000001";
const OPTED_USER = "64000000-0000-0000-0000-000000000001";
const OPTED = "54000000-0000-0000-0000-000000000001";

let drive: string;
let round1: string;
let round2: string;
let priyaApp: string;
let arjunApp: string;
let optedApp: string;

async function notificationsFor(studentId: string): Promise<Record<string, unknown>[]> {
  return t.sql(
    `select kind, title, body from notifications where student_id = $1 order by created_at`,
    [studentId],
  );
}

async function include(applicationId: string, reason: string | null = null): Promise<void> {
  await t.asUser(
    ids.centralUser,
    `insert into shortlist_entries (application_id, included, decided_by, opt_out_override_reason)
     values ($1, true, $2, $3)
     on conflict (application_id) do update
       set included = true, opt_out_override_reason = $3`,
    [applicationId, ids.centralUser, reason],
  );
}

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae-rounds@faceprep.in','AE Rounds','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae-rounds@faceprep.in')`, [AE_USER]);

  // A third student who opted out AFTER applying (D7's exact case).
  await t.sql(
    `insert into students (id, campus_id, degree_id, branch_id, roll_number, full_name, email,
                           passing_year, srf_status, consent_given_at)
     values ($1,$2,$3,$4,'21CSE5555','Meena V','meena@gmail.com',2026,'srf_approved', now())`,
    [OPTED, ids.campusA, ids.degree, ids.branch],
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'meena@gmail.com')`, [OPTED_USER]);

  // Claim the rostered accounts — asUser() is meaningless for a student the
  // database cannot resolve back to their row.
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [ids.arjunUser]);

  drive = (
    await t.sql(
      `insert into drives (company_name, created_by, status, drive_type, offer_category,
                           application_start, application_end, role_title, job_description,
                           work_locations, ctc_min_lpa, role_category)
       values ('Zoho', $1, 'live', 'placement', 'dream',
               '2026-08-01T00:00:00Z', '2036-08-31T00:00:00Z', 'Engineer', 'Build',
               'Chennai', 6, 'software_technical') returning id`,
      [AE_USER],
    )
  )[0]?.id as string;

  round1 = (
    await t.sql(
      `insert into drive_rounds (drive_id, sequence, name) values ($1, 1, 'Aptitude') returning id`,
      [drive],
    )
  )[0]?.id as string;
  round2 = (
    await t.sql(
      `insert into drive_rounds (drive_id, sequence, name) values ($1, 2, 'Technical') returning id`,
      [drive],
    )
  )[0]?.id as string;

  const apps: string[] = [];
  for (const student of [ids.priya, ids.arjun, OPTED]) {
    apps.push(
      (
        await t.sql(
          `insert into applications (drive_id, student_id, profile_snapshot)
           values ($1, $2, '{}'::jsonb) returning id`,
          [drive, student],
        )
      )[0]?.id as string,
    );
  }
  [priyaApp = "", arjunApp = "", optedApp = ""] = apps;

  // The opt-out lands after the application, which is what makes D7 real.
  await t.sql(`update students set participation_status = 'opted_out' where id = $1`, [OPTED]);
});

describe("the round tables are no longer open to everyone (0043)", () => {
  it("refuses a student writing their own round result", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into round_results (round_id, application_id, result)
           values ($1, $2, 'selected')`,
          [round1, priyaApp],
        ),
      /row-level security|violates/i,
    );
  });

  it("hides other students' attendance from a student", async () => {
    await t.sql(
      `insert into attendance (round_id, application_id, status) values ($1, $2, 'scheduled')`,
      [round1, arjunApp],
    );
    const rows = await t.asUser(ids.priyaUser, `select id from attendance`);
    expect(rows).toHaveLength(0);
    await t.sql(`delete from attendance where round_id = $1 and application_id = $2`, [
      round1,
      arjunApp,
    ]);
  });

  it("lets the drive's AE read its round results, and only read", async () => {
    await t.sql(
      `insert into round_results (round_id, application_id, result) values ($1, $2, 'selected')`,
      [round1, arjunApp],
    );
    const rows = await t.asUser(AE_USER, `select result from round_results`);
    expect(rows.length).toBeGreaterThan(0);
    await t.sql(`delete from round_results where round_id = $1 and application_id = $2`, [
      round1,
      arjunApp,
    ]);
  });
});

describe("an opted-out student cannot be shortlisted (D7)", () => {
  it("refuses inclusion without an override reason, naming the rule", async () => {
    await t.expectRejection(() => include(optedApp), /opted out/i);
  });

  it("allows it with the Central CPC's explicit reason", async () => {
    await include(optedApp, "Recruiter asked for her by name");
    const rows = await t.sql(`select included from shortlist_entries where application_id = $1`, [
      optedApp,
    ]);
    expect(rows[0]?.included).toBe(true);
  });

  it("never notifies the opted-out student, even when overridden", async () => {
    expect(await notificationsFor(OPTED)).toHaveLength(0);
  });
});

describe("saving the shortlist reaches the student (D8/D9)", () => {
  it("schedules the included student into Round 1 and tells them", async () => {
    await include(priyaApp);

    const scheduled = await t.sql(
      `select status from attendance where round_id = $1 and application_id = $2`,
      [round1, priyaApp],
    );
    expect(scheduled[0]?.status).toBe("scheduled");

    const participant = await t.sql(
      `select id from round_participants where round_id = $1 and application_id = $2`,
      [round1, priyaApp],
    );
    expect(participant).toHaveLength(1);

    const notes = await notificationsFor(ids.priya);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe("shortlisted");
    expect(String(notes[0]?.title)).toMatch(/shortlisted/i);
    expect(String(notes[0]?.title)).toMatch(/Zoho/);
  });

  it("un-including removes the untouched Round 1 scheduling, not the record of what was sent", async () => {
    await include(arjunApp);
    await t.asUser(
      ids.centralUser,
      `update shortlist_entries set included = false where application_id = $1`,
      [arjunApp],
    );

    const scheduled = await t.sql(
      `select id from attendance where round_id = $1 and application_id = $2`,
      [round1, arjunApp],
    );
    expect(scheduled).toHaveLength(0);

    const notes = await notificationsFor(ids.arjun);
    // The shortlisted note stays: it WAS sent. (Earlier tests may have left
    // him other kinds; the point here is un-inclusion retracts nothing.)
    expect(notes.filter((n) => n.kind === "shortlisted")).toHaveLength(1);
  });

  it("does not schedule twice when the same entry is saved again", async () => {
    await include(priyaApp);
    const rows = await t.sql(
      `select id from round_participants where round_id = $1 and application_id = $2`,
      [round1, priyaApp],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("round results notify — both ways (client's correction, 2026-08-12)", () => {
  it("tells the student they cleared, naming the round", async () => {
    await t.asUser(
      ids.centralUser,
      `insert into round_results (round_id, application_id, result, declared_by)
       values ($1, $2, 'selected', $3)`,
      [round1, priyaApp, ids.centralUser],
    );

    const notes = await notificationsFor(ids.priya);
    const cleared = notes.find((n) => n.kind === "round_cleared");
    expect(cleared).toBeDefined();
    expect(String(cleared?.title)).toMatch(/round 1/i);
    expect(String(cleared?.title)).toMatch(/Zoho/);
  });

  it("tells the student they were not selected", async () => {
    await t.sql(
      `insert into round_results (round_id, application_id, result, declared_by)
       values ($1, $2, 'rejected', $3)`,
      [round2, priyaApp, ids.centralUser],
    );

    const notes = await notificationsFor(ids.priya);
    expect(notes.some((n) => n.kind === "round_not_selected")).toBe(true);
  });

  it("stays quiet on waitlisted — an interim state is not an outcome", async () => {
    const before = (await notificationsFor(ids.arjun)).length;

    await t.sql(
      `insert into round_results (round_id, application_id, result, declared_by)
       values ($1, $2, 'waitlisted', $3)
       on conflict (round_id, application_id) do update set result = 'waitlisted'`,
      [round2, arjunApp, ids.centralUser],
    );

    expect(await notificationsFor(ids.arjun)).toHaveLength(before);
  });
});

describe("an offer notifies (D8)", () => {
  it("tells the student when an on-campus offer is declared", async () => {
    await t.sql(
      `insert into offers (student_id, drive_id, source, company_name, drive_type, offer_category, ctc_lpa, declared_by)
       values ($1, $2, 'on_campus', 'Zoho', 'placement', 'dream', 8, $3)`,
      [ids.priya, drive, ids.centralUser],
    );

    const notes = await notificationsFor(ids.priya);
    const offer = notes.find((n) => n.kind === "offer");
    expect(offer).toBeDefined();
    expect(String(offer?.title)).toMatch(/Zoho/);
  });
});

describe("students read their own notifications and nobody else's", () => {
  it("shows priya hers", async () => {
    const rows = await t.asUser(ids.priyaUser, `select kind from notifications`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("shows arjun none of priya's", async () => {
    const rows = await t.asUser(ids.arjunUser, `select kind, student_id from notifications`);
    expect(rows.every((r) => r.student_id !== ids.priya)).toBe(true);
  });
});
