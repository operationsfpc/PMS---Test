import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * A student can read the drives that were published TO them.
 *
 * Reported 2026-08-05: "even after drives are published by Central PC, they
 * are not shown to eligible students" - TCS and Cognizant, at the one campus,
 * to students who match every criterion.
 *
 * They matched. The drives were `live`, inside their application window,
 * targeted at exactly their campus, degree and branch, with cutoffs every one
 * of them cleared. The student simply could not SEE the row: `0008` gave
 * `drives` five policies and not one of them admits a student -
 *
 *   -- Students never read the drives table directly; they read a filtered view.
 *   create policy drives_staff_read on drives for select using (is_org_reader());
 *
 * - and the filtered view was never built. The screen queries `drives`
 * directly, RLS is a filter rather than a guard, so it returned no rows and no
 * error. Every student has seen an empty drives list since the day it shipped.
 *
 * The domain still decides who may APPLY (R5/R6, with reasons). This is the
 * coarser question underneath it: whose drive is this to look at.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

/** A published drive, targeted or not, as the publish screen writes one. */
async function publishDrive(
  company: string,
  opts: { campus?: string; status?: string } = {},
): Promise<string> {
  // A live drive must be a COMPLETE record (`live_requires_complete_record`),
  // and a rejected one must carry a reason. Both are filled so the fixture is
  // a drive the publish screen could actually have produced.
  const rows = await t.sql(
    `insert into drives (company_name, role_title, job_description, work_locations,
                         ctc_min_lpa, role_category, drive_type, offer_category,
                         status, rejection_reason, application_start, application_end)
     values ($1, 'Software Developer', 'Build things', 'Chennai',
             6.5, 'software_technical', 'placement', 'regular',
             $2::drive_status,
             case when $2 = 'rejected' then 'Not proceeding' else null end,
             now() - interval '1 day', now() + interval '1 day')
     returning id`,
    [company, opts.status ?? "live"],
  );
  const id = rows[0]?.id as string;

  if (opts.campus !== undefined) {
    await t.sql(`insert into drive_target_campuses (drive_id, campus_id) values ($1,$2)`, [
      id,
      opts.campus,
    ]);
  }
  return id;
}

const seenBy = async (user: string) =>
  (await t.asUser(user, `select company_name from drives order by company_name`)).map(
    (r) => r.company_name,
  );

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
  await t.sql(`insert into auth.users (id, email) values ($1,'priya@gmail.com')`, [ids.priyaUser]);
  await t.sql(`insert into auth.users (id, email) values ($1,'arjun@gmail.com')`, [ids.arjunUser]);
  // Priya is at campus A, Arjun at campus B. Both approved by the seed.
}, 60_000);

describe("a student sees a drive published to their campus", () => {
  it("shows a live drive targeted at their own campus", async () => {
    await publishDrive("TCS", { campus: ids.campusA });

    expect(await seenBy(ids.priyaUser)).toEqual(["TCS"]);
  });

  it("shows both drives when two are published, which is the reported case", async () => {
    await publishDrive("TCS", { campus: ids.campusA });
    await publishDrive("Cognizant", { campus: ids.campusA });

    expect(await seenBy(ids.priyaUser)).toEqual(["Cognizant", "TCS"]);
  });

  /** An untargeted drive is open to every campus - empty means any, never none. */
  it("shows a drive that targets no campus in particular", async () => {
    await publishDrive("OpenToAll");

    expect(await seenBy(ids.priyaUser)).toEqual(["OpenToAll"]);
  });

  it("still lets a student read a drive once applications have closed", async () => {
    await publishDrive("TCS", { campus: ids.campusA, status: "in_rounds" });

    expect(await seenBy(ids.priyaUser)).toEqual(["TCS"]);
  });
});

describe("and no drive that was not", () => {
  it("hides a drive targeted at another campus", async () => {
    await publishDrive("TCS", { campus: ids.campusA });

    expect(await seenBy(ids.arjunUser)).toEqual([]);
  });

  /**
   * The confidentiality that the missing policy was protecting. A drive being
   * negotiated is commercially sensitive and may never happen.
   */
  it("hides a drive that has not been published", async () => {
    for (const status of ["draft", "submitted", "approved", "rejected"]) {
      await publishDrive(`Secret-${status}`, { campus: ids.campusA, status });
    }

    expect(await seenBy(ids.priyaUser)).toEqual([]);
  });
});

/**
 * The targeting tables are what eligibility is evaluated against, so a student
 * has to read them - and until now could also WRITE them. `0008` grants
 * insert and update on every table to `authenticated`, and these three had row
 * level security switched off entirely, so a student could add their own
 * branch to a drive they were not eligible for.
 */
describe("drive targeting", () => {
  it("is readable, because eligibility is judged against it", async () => {
    const drive = await publishDrive("TCS", { campus: ids.campusA });
    await t.sql(`insert into drive_eligible_branches (drive_id, branch_id) values ($1,$2)`, [
      drive,
      ids.branch,
    ]);

    const rows = await t.asUser(ids.priyaUser, `select branch_id from drive_eligible_branches`);

    expect(rows).toHaveLength(1);
  });

  it("cannot be rewritten by a student to make themselves eligible", async () => {
    const drive = await publishDrive("TCS", { campus: ids.campusA });

    await t.expectRejection(
      () =>
        t.asUser(
          ids.priyaUser,
          `insert into drive_eligible_branches (drive_id, branch_id) values ($1,$2)`,
          [drive, ids.branch],
        ),
      /permission denied|row-level security|violates/i,
    );
  });

  /**
   * Asserted on the ROW, not on the error. Refusing by grant and refusing by
   * policy are both correct answers, and the two databases disagree about
   * which one applies: `0008` grants no delete, while a Supabase project ships
   * with `grant all`. What must be true on both is that the row is still
   * there.
   */
  it("cannot be deleted by a student to remove a cutoff", async () => {
    const drive = await publishDrive("TCS", { campus: ids.campusA });

    await t
      .asUser(ids.priyaUser, `delete from drive_target_campuses where drive_id = $1`, [drive])
      .catch(() => undefined);

    const rows = await t.sql(`select drive_id from drive_target_campuses where drive_id = $1`, [
      drive,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("is still writable by the Central CPC who publishes the drive", async () => {
    const drive = await publishDrive("TCS");

    const rows = await t.asUser(
      ids.centralUser,
      `insert into drive_target_campuses (drive_id, campus_id) values ($1,$2) returning campus_id`,
      [drive, ids.campusA],
    );

    expect(rows).toHaveLength(1);
  });
});
