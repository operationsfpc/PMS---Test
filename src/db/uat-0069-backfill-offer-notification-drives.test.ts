import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * `0069` — the notifications that were written before `0068` existed.
 *
 * 0068 gave `notifications` a `drive_id` and taught the offer trigger to set
 * it. Production held **14 offer notifications and every one of them had a
 * null drive** — so the students with an offer letter already on file would
 * have gone on seeing nothing in their Notifications, which is the half of
 * the bug Karthik actually reported.
 *
 * The backfill is a FUNCTION, not a bare UPDATE, so it can be tested at all:
 * a statement that runs once inside a migration runs before any test data
 * exists and can only ever be proved by reading it.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let zoho: string;

const link = () => t.sql(`select link_offer_notifications_to_drives() as linked`);

const noteDrive = async (title: string) =>
  (await t.sql(`select drive_id from notifications where title = $1`, [title]))[0]?.drive_id ??
  null;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  zoho = (
    await t.sql(
      `insert into drives (company_name, status, drive_type, offer_category)
       values ('Zoho', 'draft', 'placement', 'dream') returning id`,
    )
  )[0]?.id as string;
}, 60_000);

describe("linking an old offer notification back to its drive", () => {
  it("links the notification whose title names the company the offer came from", async () => {
    await t.sql(
      `insert into offers (student_id, drive_id, source, company_name, drive_type,
                           offer_category, ctc_lpa, declared_by)
       values ($1, $2, 'on_campus', 'Zoho', 'placement', 'dream', 8, $3)`,
      [ids.priya, zoho, ids.centralUser],
    );
    // The trigger stamped the new one; blank it to stand in for a pre-0068 row.
    await t.sql(`update notifications set drive_id = null where kind = 'offer'`);

    await link();

    expect(await noteDrive("Offer from Zoho")).toBe(zoho);
  });

  it("leaves a notification alone when no offer of that student names that company", async () => {
    await t.sql(
      `insert into notifications (student_id, kind, title, body)
       values ($1, 'offer', 'Offer from Nowhere Ltd', 'Congratulations.')`,
      [ids.arjun],
    );

    await link();

    expect(await noteDrive("Offer from Nowhere Ltd")).toBeNull();
  });

  /**
   * Two offers from the same company, on two drives, is a real shape — a
   * student may be offered by Zoho twice. Guessing which one the message meant
   * would put the wrong letter under the right words.
   */
  it("refuses to guess when the student holds two offers from the same company", async () => {
    const second = (
      await t.sql(
        `insert into drives (company_name, status, drive_type, offer_category)
         values ('Ambiguous Co', 'draft', 'placement', 'dream') returning id`,
      )
    )[0]?.id as string;
    const third = (
      await t.sql(
        `insert into drives (company_name, status, drive_type, offer_category)
         values ('Ambiguous Co', 'draft', 'placement', 'dream') returning id`,
      )
    )[0]?.id as string;

    for (const driveId of [second, third]) {
      await t.sql(
        `insert into offers (student_id, drive_id, source, company_name, drive_type,
                             offer_category, ctc_lpa, declared_by)
         values ($1, $2, 'on_campus', 'Ambiguous Co', 'placement', 'dream', 9, $3)`,
        [ids.arjun, driveId, ids.centralUser],
      );
    }
    await t.sql(`update notifications set drive_id = null where title = 'Offer from Ambiguous Co'`);

    await link();

    expect(await noteDrive("Offer from Ambiguous Co")).toBeNull();
  });

  it("never touches a notification that already names a drive", async () => {
    const before = await noteDrive("Offer from Zoho");
    await link();
    expect(await noteDrive("Offer from Zoho")).toBe(before);
  });

  it("never touches anything that is not an offer notification", async () => {
    await t.sql(
      `insert into notifications (student_id, kind, title, body)
       values ($1, 'shortlisted', 'Offer from Zoho', 'Not an offer at all')`,
      [ids.arjun],
    );

    await link();

    const rows = await t.sql(
      `select drive_id from notifications where kind = 'shortlisted' and title = 'Offer from Zoho'`,
    );
    expect(rows[0]?.drive_id).toBeNull();
  });
});
