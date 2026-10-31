import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seed, type TestDb } from "./harness";

/**
 * 0134 — withdrawing an offer, in the database.
 *
 * Two claims matter here and neither belongs to a screen test. The silent DELETE
 * that 0018:79-82 left open has to be shut, or the archive is a form somebody
 * can skip; and everything that counts a placement has to change its answer the
 * moment the offer is gone, or the archive is a museum while the student stays
 * out of the funnel. The second is proved by calling the project's own totals
 * function around the withdrawal rather than by reading the table back.
 *
 * Everything runs as a real user except the setups and the resets, which say so.
 */

let t: TestDb;
let ids: Awaited<ReturnType<typeof seed>>;

/** A KAM seated at campusA, a coordinator whose seat is campusB, and the AE who owns the drive. */
const KAM_A = "64000000-0000-0000-0000-000000000001";
const COORDINATOR_B = "64000000-0000-0000-0000-000000000002";
const AE_USER = "64000000-0000-0000-0000-000000000003";

let drive: string;
let priyaOffer: string;
let arjunOffer: string;

const hasOffer = async (offer: string) =>
  (await t.sql(`select id from offers where id = $1`, [offer])).length > 0;

const archive = async (student: string) =>
  t.sql(
    `select company_name, ctc_lpa, source::text source, reason,
            withdrawn_by::text withdrawn_by, offer_id::text archived_offer,
            offer ->> 'drive_id' as snapshot_drive,
            record_override ->> 'reason' as override_reason
       from offer_withdrawals where student_id = $1 order by withdrawn_at`,
    [student],
  );

/** The project's own placement figures, read as an organisation reader. */
const totals = async () =>
  (
    await t.asUser(
      ids.adminUser,
      `select placed::int placed, self_placed::int self_placed from placement_totals()`,
    )
  )[0];

const withdraw = (as: string, offer: string, reason: string) =>
  t.asUser(as, `select withdraw_offer($1, $2) as id`, [offer, reason]);

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

