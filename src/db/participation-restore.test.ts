import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * 0133 — returning an opted-out student to the pipeline, in the database.
 *
 * The request was a staff action with a reason that the student can read. Two
 * things matter here and neither is true of a screen test: the guard in 0009
 * still has to refuse every path that is not the sanctioned one — including the
 * trusted server context, because a trigger fires on a superuser just as
 * happily as on a student — and the history row has to exist before the status
 * does, since it is the only thing that says who did it.
 *
 * Everything runs as a real user through RLS except the setups and the resets,
 * which say so where they are used.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

/** A KAM with a seat at campusA, a coordinator whose seat is campusB, and one with none. */
const KAM_A = "63000000-0000-0000-0000-000000000001";
const COORDINATOR_B = "63000000-0000-0000-0000-000000000002";
const NO_SEAT = "63000000-0000-0000-0000-000000000003";

const status = async (student: string) =>
  (await t.sql(`select participation_status::text c from students where id = $1`, [student]))[0]
    ?.c as string;

const history = async (student: string) =>
  t.sql(
    `select from_status::text from_status, to_status::text to_status, reason,
            changed_by::text changed_by, changed_at is not null as stamped
       from participation_status_changes where student_id = $1 order by changed_at`,
    [student],
  );

/** The row count, written out because `length` on an empty result says nothing. */
const historyCount = async (student: string) => (await history(student)).length;

/**
 * The reset cannot go through the guard, so it opens the same transaction-local
 * marker restore_participation does and clears it immediately. This is the
 * service-role path the migration says is the trust boundary — a test setup,
 * never a way the application can put a student back.
 */
const forceActive = async (student: string) => {
  await t.sql(`select set_config('app.participation_restore', $1, false)`, [student]);
  await t.sql(`update students set participation_status = 'active' where id = $1`, [student]);
  await t.sql(`select set_config('app.participation_restore', '', false)`);
};

const optOut = (student: string) =>
  t.sql(`update students set participation_status = 'opted_out' where id = $1`, [student]);

/**
 * The signed declaration an opt-out request has to cite. 0022:45 made it a
 * table-level check, so a request inserted without one is refused before the
 * reversal this file is about ever gets a chance to run.
 */
const declaration = async (student: string) => {
  const rows = await t.sql(
    `insert into student_documents (student_id, kind, storage_path, size_bytes)
     values ($1,'opt_out_declaration',
             'declarations/' || $2 || '/' || gen_random_uuid()::text || '.pdf', 4096)
     returning id::text id`,
    [student, student],
  );
  return rows[0]?.id as string;
};

/** Verified request plus the evidence it stands on, in one step. */
const verifiedOptOut = async (student: string, reason: string) =>
  t.sql(
    `insert into opt_out_requests (student_id, reason, status, decided_by, decided_at, declaration_id)
     values ($1,$2,'verified',$3, now(),$4)`,
    [student, reason, ids.cpcUser, await declaration(student)],
  );

/** A student trying to put themselves back, which is the hole 0009 was built for. */
const SELF_RESTORE = `update students set participation_status = 'active' where id = $1`;

const restore = (as: string, student: string, reason: string) =>
  t.asUser(as, `select restore_participation($1, $2) as id`, [student, reason]);

async function invite(as: string, email: string, name: string, role: string) {
  await t.sql(
    `insert into staff_invitations (email, full_name, role) values ($1,$2,$3::app_role)`,
    [email, name, role],
  );
  await t.sql(`insert into auth.users (id, email) values ($1, $2)`, [as, email]);
}

const seat = (profile: string, campus: string) =>
  t.sql(`insert into staff_campus_assignments (profile_id, campus_id) values ($1, $2)`, [
    profile,
    campus,
  ]);

