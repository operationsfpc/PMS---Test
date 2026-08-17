import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * 0049 — P10. The SRF stores the preferences and resumes it collects.
 *
 * The form has demanded one resume per selected area since the beginning and
 * `submit_srf` stored neither the areas nor the files. These tests are the
 * proof that a submission now leaves both behind, and — just as important —
 * that a RESUBMISSION does not destroy a resume the student did not re-upload
 * or one that a recruiter was already sent.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const submit = async (
  categories: readonly string[],
  resumes: ReadonlyArray<{ role_category: string; storage_path: string }>,
) =>
  await t.asUser(
    ids.priyaUser,
    `select * from submit_srf($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)`,
    [
      JSON.stringify({
        full_name: "Priya Ramesh",
        mobile: "9876543210",
        tenth_percentage: 91.4,
        twelfth_percentage: 88,
        passing_year: 2026,
        programme_level: "ug",
      }),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify(categories),
      JSON.stringify(resumes.map((r) => ({ ...r, size_bytes: 1024 }))),
    ],
  );

const preferences = async () =>
  (
    await t.sql(
      `select category from student_role_preferences where student_id = $1 order by category::text`,
      [ids.priya],
    )
  ).map((r) => r.category);

const profileResumes = async () =>
  await t.sql(
    `select role_category, storage_path from student_documents
      where student_id = $1 and kind = 'resume' and drive_id is null
      order by role_category::text`,
    [ids.priya],
  );

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  // A submitted form is what the student is allowed to send: 0020 permits
  // registered/rejected -> submitted, never a change to an approved one.
  await t.sql(`update students set srf_status = 'registered' where id = $1`, [ids.priya]);
}, 60_000);

describe("submitting the registration form", () => {
  it("records every area the student asked to be considered for", async () => {
    await submit(
      ["software_technical", "sales"],
      [
        { role_category: "software_technical", storage_path: "p/sw.pdf" },
        { role_category: "sales", storage_path: "p/sales.pdf" },
      ],
    );

    expect(await preferences()).toEqual(["sales", "software_technical"]);
  });

  it("records one profile resume per area, with the file behind it", async () => {
    await submit(
      ["software_technical"],
      [{ role_category: "software_technical", storage_path: "p/sw.pdf" }],
    );

    expect(await profileResumes()).toEqual([
      { role_category: "software_technical", storage_path: "p/sw.pdf" },
    ]);
  });

  it("refuses a resume for an area that is not a real one", async () => {
    await t.expectRejection(
      () =>
        submit(["software_technical"], [{ role_category: "astrology", storage_path: "p/x.pdf" }]),
      /invalid input value for enum role_category/i,
    );
  });
});

describe("submitting it again", () => {
  beforeEach(async () => {
    await submit(
      ["software_technical", "sales"],
      [
        { role_category: "software_technical", storage_path: "p/sw-1.pdf" },
        { role_category: "sales", storage_path: "p/sales-1.pdf" },
      ],
    );
    await t.sql(`update students set srf_status = 'srf_rejected' where id = $1`, [ids.priya]);
  });

  it("replaces a resume the student uploaded again", async () => {
    await submit(
      ["software_technical", "sales"],
      [
        { role_category: "software_technical", storage_path: "p/sw-2.pdf" },
        { role_category: "sales", storage_path: "p/sales-1b.pdf" },
      ],
    );

    expect((await profileResumes()).map((r) => r.storage_path)).toEqual([
      "p/sales-1b.pdf",
      "p/sw-2.pdf",
    ]);
  });

  /**
   * A student correcting one line of a sent-back form re-attaches their
   * marksheets, not necessarily every resume. Deleting the ones they did not
   * re-upload would silently strip a CV a recruiter is about to be sent.
   */
  it("keeps a resume the student did not upload again", async () => {
    await submit(
      ["software_technical", "sales"],
      [{ role_category: "software_technical", storage_path: "p/sw-2.pdf" }],
    );

    expect((await profileResumes()).map((r) => r.storage_path)).toEqual([
      "p/sales-1.pdf",
      "p/sw-2.pdf",
    ]);
  });

  it("drops the resume for an area the student has stopped asking for", async () => {
    await submit(
      ["software_technical"],
      [{ role_category: "software_technical", storage_path: "p/sw-2.pdf" }],
    );

    expect(await preferences()).toEqual(["software_technical"]);
    expect((await profileResumes()).map((r) => r.role_category)).toEqual(["software_technical"]);
  });

  /**
   * 0033's resume-per-application. It carries a drive_id, it is what a
   * recruiter was actually sent, and it is not the SRF's to replace.
   */
  it("never touches a resume uploaded for one application", async () => {
    const drive = (
      await t.sql(
        // Draft, deliberately: `live_requires_complete_record` demands a whole
        // PIF, and none of that is what this test is about.
        `insert into drives (company_name, created_by) values ('Zoho', $1) returning id`,
        [ids.adminUser],
      )
    )[0]?.id as string;

    await t.sql(
      `insert into student_documents (student_id, kind, role_category, drive_id, storage_path, size_bytes)
       values ($1, 'resume', 'software_technical', $2, 'p/zoho-application.pdf', 900)`,
      [ids.priya, drive],
    );

    await submit(
      ["software_technical"],
      [{ role_category: "software_technical", storage_path: "p/sw-3.pdf" }],
    );

    const rows = await t.sql(
      `select storage_path from student_documents where student_id = $1 and drive_id is not null`,
      [ids.priya],
    );
    expect(rows.map((r) => r.storage_path)).toEqual(["p/zoho-application.pdf"]);
  });
});

describe("who can read a student's chosen areas", () => {
  beforeEach(async () => {
    await submit(
      ["software_technical"],
      [{ role_category: "software_technical", storage_path: "p/sw.pdf" }],
    );
  });

  it("the student themselves", async () => {
    const rows = await t.asUser(
      ids.priyaUser,
      `select category from student_role_preferences where student_id = $1`,
      [ids.priya],
    );
    expect(rows).toHaveLength(1);
  });

  it("their campus coordinator, who fields their questions", async () => {
    const rows = await t.asUser(
      ids.cpcUser,
      `select category from student_role_preferences where student_id = $1`,
      [ids.priya],
    );
    expect(rows).toHaveLength(1);
  });

  /** Publishing counts an audience with this, so an org reader must see it. */
  it("the central coordinator, who publishes to them", async () => {
    const rows = await t.asUser(
      ids.centralUser,
      `select category from student_role_preferences where student_id = $1`,
      [ids.priya],
    );
    expect(rows).toHaveLength(1);
  });

  it("never another student", async () => {
    await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [
      ids.arjunUser,
    ]);
    const rows = await t.asUser(
      ids.arjunUser,
      `select category from student_role_preferences where student_id = $1`,
      [ids.priya],
    );
    expect(rows).toHaveLength(0);
  });
});