describe("offer withdrawal, after 0134", () => {
  beforeAll(async () => {
    t = await createTestDb();
    ids = await seed(t);

    // Signed-in students, or current_student_id() is NULL and the read tests die
    // at a policy instead of answering (hold-gate.test.ts:82-90 says why).
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
    await invite(AE_USER, "ae@faceprep.in", "AE One", "account_executive");
    await seat(KAM_A, ids.campusA);
    await seat(COORDINATOR_B, ids.campusB);

    drive = (
      await t.sql(`insert into drives (company_name, created_by) values ('Zoho',$1) returning id`, [
        AE_USER,
      ])
    )[0]?.id as string;
  });

  /**
   * Both students placed, every test, because the tests remove offers and a
   * reset that only refilled what was taken would make each test depend on the
   * one before it.
   */
  beforeEach(async () => {
    await t.sql(`delete from placement_record_overrides`);
    await t.sql(`delete from offer_withdrawals`);
    await t.sql(`delete from notifications`);
    // The trusted server context: no policy lets anybody delete an offer now,
    // which is the point, so the reset could not go through a policy if it did.
    await t.sql(`delete from offers`);

    priyaOffer = (
      await t.sql(
        `insert into offers (student_id, drive_id, company_name, drive_type, offer_category, ctc_lpa)
         values ($1,$2,'Zoho','placement','dream',9) returning id`,
        [ids.priya, drive],
      )
    )[0]?.id as string;
    arjunOffer = (
      await t.sql(
        `insert into offers (student_id, drive_id, company_name, drive_type, offer_category, ctc_lpa)
         values ($1,$2,'Zoho','placement','regular',7) returning id`,
        [ids.arjun, drive],
      )
    )[0]?.id as string;
  });

  describe("the silent door is shut", () => {
    /**
     * The shape of the policies, not merely the outcome: `for all` was the hole
     * and a test that only tries a DELETE could be passing on a missing table
     * privilege instead of on the narrowing.
     */
    it("leaves offers with no delete policy and no for-all policy", async () => {
      const policies = await t.sql(
        `select polname, polcmd::text cmd from pg_policy where polrelid = 'offers'::regclass`,
      );
      const names = policies.map((p) => p.polname as string);

      expect(names).not.toContain("offers_write_staff");
      expect(names.sort()).toEqual([
        "offers_read_drive_owner",
        "offers_read_self",
        "offers_read_staff",
        "offers_write_staff_insert",
        "offers_write_staff_update",
      ]);
      expect(policies.filter((p) => p.cmd === "d")).toEqual([]);
    });

    it("refuses a coordinator their own DELETE, and keeps the placement", async () => {
      await t.expectRejection(
        () => t.asUser(ids.cpcUser, `delete from offers where id = $1`, [priyaOffer]),
        /permission denied for table offers|row-level security/i,
      );
      expect(await hasOffer(priyaOffer)).toBe(true);
    });

    it("refuses a coordinator an operator's DELETE too", async () => {
      await t.expectRejection(
        () => t.asUser(ids.centralUser, `delete from offers where id = $1`, [priyaOffer]),
        /permission denied for table offers|row-level security/i,
      );
    });

    /**
     * The archive has no insert policy on purpose (0133's ledger is the same):
     * a withdrawal is written by withdraw_offer or it is not a withdrawal.
     */
    it("refuses a hand-written archive row", async () => {
      await t.expectRejection(
        () =>
          t.asUser(
            ids.cpcUser,
            `insert into offer_withdrawals (offer_id, student_id, source, company_name, ctc_lpa, reason, withdrawn_by, offer)
             values ($1,$2,'on_campus','Someone Else',12,'because',$3,'{}'::jsonb)`,
            [priyaOffer, ids.priya, ids.cpcUser],
          ),
        /row-level security|permission denied/i,
      );
      expect(await archive(ids.priya)).toEqual([]);
    });

    it("refuses rewriting the archive afterwards", async () => {
      await withdraw(ids.cpcUser, priyaOffer, "Offer letter proved to be for another candidate.");

      await t.expectRejection(
        () => t.asUser(ids.cpcUser, `update offer_withdrawals set reason = 'no reason'`),
        /row-level security|permission denied/i,
      );
      const kept = await archive(ids.priya);
      expect(kept[0]?.reason).toBe("Offer letter proved to be for another candidate.");
    });
  });

  describe("withdraw_offer", () => {
    it("archives the offer, removes it, and moves the placement figures", async () => {
      const before = await totals();
      expect(before?.placed).toBe(2);

      const id = (
        await withdraw(ids.cpcUser, priyaOffer, "  The letter was for a 2025 batch.  ")
      )[0]?.id as string;
      expect(id).toBeTruthy();

      expect(await hasOffer(priyaOffer)).toBe(false);
      expect(await hasOffer(arjunOffer)).toBe(true);
      expect((await totals())?.placed).toBe(1);

      const rows = await archive(ids.priya);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        company_name: "Zoho",
        source: "on_campus",
        reason: "The letter was for a 2025 batch.",
        archived_offer: priyaOffer,
        snapshot_drive: drive,
        override_reason: null,
      });
      expect(String(rows[0]?.withdrawn_by)).toBe(
        (await t.sql(`select id::text id from profiles where email = 'cpc@faceprep.in'`))[0]?.id,
      );
    });

    it("leaves the other student's placement alone", async () => {
      await withdraw(ids.cpcUser, priyaOffer, "Wrong candidate.");
      expect(await hasOffer(arjunOffer)).toBe(true);
      expect(await archive(ids.arjun)).toEqual([]);
    });

    it("refuses a withdrawal of the same offer twice", async () => {
      await withdraw(ids.cpcUser, priyaOffer, "Wrong candidate.");

      await t.expectRejection(() => withdraw(ids.cpcUser, priyaOffer, "Again."), /no such offer/i);
      expect(await archive(ids.priya)).toHaveLength(1);
    });

    it("refuses the student themself, who never had this right", async () => {
      await t.expectRejection(
        () =>
          t.asUser(ids.priyaUser, `select withdraw_offer($1,$2)`, [priyaOffer, "Changed my mind."]),
        /withdrawn by a signed-in staff member/,
      );
      expect(await hasOffer(priyaOffer)).toBe(true);
    });

    it("refuses the account executive who raised the drive", async () => {
      await t.expectRejection(
        () => withdraw(AE_USER, priyaOffer, "Our offer was a mistake."),
        /campus placement coordinator, a campus manager, a key account manager or a central operator/,
      );
      expect(await hasOffer(priyaOffer)).toBe(true);
    });

    it("refuses a blank reason before it touches the offer", async () => {
      await t.expectRejection(
        () => withdraw(ids.cpcUser, priyaOffer, "   "),
        /say why the offer is being withdrawn/i,
      );
      expect(await hasOffer(priyaOffer)).toBe(true);
      expect(await archive(ids.priya)).toEqual([]);
    });

    it("refuses a reason longer than the student's own opt-out reason", async () => {
      await t.expectRejection(
        () => withdraw(ids.cpcUser, priyaOffer, "x".repeat(1001)),
        /1000 characters/,
      );
      expect(await hasOffer(priyaOffer)).toBe(true);
    });

    it("refuses a coordinator whose seat is another college", async () => {
      await t.expectRejection(
        () => withdraw(COORDINATOR_B, priyaOffer, "Wrong candidate."),
        /only withdraw an offer of a student at a college you are assigned to/i,
      );
      expect(await hasOffer(priyaOffer)).toBe(true);

      // Their own college is fine, with the same hand.
      await withdraw(COORDINATOR_B, arjunOffer, "Our offer was withdrawn by the company.");
      expect(await hasOffer(arjunOffer)).toBe(false);
    });

    it("lets the KAM withdraw this one thing, at their own college", async () => {
      await withdraw(KAM_A, priyaOffer, "The company retracted the offer after joining.");
      expect(await hasOffer(priyaOffer)).toBe(false);
    });

    /**
     * 0134's disclosed difference from 0133: operators could DELETE an offer
     * before this file, so refusing them here would take a working action away
     * instead of attributing it. They are not campus-scoped, exactly as they
     * were not before.
     */
    it("lets a central operator withdraw at any college, with a reason", async () => {
      await withdraw(ids.centralUser, priyaOffer, "Reported against the wrong student.");
      expect(await hasOffer(priyaOffer)).toBe(false);

      const rows = await archive(ids.priya);
      expect(rows[0]?.reason).toBe("Reported against the wrong student.");
      expect(String(rows[0]?.withdrawn_by)).toBe(
        (await t.sql(`select id::text id from profiles where email = 'central@faceprep.in'`))[0]
          ?.id,
      );
    });

    it("carries a placement record override into the archive instead of cascading it away", async () => {
      await t.sql(
        `insert into placement_record_overrides (student_id, offer_id, reason, set_by)
         values ($1,$2,'Reported at the request of the college.',$3)`,
        [ids.priya, priyaOffer, ids.centralUser],
      );

      await withdraw(ids.cpcUser, priyaOffer, "The offer was for a different student.");

      expect((await t.sql(`select count(*)::int n from placement_record_overrides`))[0]?.n).toBe(0);
      const rows = await archive(ids.priya);
      expect(rows[0]?.override_reason).toBe("Reported at the request of the college.");
    });

    it("sends no mail for the withdrawal", async () => {
      const before = (
        await t.sql(`select count(*)::int n from notifications where student_id = $1`, [ids.priya])
      )[0]?.n;

      await withdraw(ids.cpcUser, priyaOffer, "Retracted by the company.");

      expect(
        (
          await t.sql(`select count(*)::int n from notifications where student_id = $1`, [
            ids.priya,
          ])
        )[0]?.n,
      ).toBe(before);
    });

    /**
     * A self-placed offer is the one the student raised, and the one that comes
     * with a hold. The source has to survive in the archive or the record cannot
     * say which kind of placement was taken back.
     */
    it("archives a self-placed offer with its source", async () => {
      const selfPlaced = (
        await t.sql(
          `insert into offers (student_id, source, company_name, drive_type, offer_category, ctc_lpa, approved_by)
           values ($1,'self_placed','Freshworks','placement','dream',14,$2) returning id`,
          [ids.priya, ids.cpcUser],
        )
      )[0]?.id as string;

      await withdraw(ids.cpcUser, selfPlaced, "The letter was not genuine.");
      expect(await archive(ids.priya)).toMatchObject([{ source: "self_placed" }]);
    });
  });

  describe("who may read a withdrawal", () => {
    beforeEach(async () => {
      await withdraw(ids.cpcUser, priyaOffer, "The offer letter was for a 2025 batch.");
    });

    const reads = (as: string) =>
      t.asUser(as, `select reason from offer_withdrawals where student_id = $1`, [ids.priya]);

    it("shows the student their own withdrawal, reason and all", async () => {
      const rows = await reads(ids.priyaUser);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.reason).toBe("The offer letter was for a 2025 batch.");
    });

    it("shows the coordinator who did it", async () => {
      expect(await reads(ids.cpcUser)).toHaveLength(1);
    });

    it("shows an organisation reader", async () => {
      expect(await reads(ids.centralUser)).toHaveLength(1);
    });

    it("hides it from a student at another college", async () => {
      expect(await reads(ids.arjunUser)).toHaveLength(0);
    });

    it("hides it from a coordinator at another college", async () => {
      expect(await reads(COORDINATOR_B)).toHaveLength(0);
    });
  });
});