describe("opt-out irreversibility, after 0133", () => {
  beforeAll(async () => {
    t = await createTestDb();
    ids = await seed(t);

    // Signed-in students, or `current_student_id()` is NULL and the read tests
    // die at a policy instead of answering (hold-gate.test.ts:82-90 says why).
    await t.sql(
      `insert into auth.users (id, email) values ($1,'priya@gmail.com'), ($2,'arjun@gmail.com')`,
      [ids.priyaUser, ids.arjunUser],
    );

    await invite(KAM_A, "kam.a@faceprep.in", "Kam A", "key_account_manager");
    await invite(
      COORDINATOR_B,
      "cpc.b@faceprep.in",
      "Coordinator B",
      "campus_placement_coordinator",
    );
    await invite(
      NO_SEAT,
      "none@faceprep.in",
      "Nobody's Coordinator",
      "campus_placement_coordinator",
    );
    await seat(KAM_A, ids.campusA);
    await seat(COORDINATOR_B, ids.campusB);
  });

  beforeEach(async () => {
    await t.sql(`delete from participation_status_changes`);
    await t.sql(`delete from opt_out_requests`);
    await t.sql(`delete from notifications`);
    await forceActive(ids.priya);
    await forceActive(ids.arjun);
  });

  describe("the guard still refuses every path but one", () => {
    it("refuses a direct update, even from the trusted server context", async () => {
      await optOut(ids.priya);

      await t.expectRejection(
        () =>
          t.sql(`update students set participation_status = 'active' where id = $1`, [ids.priya]),
        /irreversible except through restore_participation/,
      );
      expect(await status(ids.priya)).toBe("opted_out");
    });

    /**
     * Whether the refusal comes from the students update policy or from the
     * guard is the database's choice; that the flag is still opted_out is the
     * assertion. A student who could write this column would make the roster a
     * per-drive toggle.
     */
    it("refuses the student themself, and leaves the flag where it was", async () => {
      await optOut(ids.priya);

      await t.asUser(ids.priyaUser, SELF_RESTORE, [ids.priya]).catch(() => undefined);
      expect(await status(ids.priya)).toBe("opted_out");
    });

    it("refuses a held or active student, because that is release_student_hold's job", async () => {
      // Arjun's own college, so the refusal is about his status and not the seat.
      await t.expectRejection(
        () => restore(COORDINATOR_B, ids.arjun, "Rejoined after a family move."),
        /is not opted out \(status: active\)/,
      );
      expect(await historyCount(ids.arjun)).toBe(0);
    });

    /**
     * The marker does not survive the call that set it. Without this, one
     * legitimate restore would leave the student permanently able to be flipped
     * by any other path.
     */
    it("arms the guard again the moment the restore is over", async () => {
      await optOut(ids.priya);
      await restore(
        ids.cpcUser,
        ids.priya,
        "Rejoined; the opt-out was filed on a wrong fee figure.",
      );
      expect(await status(ids.priya)).toBe("active");

      await optOut(ids.priya);
      await t.expectRejection(
        () =>
          t.sql(`update students set participation_status = 'active' where id = $1`, [ids.priya]),
        /irreversible except through restore_participation/,
      );
      expect(await status(ids.priya)).toBe("opted_out");
    });

    it("refuses a reason that is only spaces at the table itself", async () => {
      await t.expectRejection(
        () =>
          t.sql(
            `insert into participation_status_changes
               (student_id, from_status, to_status, reason, changed_by)
             values ($1,'opted_out','active','   ',$2)`,
            [ids.priya, ids.cpcUser],
          ),
        /participation_status_changes_reason_check|check/,
      );
    });
  });

  describe("restore_participation", () => {
    it("returns the student and records who, why and when", async () => {
      await optOut(ids.priya);
      await verifiedOptOut(ids.priya, "Leaving for a family business.");

      const changed = (
        await restore(ids.cpcUser, ids.priya, "  Back in the pipeline from 3 Nov.  ")
      )[0]?.id as string;
      expect(changed).toBeTruthy();

      expect(await status(ids.priya)).toBe("active");
      expect(await history(ids.priya)).toEqual([
        {
          from_status: "opted_out",
          to_status: "active",
          reason: "Back in the pipeline from 3 Nov.",
          changed_by: ids.cpcUser,
          stamped: true,
        },
      ]);

      // The original decision stays on record; it just stops reserving the slot.
      const request = (
        await t.sql(
          `select status::text status, reversed_at is not null as reversed, reversed_by
             from opt_out_requests where student_id = $1`,
          [ids.priya],
        )
      )[0];
      expect(request).toMatchObject({
        status: "verified",
        reversed: true,
        reversed_by: ids.cpcUser,
      });
    });

    it("sends no mail for the change", async () => {
      await optOut(ids.priya);
      await restore(ids.cpcUser, ids.priya, "Rejoining by agreement with the coordinator.");

      expect(
        (
          await t.sql(`select count(*)::int n from notifications where student_id = $1`, [
            ids.priya,
          ])
        )[0]?.n,
      ).toBe(0);
    });

    it("refuses a blank reason before it touches the student", async () => {
      await optOut(ids.priya);

      await t.expectRejection(
        () => restore(ids.cpcUser, ids.priya, "   "),
        /say why the student is coming back/i,
      );
      expect(await status(ids.priya)).toBe("opted_out");
      expect(await historyCount(ids.priya)).toBe(0);
    });

    it("refuses a reason longer than the student's own opt-out reason", async () => {
      await optOut(ids.priya);

      await t.expectRejection(
        () => restore(ids.cpcUser, ids.priya, "x".repeat(1001)),
        /1000 characters/,
      );
      expect(await status(ids.priya)).toBe("opted_out");
    });

    /**
     * The roles the request named, and nobody else. central_placement_coordinator
     * and admin being refused is deliberate (0133 header) and is pinned here so
     * that it stays a decision rather than becoming an oversight.
     */
    it.each([
      ["the central coordinator", "centralUser"],
      ["an admin", "adminUser"],
    ] as const)("%s is refused", async (_label, key) => {
      await optOut(ids.priya);

      await t.expectRejection(
        () => restore(ids[key], ids.priya, "Rejoining."),
        /only a campus placement coordinator, a campus manager or a key account manager/i,
      );
      expect(await status(ids.priya)).toBe("opted_out");
    });

    it("lets the KAM write this one thing, and only for their own college", async () => {
      await optOut(ids.priya);

      await restore(
        KAM_A,
        ids.priya,
        "Their self-placed offer fell through; they are recruiting again.",
      );
      expect(await status(ids.priya)).toBe("active");
    });

    it("refuses a coordinator whose seat is another college", async () => {
      await optOut(ids.priya);

      // Arjun is at campusB, so Coordinator B has the seat for him and not for Priya.
      await t.expectRejection(
        () => restore(COORDINATOR_B, ids.priya, "Rejoining."),
        /only return a student at a college you are assigned to/i,
      );
      expect(await status(ids.priya)).toBe("opted_out");

      await optOut(ids.arjun);
      await restore(COORDINATOR_B, ids.arjun, "Fees cleared with accounts.");
      expect(await status(ids.arjun)).toBe("active");
    });

    it("refuses a staff member with no campus seat at all", async () => {
      await optOut(ids.priya);

      await t.expectRejection(
        () => restore(NO_SEAT, ids.priya, "Rejoining."),
        /only return a student at a college you are assigned to/i,
      );
    });

    /**
     * 0133's disclosed side effect 2: one_approved_opt_out_per_student used to
     * count every 'verified' request a student will ever file, so a second
     * opt-out after a restore was impossible. The reversal frees the slot.
     */
    it("lets the student opt out a second time", async () => {
      await optOut(ids.priya);
      await verifiedOptOut(ids.priya, "First opt-out.");

      await restore(ids.cpcUser, ids.priya, "Back for the 2026 season.");

      await verifiedOptOut(ids.priya, "Second opt-out.");
      expect(
        (
          await t.sql(
            `select count(*)::int n from opt_out_requests
              where student_id = $1 and status = 'verified' and reversed_at is null`,
            [ids.priya],
          )
        )[0]?.n,
      ).toBe(1);
    });
  });

  describe("who may read the history", () => {
    /**
     * One restore, re-done for every read: the outer `beforeEach` wipes the
     * ledger between tests, and a `beforeAll` here would be wiped too.
     */
    beforeEach(async () => {
      await optOut(ids.priya);
      await restore(ids.cpcUser, ids.priya, "Rejoined after the fee demand was withdrawn.");
    });

    const reads = (as: string) =>
      t.asUser(as, `select reason from participation_status_changes where student_id = $1`, [
        ids.priya,
      ]);

    it("shows the student their own history, reason and all", async () => {
      const rows = await reads(ids.priyaUser);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.reason).toBe("Rejoined after the fee demand was withdrawn.");
    });

    it("shows the coordinator who did it", async () => {
      expect(await reads(ids.cpcUser)).toHaveLength(1);
    });

    it("shows an organisation reader", async () => {
      expect(await reads(ids.centralUser)).toHaveLength(1);
    });

    /**
     * The college across the city has no business reading why a student of
     * Alliance left, and 0018 scoped the same way for every other student table.
     */
    it("hides it from a coordinator at another college", async () => {
      expect(await reads(COORDINATOR_B)).toHaveLength(0);
    });

    it("hides it from a student at another college", async () => {
      expect(await reads(ids.arjunUser)).toHaveLength(0);
    });
  });
});
