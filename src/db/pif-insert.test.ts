import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Regression: an Account Executive could not save a PIF at all.
 *
 * `pif-repository.test.ts` proves the repository against a fake client, so it
 * cannot see RLS. This runs the same insert as a real AE against the real
 * policies, which is where it actually broke.
 */

let t: TestDb;
let aeUser: string;

beforeAll(async () => {
  t = await createTestDb();
  await seed(t);

  aeUser = "30000000-0000-0000-0000-0000000000ae";
  await t.sql(
    `insert into staff_invitations (email, full_name, role)
     values ('ae@faceprep.in','Shashwathi AE','account_executive')`,
  );
  await t.sql(`insert into auth.users (id, email) values ($1,'ae@faceprep.in')`, [aeUser]);
}, 60_000);

/** Exactly what the form sends for a company-details-only first save. */
const insertPif = (status: "draft" | "submitted", actor: string) =>
  t.asUser(
    actor,
    `insert into drives (
       company_name, industry, company_website,
       spoc_name, spoc_designation, spoc_email, spoc_phone,
       arrears_policy, eligible_passing_years, status, created_by
     ) values ('TCS','Technology','https://www.tcs.com/',
       'ABC','HR Manager','abc@gmail.com','9876543210',
       'flexible', '{}', $1::drive_status, $2)
     returning id, status`,
    [status, actor],
  );

describe("an Account Executive raising a PIF", () => {
  it("can save it as a draft", async () => {
    const rows = await insertPif("draft", aeUser);
    expect(rows[0]?.status).toBe("draft");
  });

  it("can submit it to the Delivery Head", async () => {
    const rows = await insertPif("submitted", aeUser);
    expect(rows[0]?.status).toBe("submitted");
  });
});
