import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * `0070` — an internship offer records a stipend, not a CTC.
 *
 * Karthik, 2026-08-27: "go with option 1". P10 let a DRIVE go live on a
 * stipend alone; the OFFER at the end of it still demanded an annual CTC,
 * because `offers.ctc_lpa` was NOT NULL. Two live offers on a drive paying
 * ₹15,000 a month were therefore recorded at ₹10 LPA and ₹12 LPA.
 *
 * The constraint mirrors `offerPayProblem` in `src/domain/offer-pay.ts`.
 * Change both or neither.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let internship: string;
let placement: string;

const declare = async (
  driveId: string,
  driveType: string,
  category: string,
  ctc: number | null,
  stipend: number | null,
) =>
  await t.sql(
    `insert into offers (student_id, drive_id, source, company_name, drive_type,
                         offer_category, ctc_lpa, stipend_monthly, declared_by)
     values ($1, $2, 'on_campus', 'Zoho', $3, $4, $5, $6, $7)`,
    [ids.priya, driveId, driveType, category, ctc, stipend, ids.centralUser],
  );

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);

  internship = (
    await t.sql(
      `insert into drives (company_name, status, drive_type, offer_category, stipend_min_monthly)
       values ('Zoho', 'draft', 'internship', 'internship', 15000) returning id`,
    )
  )[0]?.id as string;
  placement = (
    await t.sql(
      `insert into drives (company_name, status, drive_type, offer_category, ctc_min_lpa)
       values ('Zoho', 'draft', 'placement', 'dream', 8) returning id`,
    )
  )[0]?.id as string;
}, 60_000);

describe("what an offer must record", () => {
  it("accepts an internship offer paid a stipend and no CTC", async () => {
    await expect(
      declare(internship, "internship", "internship", null, 15000),
    ).resolves.toBeTruthy();
  });

  it("accepts a salaried offer paid a CTC and no stipend", async () => {
    await expect(declare(placement, "placement", "dream", 8, null)).resolves.toBeTruthy();
  });

  /** The whole point: the box that forced ₹10 LPA is gone. */
  it("refuses an internship offer carrying a CTC", async () => {
    await expect(declare(internship, "internship", "internship", 10, 15000)).rejects.toThrow(
      /offer_records_what_it_pays/,
    );
  });

  it("refuses an internship offer with no stipend at all", async () => {
    await expect(declare(internship, "internship", "internship", null, null)).rejects.toThrow(
      /offer_records_what_it_pays/,
    );
  });

  it("refuses a salaried offer with no CTC", async () => {
    await expect(declare(placement, "placement", "dream", null, null)).rejects.toThrow(
      /offer_records_what_it_pays/,
    );
  });

  it("refuses a salaried offer that leans on a stipend", async () => {
    await expect(declare(placement, "placement", "dream", 8, 15000)).rejects.toThrow(
      /offer_records_what_it_pays/,
    );
  });

  /**
   * A convertible internship becomes a salary, so it is quoted as one — the
   * same line 0067 drew for drives.
   */
  it("treats a convertible internship as salaried", async () => {
    const convertible = (
      await t.sql(
        `insert into drives (company_name, status, drive_type, offer_category, ctc_min_lpa)
         values ('Zoho', 'draft', 'internship_convertible', 'regular', 4) returning id`,
      )
    )[0]?.id as string;

    await expect(
      declare(convertible, "internship_convertible", "regular", 4.5, null),
    ).resolves.toBeTruthy();
    await expect(
      declare(convertible, "internship_convertible", "regular", null, 15000),
    ).rejects.toThrow(/offer_records_what_it_pays/);
  });

  it("still refuses a negative figure on either side", async () => {
    await expect(declare(placement, "placement", "dream", -1, null)).rejects.toThrow();
    await expect(declare(internship, "internship", "internship", null, -500)).rejects.toThrow();
  });
});

