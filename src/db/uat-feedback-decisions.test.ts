import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0032 — the UAT feedback of 2026-08-06, in the schema.
 *
 * F1: a decline must carry a reason, because it is the only thing the student
 * is ever told. F7, F11 and F12: the PIF gained the other designations one
 * interview process covers, the number of rounds, and a cutoff that may be
 * stated as a percentage.
 */
let t: TestDb;
let STUDENT: string;
let PROFILE: string;

let DECLARATION: string;
let LETTER: string;

beforeAll(async () => {
  t = await createTestDb();
  const ids = await seed(t);
  STUDENT = ids.priya;
  PROFILE = ids.centralUser;

  // 0022 already refuses either request without its evidence; these tests are
  // about the DECISION, so both requests carry a document throughout.
  const document = async (kind: string, path: string) =>
    (
      await t.sql(
        `insert into student_documents (student_id, kind, storage_path, size_bytes)
         values ($1, $2, $3, 1000) returning id`,
        [STUDENT, kind, path],
      )
    )[0]?.id as string;

  DECLARATION = await document("opt_out_declaration", "priya/declaration.pdf");
  LETTER = await document("offer_letter", "priya/offer.pdf");
}, 60_000);

describe("0032 — declining a participation request", () => {
  it("records the coordinator's reason on an opt-out", async () => {
    const [row] = await t.sql(
      `insert into opt_out_requests (student_id, reason, status, decided_by, decided_at, decision_reason, declaration_id)
       values ($1, 'Higher studies', 'rejected', $2, now(), 'The letter is not signed.', $3)
       returning decision_reason`,
      [STUDENT, PROFILE, DECLARATION],
    );

    expect(row?.decision_reason).toBe("The letter is not signed.");
  });

  /** A decline the student cannot understand is the bug F1 was raised about. */
  it("refuses to decline an opt-out without saying why", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into opt_out_requests (student_id, reason, status, decided_by, decided_at, declaration_id)
           values ($1, 'Higher studies', 'rejected', $2, now(), $3)`,
          [STUDENT, PROFILE, DECLARATION],
        ),
      /decline_states_a_reason|violates check constraint/i,
    );
  });

  it("refuses a blank reason just as firmly as a missing one", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into opt_out_requests (student_id, reason, status, decided_by, decided_at, decision_reason, declaration_id)
           values ($1, 'Higher studies', 'rejected', $2, now(), '   ', $3)`,
          [STUDENT, PROFILE, DECLARATION],
        ),
      /decline_states_a_reason|violates check constraint/i,
    );
  });

  it("asks for no reason when the request is approved", async () => {
    const [row] = await t.sql(
      `insert into opt_out_requests (student_id, reason, status, decided_by, decided_at, declaration_id)
       values ($1, 'Family business', 'verified', $2, now(), $3)
       returning status`,
      [STUDENT, PROFILE, DECLARATION],
    );

    expect(row?.status).toBe("verified");
  });

  it("records the reason on a declined off-campus offer too", async () => {
    const [row] = await t.sql(
      `insert into self_placement_requests
         (student_id, company_name, ctc_lpa, status, decided_by, decided_at, decision_reason, offer_letter_id)
       values ($1, 'Acme', 6, 'rejected', $2, now(), 'The offer letter is unreadable.', $3)
       returning decision_reason`,
      [STUDENT, PROFILE, LETTER],
    );

    expect(row?.decision_reason).toBe("The offer letter is unreadable.");
  });

  it("refuses to decline an off-campus offer without saying why", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into self_placement_requests (student_id, company_name, ctc_lpa, status, decided_by, decided_at, offer_letter_id)
           values ($1, 'Acme', 6, 'rejected', $2, now(), $3)`,
          [STUDENT, PROFILE, LETTER],
        ),
      /decline_states_a_reason|violates check constraint/i,
    );
  });
});

describe("0032 — what the PIF now collects", () => {
  const drive = async (columns: string, values: string) =>
    (
      await t.sql(
        `insert into drives (company_name, ${columns}) values ('Zoho', ${values}) returning *`,
      )
    )[0];

  it("keeps every designation one interview process covers on one drive", async () => {
    const row = await drive(
      "role_title, additional_designations",
      `'Member Technical Staff', array['Associate Engineer','Trainee Engineer']`,
    );

    expect(row?.additional_designations).toEqual(["Associate Engineer", "Trainee Engineer"]);
  });

  it("names no extra designations unless the AE said so", async () => {
    const row = await drive("role_title", `'Member Technical Staff'`);

    expect(row?.additional_designations).toEqual([]);
  });

  it("carries the number of rounds the recruiter runs", async () => {
    const row = await drive("round_count", "4");

    expect(Number(row?.round_count)).toBe(4);
  });

  it("refuses a selection process with no rounds in it", async () => {
    await t.expectRejection(
      () => t.sql(`insert into drives (company_name, round_count) values ('Zoho', 0)`),
      /violates check constraint/i,
    );
  });

  /**
   * The declared figure and the comparable one are different columns on
   * purpose: a coordinator checks the first against the recruiter's email, and
   * R5 filters students on the second.
   */
  it("stores the cutoff the recruiter stated, on the scale they stated it", async () => {
    const row = await drive(
      "min_overall_marks, min_overall_cgpa_scale, min_overall_cgpa",
      `65, 'percentage', 6.84`,
    );

    expect(Number(row?.min_overall_marks)).toBe(65);
    expect(row?.min_overall_cgpa_scale).toBe("percentage");
    expect(Number(row?.min_overall_cgpa)).toBe(6.84);
  });

  it("still refuses a comparable cutoff that is not on the 10-point scale", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into drives (company_name, min_overall_marks, min_overall_cgpa_scale, min_overall_cgpa)
           values ('Zoho', 65, 'percentage', 65)`,
        ),
      /violates check constraint/i,
    );
  });

  it("defaults the scale to CGPA, so an old row cannot read as a percentage", async () => {
    const row = await drive("min_overall_cgpa", "7.5");

    expect(row?.min_overall_cgpa_scale).toBe("cgpa");
  });
});
