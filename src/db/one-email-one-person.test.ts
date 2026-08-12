import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * Migration 0040 — one email identifies one person.
 *
 * Asked for 2026-08-06: "can you block an email id from being entered twice?
 * student + student as well as student+staff".
 *
 * This is P8's root cause. `sainaveen@faceprep.in` was on the student roster
 * AND held a staff profile on one Google account; sign-in is by address, so
 * that is one identity wearing two hats. It made the only campus coordinator
 * unable to approve any registration form (0009 saw them as a student) and
 * would have let them verify their own certificates.
 *
 * Two gaps existed. Student-vs-student was already unique but CASE-SENSITIVE,
 * so `Priya@gmail.com` and `priya@gmail.com` were two people. Student-vs-staff
 * was not checked at all.
 *
 * A staff INVITATION and the PROFILE it becomes are one person, not two - that
 * pair is the normal state of every staff member and must keep working.
 */
let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

const addStudent = (email: string, roll = `R${Math.random()}`) =>
  t.sql(
    `insert into students (campus_id, degree_id, branch_id, roll_number, full_name, email, passing_year)
     values ($1,$2,$3,$4,'Someone',$5,2027)`,
    [ids.campusA, ids.degree, ids.branch, roll, email],
  );

const invite = (email: string) =>
  t.sql(`insert into staff_invitations (email, full_name, role) values ($1,'Someone','admin')`, [
    email,
  ]);

beforeEach(async () => {
  t = await createTestDb();
  ids = await seed(t);
}, 60_000);

describe("0040 — the same address twice", () => {
  it("refuses a second student on the same address", async () => {
    await addStudent("dupe@gmail.com");

    await t.expectRejection(() => addStudent("dupe@gmail.com"), /one_person_per_email|duplicate/i);
  });

  /** The gap that existed: unique, but case-sensitive. */
  it("refuses a second student differing only by case", async () => {
    await addStudent("dupe@gmail.com");

    await t.expectRejection(() => addStudent("DUPE@Gmail.com"), /one_person_per_email|duplicate/i);
  });

  it("refuses a second staff invitation differing only by case", async () => {
    await invite("newstaff@faceprep.in");

    await t.expectRejection(
      () => invite("NewStaff@FacePrep.in"),
      /one_person_per_email|duplicate/i,
    );
  });

  it("stores the address canonically, so what is read back is what is matched", async () => {
    await addStudent("  MiXeD@Gmail.COM  ");

    const [row] = await t.sql(`select email from students where roll_number is not null
                               and email like '%mixed%'`);
    expect(row?.email).toBe("mixed@gmail.com");
  });
});

describe("0040 — a student and a staff member are different people", () => {
  it("refuses a student whose address already belongs to a staff profile", async () => {
    // cpc@faceprep.in is seeded as a staff profile.
    await t.expectRejection(
      () => addStudent("cpc@faceprep.in"),
      /already .*staff|student or staff/i,
    );
  });

  it("refuses that however it is cased", async () => {
    await t.expectRejection(
      () => addStudent("CPC@FacePrep.in"),
      /already .*staff|student or staff/i,
    );
  });

  it("refuses a student whose address has only been INVITED, not yet accepted", async () => {
    await invite("pending@faceprep.in");

    await t.expectRejection(
      () => addStudent("pending@faceprep.in"),
      /already .*staff|student or staff/i,
    );
  });

  it("refuses inviting staff on an address already on the student roster", async () => {
    await t.expectRejection(() => invite("priya@gmail.com"), /student roster|student or staff/i);
  });

  it("refuses a staff profile created directly on a student's address", async () => {
    await t.expectRejection(
      () =>
        t.sql(
          `insert into profiles (id, email, full_name, role)
           values (gen_random_uuid(), 'priya@gmail.com', 'Sneaky', 'admin')`,
        ),
      /student roster|student or staff/i,
    );
  });

  /** Moving an existing row onto a taken address is the same mistake. */
  it("refuses UPDATING a student onto a staff address", async () => {
    await t.expectRejection(
      () => t.sql(`update students set email = 'cpc@faceprep.in' where id = $1`, [ids.priya]),
      /already .*staff|student or staff/i,
    );
  });
});

describe("0040 — what must keep working", () => {
  /**
   * The normal life of every staff member: invited, then the profile is
   * materialised from that invitation. One person, two rows, never a clash.
   */
  it("still lets an invitation become a profile", async () => {
    await invite("brandnew@faceprep.in");

    await t.sql(`insert into auth.users (id, email) values (gen_random_uuid(), $1)`, [
      "brandnew@faceprep.in",
    ]);

    const [row] = await t.sql(`select role::text as role from profiles where email = $1`, [
      "brandnew@faceprep.in",
    ]);
    expect(row?.role).toBe("admin");
  });

  it("still accepts a genuinely new student", async () => {
    await addStudent("someone.new@gmail.com");

    const [row] = await t.sql(`select count(*)::int as n from students where email = $1`, [
      "someone.new@gmail.com",
    ]);
    expect(Number(row?.n)).toBe(1);
  });

  it("frees the address once the staff member is removed outright", async () => {
    await invite("temp@faceprep.in");
    await t.sql(`delete from staff_invitations where email = 'temp@faceprep.in'`);

    await addStudent("temp@faceprep.in");

    const [row] = await t.sql(`select count(*)::int as n from students where email = $1`, [
      "temp@faceprep.in",
    ]);
    expect(Number(row?.n)).toBe(1);
  });

  it("lets a student's own row be updated without tripping on itself", async () => {
    await t.sql(`update students set full_name = 'Priya R' where id = $1`, [ids.priya]);

    const [row] = await t.sql(`select full_name from students where id = $1`, [ids.priya]);
    expect(row?.full_name).toBe("Priya R");
  });
});
