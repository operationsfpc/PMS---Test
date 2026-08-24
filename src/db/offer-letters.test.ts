import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0062 — offer letters (spec B, approved 2026-08-24).
 *
 * The attachment travels whole or not at all: a path with no display name is
 * a link nobody can label; a name with no path is a label that opens nothing.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let driveId: string;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  const [drive] = await t.sql(
    `insert into drives (company_name, status, drive_type, offer_category, role_title,
       job_description, work_locations, ctc_min_lpa, role_category, created_by,
       application_start, application_end)
     values ('Zoho', 'in_rounds', 'placement', 'dream', 'MTS', 'Build', 'Chennai', 6,
       'software_technical', $1, now(), now() + interval '1 day') returning id`,
    [ids.centralUser],
  );
  driveId = drive?.id as string;
}, 60_000);

describe("0062 — the attachment is whole or absent", () => {
  it("accepts an offer with both halves, and one with neither", async () => {
    const rows = await t.sql(
      `insert into offers (student_id, drive_id, source, company_name, drive_type,
         offer_category, ctc_lpa, declared_by, attachment_path, attachment_name)
       values ($1, $2, 'on_campus', 'Zoho', 'placement', 'dream', 6, $3,
         $4, 'letter.pdf') returning id`,
      [ids.priya, driveId, ids.centralUser, "p/d/letter.pdf"],
    );
    expect(rows).toHaveLength(1);
    await t.sql(`delete from offers where id = $1`, [rows[0]?.id]);

    const bare = await t.sql(
      `insert into offers (student_id, drive_id, source, company_name, drive_type,
         offer_category, ctc_lpa, declared_by)
       values ($1, $2, 'on_campus', 'Zoho', 'placement', 'dream', 6, $3) returning id`,
      [ids.priya, driveId, ids.centralUser],
    );
    expect(bare).toHaveLength(1);
  });

  it("refuses a path with no name, and a name with no path", async () => {
    await t.expectRejection(
      () =>
        t.sql(`update offers set attachment_path = 'p/d/letter.pdf' where student_id = $1`, [
          ids.priya,
        ]),
      /offer_attachment_is_whole/i,
    );
    await t.expectRejection(
      () =>
        t.sql(`update offers set attachment_name = 'letter.pdf' where student_id = $1`, [
          ids.priya,
        ]),
      /offer_attachment_is_whole/i,
    );
  });
});
