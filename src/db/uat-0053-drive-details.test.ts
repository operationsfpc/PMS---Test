import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * `0053` — UAT 2026-08-19: the stipend, the drive's contacts, the round's own
 * schedule, and the per-student meeting slot.
 *
 * A2: an internship pays a monthly stipend, not a CTC — two integer columns,
 *     a range that must ascend.
 * A4: contacts move to their own table, several per drive.
 * F4/F5: a round carries mode, time and link; a participant can carry their
 *     own link and slot (online rounds with individual time slots).
 * F3: advancing can leave a proof of the company's instruction behind.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
}, 60_000);

const raise = (columns: string, values: unknown[]) =>
  t.sql(
    `insert into drives (company_name, status, ${columns})
     values ('Zoho Corporation', 'draft', ${values.map((_, i) => `$${i + 1}`).join(", ")})
     returning id`,
    values,
  );

describe("the stipend (A2)", () => {
  it("stores a monthly range", async () => {
    expect(await raise("stipend_min_monthly, stipend_max_monthly", [15000, 25000])).toHaveLength(1);
  });

  it("stores a single figure with no maximum", async () => {
    expect(await raise("stipend_min_monthly", [20000])).toHaveLength(1);
  });

  it("refuses a range that descends", async () => {
    await expect(raise("stipend_min_monthly, stipend_max_monthly", [25000, 15000])).rejects.toThrow(
      /stipend_range_ascends/,
    );
  });

  it("refuses a zero or negative stipend — unpaid is NULL, not 0", async () => {
    await expect(raise("stipend_min_monthly", [0])).rejects.toThrow(/stipend_is_positive/);
    await expect(raise("stipend_min_monthly", [-5000])).rejects.toThrow(/stipend_is_positive/);
  });
});

describe("the drive's contacts (A4)", () => {
  it("holds several contacts for one drive, in order", async () => {
    const [drive] = await raise("role_title", ["MTS"]);
    await t.sql(
      `insert into drive_contacts (drive_id, sequence, name, designation, email, phone)
       values ($1, 1, 'Karthik R', 'HR Lead', 'karthik@zoho.com', '9840012345'),
              ($1, 2, 'Meena S', 'Recruiter', 'meena@zoho.com', null)`,
      [drive?.id],
    );

    const contacts = await t.sql(
      `select name from drive_contacts where drive_id = $1 order by sequence`,
      [drive?.id],
    );
    expect(contacts.map((c) => c.name)).toEqual(["Karthik R", "Meena S"]);
  });

  it("refuses two contacts in the same position", async () => {
    const [drive] = await raise("role_title", ["MTS"]);
    await t.sql(`insert into drive_contacts (drive_id, sequence, name) values ($1, 1, 'A')`, [
      drive?.id,
    ]);
    await expect(
      t.sql(`insert into drive_contacts (drive_id, sequence, name) values ($1, 1, 'B')`, [
        drive?.id,
      ]),
    ).rejects.toThrow();
  });

  it("goes down with its drive", async () => {
    const [drive] = await raise("role_title", ["MTS"]);
    await t.sql(`insert into drive_contacts (drive_id, sequence, name) values ($1, 1, 'A')`, [
      drive?.id,
    ]);
    await t.sql(`delete from drives where id = $1`, [drive?.id]);
    expect(
      await t.sql(`select 1 from drive_contacts where drive_id = $1`, [drive?.id]),
    ).toHaveLength(0);
  });

  it("a student cannot read the recruiter's phone number", async () => {
    const [drive] = await raise("role_title", ["MTS"]);
    await t.sql(`insert into drive_contacts (drive_id, sequence, name) values ($1, 1, 'A')`, [
      drive?.id,
    ]);
    await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [
      ids.priyaUser,
    ]);
    await t.sql(`update students set auth_user_id = $1 where id = $2`, [ids.priyaUser, ids.priya]);

    const seen = await t.asUser(ids.priyaUser, `select * from drive_contacts where drive_id = $1`, [
      drive?.id,
    ]);
    expect(seen).toHaveLength(0);
  });

  it("the Central CPC reads them", async () => {
    const [drive] = await raise("role_title", ["MTS"]);
    await t.sql(`insert into drive_contacts (drive_id, sequence, name) values ($1, 1, 'A')`, [
      drive?.id,
    ]);

    const seen = await t.asUser(
      ids.centralUser,
      `select name from drive_contacts where drive_id = $1`,
      [drive?.id],
    );
    expect(seen).toHaveLength(1);
  });
});

describe("the round's own details (F4) and the advance proof (F3)", () => {
  const round = async () => {
    const [drive] = await raise("role_title", ["MTS"]);
    const [r] = await t.sql(
      `insert into drive_rounds (drive_id, sequence, name) values ($1, 1, 'Aptitude') returning id`,
      [drive?.id],
    );
    return r?.id as string;
  };

  it("carries mode, scheduled time and a shared link", async () => {
    const id = await round();
    await t.sql(
      `update drive_rounds
          set round_mode = 'virtual',
              round_scheduled_at = '2026-09-01T04:30:00Z',
              round_interview_link = 'https://meet.google.com/abc-defg-hij'
        where id = $1`,
      [id],
    );

    const [row] = await t.sql(`select round_mode from drive_rounds where id = $1`, [id]);
    expect(row?.round_mode).toBe("virtual");
  });

  it("refuses a mode nobody defined", async () => {
    const id = await round();
    await expect(
      t.sql(`update drive_rounds set round_mode = 'telepathy' where id = $1`, [id]),
    ).rejects.toThrow(/round_mode_is_known/);
  });

  it("keeps the proof path an advance left behind", async () => {
    const id = await round();
    await t.sql(`update drive_rounds set advance_proof_path = $2 where id = $1`, [
      id,
      "some-drive/round-1-proof.pdf",
    ]);
    const [row] = await t.sql(`select advance_proof_path from drive_rounds where id = $1`, [id]);
    expect(row?.advance_proof_path).toBe("some-drive/round-1-proof.pdf");
  });
});

describe("the participant's own slot (F5)", () => {
  it("carries an individual link and time", async () => {
    const [drive] = await raise("role_title", ["MTS"]);
    const [r] = await t.sql(
      `insert into drive_rounds (drive_id, sequence, name) values ($1, 1, 'Interview') returning id`,
      [drive?.id],
    );
    const [app] = await t.sql(
      `insert into applications (drive_id, student_id, profile_snapshot) values ($1, $2, '{}') returning id`,
      [drive?.id, ids.priya],
    );
    await t.sql(
      `insert into round_participants (round_id, application_id, meeting_link, participant_scheduled_at)
       values ($1, $2, 'https://meet.google.com/xyz', '2026-09-01T05:00:00Z')`,
      [r?.id, app?.id],
    );

    const [row] = await t.sql(
      `select meeting_link from round_participants where round_id = $1 and application_id = $2`,
      [r?.id, app?.id],
    );
    expect(row?.meeting_link).toBe("https://meet.google.com/xyz");
  });
});
