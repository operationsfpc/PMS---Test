import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Self-placement.
 *
 * `offers` deliberately refuses a self-placed row without approval, so a
 * PENDING self-placement cannot live there. It also demands an offer category
 * for anything that is not an internship - but a category is the Delivery
 * Head's decision on a drive, and a self-placed offer has no drive.
 *
 * So the request gets its own table, and the category constraint is narrowed
 * to on-campus offers, where it actually means something.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
}, 60_000);

describe("self-placement requests", () => {
  it("lets a student record one, pending approval", async () => {
    await t.asUser(
      ids.priyaUser,
      `insert into self_placement_requests (student_id, company_name, role_title, ctc_lpa)
       values ($1, 'Freshworks', 'SDE', 12.0)`,
      [ids.priya],
    );

    const rows = await t.sql(`select status from self_placement_requests where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows[0]?.status).toBe("pending");
  });

  it("does not let a student record one for somebody else", async () => {
    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into self_placement_requests (student_id, company_name, ctc_lpa)
           values ($1, 'Ghostwriting Inc', 30.0)`,
          [ids.arjun],
        ),
      /row-level security|permission denied|violates/i,
    );
  });

  it("does not let a student approve their own request", async () => {
    await t.asUser(
      ids.priyaUser,
      `update self_placement_requests set status = 'verified' where student_id = $1`,
      [ids.priya],
    );

    const rows = await t.sql(`select status from self_placement_requests where student_id = $1`, [
      ids.priya,
    ]);
    expect(rows[0]?.status).toBe("pending");
  });
});

describe("approved self-placed offers", () => {
  it("no longer need an offer category, which only a drive can supply", async () => {
    await expect(
      t.sql(
        `insert into offers (student_id, source, company_name, drive_type, ctc_lpa,
                             approved_by, approved_at)
         values ($1, 'self_placed', 'Freshworks', 'placement', 12.0, $2, now())`,
        [ids.priya, ids.cpcUser],
      ),
    ).resolves.toBeDefined();
  });

  it("still cannot exist without an approver", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into offers (student_id, source, company_name, drive_type, ctc_lpa)
           values ($1, 'self_placed', 'Unapproved Co', 'placement', 9.0)`,
          [ids.arjun],
        ),
      /self_placed_needs_approval/i,
    );
  });

  it("still demands a category for an on-campus placement offer", async () => {
    const drive = await t.sql(`insert into drives (company_name) values ('Zoho') returning id`);

    await t.expectRejection(
      () =>
        t.sql(
          `insert into offers (student_id, drive_id, source, company_name, drive_type, ctc_lpa)
           values ($1, $2, 'on_campus', 'Zoho', 'placement', 8.0)`,
          [ids.arjun, drive[0]?.id],
        ),
      /ladder_offer_has_category/i,
    );
  });
});
