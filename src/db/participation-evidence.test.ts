import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Evidence for the two decisions a student makes about their own placement.
 *
 * UAT 2026-08-05, two items:
 *  - an off-campus placement "should be mandatory for students to upload their
 *    Offer Letter for verification"
 *  - opting out "should mandate the upload of a handwritten and signed
 *    declaration letter confirming their decision"
 *
 * Both are irreversible in practice - an approved opt-out can never be undone
 * (0009), and a self-placement becomes a statistic the college reports - so
 * neither may rest on a student's word alone. The database refuses a request
 * with no document, so no screen can forget to ask.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;
let letter: string;

beforeAll(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);

  letter = (
    await t.sql(
      `insert into student_documents (student_id, kind, storage_path, size_bytes)
       values ($1,'offer_letter','priya/offer.pdf',1000) returning id`,
      [ids.priya],
    )
  )[0]?.id as string;
}, 60_000);

describe("an off-campus placement needs its offer letter", () => {
  it("refuses a self-placement with no offer letter attached", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into self_placement_requests (student_id, company_name, ctc_lpa)
           values ($1,'Family Business',4.5)`,
          [ids.priya],
        ),
      /offer letter|check/i,
    );
  });

  it("accepts one that carries the letter", async () => {
    const rows = await t.sql(
      `insert into self_placement_requests (student_id, company_name, ctc_lpa, offer_letter_id)
       values ($1,'Family Business',4.5,$2) returning id`,
      [ids.priya, letter],
    );

    expect(rows).toHaveLength(1);
  });

  it("lets a student attach their own letter", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `insert into student_documents (student_id, kind, storage_path, size_bytes)
       values ($1,'offer_letter','priya/offer-2.pdf',2000) returning id`,
      [ids.priya],
    );

    expect(rows).toHaveLength(1);
  });
});

describe("opting out needs a signed declaration", () => {
  it("refuses an opt-out with no declaration attached", async () => {
    await t.expectRejection(
      () =>
        t.sql(`insert into opt_out_requests (student_id, reason) values ($1,'Higher studies')`, [
          ids.priya,
        ]),
      /declaration|check/i,
    );
  });

  it("accepts one that carries the declaration", async () => {
    const declaration = (
      await t.sql(
        `insert into student_documents (student_id, kind, storage_path, size_bytes)
         values ($1,'opt_out_declaration','priya/declaration.jpg',3000) returning id`,
        [ids.priya],
      )
    )[0]?.id as string;

    const rows = await t.sql(
      `insert into opt_out_requests (student_id, reason, declaration_id)
       values ($1,'Higher studies',$2) returning id`,
      [ids.priya, declaration],
    );

    expect(rows).toHaveLength(1);
  });

  /** A phone photograph of a signed sheet is the realistic format. */
  it("accepts a photographed declaration, not only a PDF", async () => {
    const rows = await t.sql(
      `select storage_path from student_documents where kind = 'opt_out_declaration'`,
    );

    expect(rows[0]?.storage_path).toMatch(/\.jpg$/);
  });
});

describe("the coordinator can see what they are approving", () => {
  it("shows a CPC the evidence for their own campus", async () => {
    const rows = await t.asUser(
      ids.cpcUser,
      `select d.kind from self_placement_requests r
         join student_documents d on d.id = r.offer_letter_id
        where r.student_id = $1`,
      [ids.priya],
    );

    expect(rows[0]?.kind).toBe("offer_letter");
  });
});