/**
 * 🔴 The half the first attempt did not test, and paid for.
 *
 * `0070` was pushed once with the repair placed BEFORE `drop not null`. It
 * failed on the real database with 23502 and rolled back whole. The PGlite
 * suite had passed, because a fresh test database holds no legacy rows for
 * the UPDATE to touch — so the statement ran against nothing and the ordering
 * bug was invisible.
 *
 * The repair is now a function, and these tests create the legacy shape on
 * purpose. The constraint has to be lifted to write a row that the constraint
 * exists to forbid; it is put back afterwards, which also proves the repaired
 * data satisfies it.
 */
describe("repairing the offers that were declared before this rule existed", () => {
  const withoutTheConstraint = async (body: () => Promise<void>) => {
    await t.sql(`alter table offers drop constraint offer_records_what_it_pays`);
    try {
      await body();
    } finally {
      await t.sql(
        `alter table offers add constraint offer_records_what_it_pays check (
           case
             when drive_type = 'internship'
               then stipend_monthly is not null and ctc_lpa is null
             else ctc_lpa is not null and stipend_monthly is null
           end
         )`,
      );
    }
  };

  it("moves the invented CTC onto the stipend the drive actually records", async () => {
    await withoutTheConstraint(async () => {
      await t.sql(
        `insert into offers (student_id, drive_id, source, company_name, drive_type,
                             offer_category, ctc_lpa, declared_by)
         values ($1, $2, 'on_campus', 'XYZ', 'internship', 'internship', 10, $3)`,
        [ids.arjun, internship, ids.centralUser],
      );

      const rows = (await t.sql(`select repair_internship_offer_pay()`)) as Array<{
        repair_internship_offer_pay: number;
      }>;
      expect(rows[0]?.repair_internship_offer_pay ?? 0).toBeGreaterThanOrEqual(1);

      const [row] = await t.sql(
        `select ctc_lpa, stipend_monthly from offers
          where student_id = $1 and drive_type = 'internship'`,
        [ids.arjun],
      );
      // The figure comes from the DRIVE, not from a constant in the migration.
      expect(row?.stipend_monthly).toBe(15000);
      expect(row?.ctc_lpa).toBeNull();
    });
  });

  /** Re-adding the constraint above would have thrown if the repair missed a row. */
  it("leaves the repaired rows satisfying the constraint that follows them", async () => {
    const [row] = await t.sql(
      `select count(*) as bad from offers
        where drive_type = 'internship' and (ctc_lpa is not null or stipend_monthly is null)`,
    );
    expect(Number(row?.bad)).toBe(0);
  });

  it("does not touch an offer that already records its stipend", async () => {
    const before = await t.sql(
      `select id, stipend_monthly from offers where drive_type = 'internship'`,
    );
    await t.sql(`select repair_internship_offer_pay()`);
    const after = await t.sql(
      `select id, stipend_monthly from offers where drive_type = 'internship'`,
    );
    expect(after).toEqual(before);
  });

  it("leaves an internship offer alone when its drive records no stipend either", async () => {
    const bare = (
      await t.sql(
        `insert into drives (company_name, status, drive_type, offer_category)
         values ('No Stipend Ltd', 'draft', 'internship', 'internship') returning id`,
      )
    )[0]?.id as string;

    await withoutTheConstraint(async () => {
      await t.sql(
        `insert into offers (student_id, drive_id, source, company_name, drive_type,
                             offer_category, ctc_lpa, declared_by)
         values ($1, $2, 'on_campus', 'No Stipend Ltd', 'internship', 'internship', 7, $3)`,
        [ids.priya, bare, ids.centralUser],
      );
      await t.sql(`select repair_internship_offer_pay()`);

      const [row] = await t.sql(`select ctc_lpa, stipend_monthly from offers where drive_id = $1`, [
        bare,
      ]);
      // Guessing a stipend from nothing would be inventing the very figure
      // this migration exists to remove. It is left for a person.
      expect(row?.ctc_lpa).toBe("7.00");
      expect(row?.stipend_monthly).toBeNull();

      await t.sql(`delete from offers where drive_id = $1`, [bare]);
    });
  });
});
