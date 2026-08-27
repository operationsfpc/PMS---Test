import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * `0068` — UAT 2026-08-27.
 *
 * Two faults in what a notification CARRIES, both visible in
 * `docs/inbox/WhatsApp Image 2026-08-27 at 17.54.15.jpeg`:
 *
 * 1. **The category was spelled by the database.** The body read
 *    "has made you an offer (super dream)" because `offer_reaches_student`
 *    did `replace(offer_category::text, '_', ' ')`. Commits 12befe2 and
 *    3531b0c gave every SCREEN one spelling; the triggers kept their own.
 *    Postgres now holds the same four labels the domain does.
 *
 * 2. **A notification could not be linked back to its drive.** The student
 *    was told they had an offer and given nowhere to open the offer letter
 *    the CPC had attached. `notifications.drive_id` is that link.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let drive: string;

const OPTED = "54000000-0000-0000-0000-000000000001";

const notesFor = (studentId: string) =>
  t.sql(
    `select kind, title, body, drive_id from notifications
      where student_id = $1 order by created_at`,
    [studentId],
  );

const declare = async (
  studentId: string,
  category: string | null,
  driveType: string,
  ctc: number | null,
) =>
  await t.sql(
    `insert into offers (student_id, drive_id, source, company_name, drive_type,
                         offer_category, ctc_lpa, declared_by)
     values ($1, $2, 'on_campus', 'Zoho', $3, $4, $5, $6)`,
    [studentId, drive, driveType, category, ctc, ids.centralUser],
  );

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  const [row] = await t.sql(
    `insert into drives (company_name, status, drive_type, offer_category, ctc_min_lpa)
     values ('Zoho', 'draft', 'placement', 'dream', 8) returning id`,
  );
  drive = row?.id as string;
}, 60_000);

describe("the category is spelled by the domain's labels, not by replace()", () => {
  it("names Super Dream, not 'super dream'", async () => {
    await declare(ids.priya, "super_dream", "placement", 12);

    const body = String((await notesFor(ids.priya)).find((n) => n.kind === "offer")?.body);
    expect(body).toContain("(Super Dream)");
    expect(body).not.toContain("super dream");
  });

  it("names Dream", async () => {
    await declare(ids.arjun, "dream", "placement", 8);

    const body = String((await notesFor(ids.arjun)).find((n) => n.kind === "offer")?.body);
    expect(body).toContain("(Dream)");
  });

  /** PB4, 2026-08-27: an internship is named, never bracketed. */
  it("still says 'an internship offer' rather than bracketing the category", async () => {
    const [second] = await t.sql(
      `insert into drives (company_name, status, drive_type, offer_category, stipend_min_monthly)
       values ('Infosys', 'draft', 'internship', 'internship', 15000) returning id`,
    );
    await t.sql(
      // SPEC CHANGE 2026-08-27 (approved, 0070): an internship offer records
      // a stipend, never a CTC — the `0` here was itself the defect.
      `insert into offers (student_id, drive_id, source, company_name, drive_type,
                           offer_category, ctc_lpa, stipend_monthly, declared_by)
       values ($1, $2, 'on_campus', 'Infosys', 'internship', 'internship', null, 15000, $3)`,
      [ids.priya, second?.id, ids.centralUser],
    );

    const body = String((await notesFor(ids.priya)).filter((n) => n.kind === "offer").at(-1)?.body);
    expect(body).toContain("internship offer");
    expect(body).not.toContain("(");
  });
});

/**
 * The 0067 lesson, kept honest: CREATE OR REPLACE cannot patch a body, so
 * every guard in the function has to be re-proved after it is rewritten.
 */
describe("the guards the rewrite had to carry across", () => {
  it("still says nothing to a student who opted out", async () => {
    await t.sql(
      `insert into students (id, campus_id, degree_id, branch_id, roll_number, full_name,
                             email, passing_year, srf_status, consent_given_at,
                             participation_status)
       values ($1,$2,$3,$4,'21CSE5555','Meena V','meena@gmail.com',2026,'srf_approved',
               now(),'opted_out')`,
      [OPTED, ids.campusA, ids.degree, ids.branch],
    );

    await declare(OPTED, "dream", "placement", 8);

    expect(await notesFor(OPTED)).toHaveLength(0);
  });

  it("still says nothing about a self-placed offer — that is the student's own news", async () => {
    const before = (await notesFor(ids.arjun)).length;
    await t.sql(
      `insert into offers (student_id, drive_id, source, company_name, drive_type,
                           offer_category, ctc_lpa, declared_by, approved_by)
       values ($1, null, 'self_placed', 'Own Find', 'placement', 'regular', 4, $2, $2)`,
      [ids.arjun, ids.centralUser],
    );

    expect(await notesFor(ids.arjun)).toHaveLength(before);
  });
});

describe("a notification can be linked back to its drive", () => {
  it("stamps the offer notification with the drive it came from", async () => {
    const offer = (await notesFor(ids.priya)).find((n) => n.kind === "offer");
    expect(offer?.drive_id).toBe(drive);
  });

  it("leaves the column null where there is no drive to point at", async () => {
    const [row] = await t.sql(
      `insert into notifications (student_id, kind, title, body)
       values ($1, 'system', 'Welcome', 'Hello') returning drive_id`,
      [ids.priya],
    );
    expect(row?.drive_id).toBeNull();
  });

  it("forgets the notification's drive pointer if the drive is ever deleted", async () => {
    const [d] = await t.sql(
      `insert into drives (company_name, status, drive_type, offer_category, ctc_min_lpa)
       values ('Temp', 'draft', 'placement', 'regular', 4) returning id`,
    );
    const [n] = await t.sql(
      `insert into notifications (student_id, kind, title, body, drive_id)
       values ($1, 'system', 'x', 'y', $2) returning id`,
      [ids.priya, d?.id],
    );

    await t.sql(`delete from drives where id = $1`, [d?.id]);

    const [after] = await t.sql(`select drive_id from notifications where id = $1`, [n?.id]);
    // The notification is a RECORD of what the student was told; it must
    // survive the drive. Only the pointer goes.
    expect(after).toBeDefined();
    expect(after?.drive_id).toBeNull();
  });
});
