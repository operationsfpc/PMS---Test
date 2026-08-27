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
