import { describe, expect, it } from "vitest";
import { MAX_OPT_OUT_REASON } from "./participation";
import {
  canReadStatusHistory,
  canRestoreParticipation,
  canWithdrawOffer,
  OFFER_WITHDRAWAL_ROLES,
  type OfferWithdrawal,
  PARTICIPATION_RESTORE_ROLES,
  type ParticipationChange,
  restoreReasonProblem,
  STATUS_LEDGER_READER_ROLES,
  statusHistory,
  withdrawalReasonProblem,
} from "./status-changes";
import type { AppRole } from "./types";

/**
 * A student's standing moved by a person, and the ledger that says why (0133, 0134).
 *
 * These are the rules the two RPCs already enforce, restated for the screens.
 * The point of testing them here is not the sentences — it is the two lists of
 * roles and the two statuses that must NOT get a button, because both are
 * places where a screen and a migration can drift apart silently:
 *
 *  - the restore refuses `on_hold` and `disbarred` because each has a different
 *    owner, and a record page that offered "return to pipeline" beside a live
 *    hold would give the manager two controls that disagree;
 *  - the withdrawal allows admin and central_placement_coordinator while the
 *    restore refuses them, deliberately (0134's header), and a single shared
 *    list would quietly take a working action away from both.
 */

const change = (over: Partial<ParticipationChange> = {}): ParticipationChange => ({
  id: "c1",
  fromStatus: "opted_out",
  toStatus: "active",
  reason: "The fee demand they opted out over was never theirs.",
  changedByName: "Priya Raman",
  changedAt: "2026-10-30T09:00:00Z",
  ...over,
});

const withdrawal = (over: Partial<OfferWithdrawal> = {}): OfferWithdrawal => ({
  id: "w1",
  companyName: "TCS",
  roleTitle: "Software Engineer",
  source: "on_campus",
  driveType: "placement",
  ctcLpa: 9,
  stipendMonthly: null,
  reason: "The company withdrew the offer; the student is back in every drive.",
  withdrawnByName: "Karthik Subramanian",
  withdrawnAt: "2026-10-30T10:00:00Z",
  ...over,
});

describe("the two role lists mirror the two RPCs", () => {
  /** 0133:180-184 — the three the ask named, and no one else. */
  it("restores through the campus trio only", () => {
    expect([...PARTICIPATION_RESTORE_ROLES].sort()).toEqual(
      ["campus_placement_coordinator", "campus_manager", "key_account_manager"].sort(),
    );
  });

  /**
   * 0134:177-186 — `is_operator()` (0008:28) on top of the same three.
   *
   * The difference is the whole argument of that migration: admin and the
   * central coordinator could already DELETE an offer, so the withdrawal keeps
   * them and the restore — which hands the KAM its only write — does not.
   */
  it("withdraws through the campus trio plus the operators", () => {
    expect([...OFFER_WITHDRAWAL_ROLES].sort()).toEqual(
      [
        "campus_placement_coordinator",
        "campus_manager",
        "key_account_manager",
        "admin",
        "central_placement_coordinator",
      ].sort(),
    );
    const extra = OFFER_WITHDRAWAL_ROLES.filter(
      (role) => !PARTICIPATION_RESTORE_ROLES.includes(role),
    );
    expect([...extra].sort()).toEqual(["admin", "central_placement_coordinator"]);
  });

  /** The mirror of both migrations' three select policies. */
  it("reads the ledger for everyone RLS lets read it", () => {
    expect([...STATUS_LEDGER_READER_ROLES].sort()).toEqual(
      [
        "student",
        "campus_placement_coordinator",
        "campus_manager",
        "key_account_manager",
        "admin",
        "central_placement_coordinator",
        "delivery_head",
        "ceo",
        "er_head",
        "enterprise_relations",
      ].sort(),
    );
  });

  it("does not ask a company role to read a ledger they cannot see", () => {
    expect(canReadStatusHistory("account_executive")).toBe(false);
    expect(canReadStatusHistory("enterprise_relations")).toBe(true);
    expect(canReadStatusHistory("student")).toBe(true);
  });
});

describe("canRestoreParticipation", () => {
  it("allows each of the three named roles on an opted-out student", () => {
    for (const role of PARTICIPATION_RESTORE_ROLES) {
      expect(canRestoreParticipation(role, "opted_out")).toEqual({ allowed: true });
    }
  });

  /**
   * The central coordinator is the one worth naming: they approve the opt-out
   * (participation.ts's APPROVERS) and they can withdraw an offer, but 0133
   * refused them the undo on purpose — an organisation-wide undo button was a
   * bigger door than the one that was asked for.
   */
  it("refuses a central coordinator, an admin, a delivery head and the student", () => {
    const refused: readonly AppRole[] = [
      "central_placement_coordinator",
      "admin",
      "delivery_head",
      "student",
    ];
    for (const role of refused) {
      const decision = canRestoreParticipation(role, "opted_out");
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toMatch(
        /Campus Placement Coordinator, a Campus Manager or a Key Account Manager/,
      );
    }
  });

  /** 0133:48-50 — one job, one owner. Two controls that release a hold is how a manager picks the wrong one. */
  it("refuses a held student and says who releases them instead", () => {
    const decision = canRestoreParticipation("campus_manager", "on_hold");
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/hold is released/i);
    expect(decision.allowed === false && decision.reason).toMatch(/Campus Manager/);
  });

  it("refuses a disbarred student, whose sanction is Central's", () => {
    const decision = canRestoreParticipation("campus_placement_coordinator", "disbarred");
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toMatch(/Central/);
  });

  it("refuses an active student — there is nothing to return", () => {
    expect(canRestoreParticipation("key_account_manager", "active").allowed).toBe(false);
  });
});

describe("canWithdrawOffer", () => {
  it("allows the campus trio and both operators", () => {
    for (const role of OFFER_WITHDRAWAL_ROLES) {
      expect(canWithdrawOffer(role)).toEqual({ allowed: true });
    }
  });

  /** 0134:183-185, word for word, so the dialog and the refusal cannot disagree. */
  it("refuses everyone else with the database's own sentence", () => {
    const decision = canWithdrawOffer("account_executive");
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe(
      "Only a campus placement coordinator, a campus manager, a key account manager or a central operator may withdraw an offer.",
    );
  });
});

describe("the two reasons", () => {
  const long = "x".repeat(MAX_OPT_OUT_REASON + 1);

  it("refuse nothing said", () => {
    expect(restoreReasonProblem("")).toBe(
      "Say why the student is coming back. The reason is shown to them.",
    );
    expect(restoreReasonProblem("   ")).toMatch(/coming back/);
    expect(withdrawalReasonProblem("")).toBe(
      "Say why the offer is being withdrawn. The student is shown this.",
    );
  });

  /** The ceiling is the student's own (MAX_OPT_OUT_REASON), so neither side gets a box the other cannot fill. */
  it("refuse an over-long reason at the student's ceiling", () => {
    expect(restoreReasonProblem(long)).toMatch(/1,000 characters/);
    expect(withdrawalReasonProblem(long)).toMatch(/1,000 characters/);
    expect(restoreReasonProblem("x".repeat(MAX_OPT_OUT_REASON))).toBeNull();
    expect(withdrawalReasonProblem("x".repeat(MAX_OPT_OUT_REASON))).toBeNull();
  });

  it("take anything a person can act on", () => {
    expect(restoreReasonProblem("Their fee demand was a mistake.")).toBeNull();
    expect(withdrawalReasonProblem("Offer rescinded by the company.")).toBeNull();
  });
});

describe("statusHistory", () => {
  it("merges both ledgers newest first", () => {
    const events = statusHistory(
      [
        change({ changedAt: "2026-10-30T09:00:00Z" }),
        change({ changedAt: "2026-12-01T09:00:00Z" }),
      ],
      [withdrawal({ withdrawnAt: "2026-11-01T10:00:00Z" })],
    );

    expect(events.map((event) => event.at)).toEqual([
      "2026-12-01T09:00:00Z",
      "2026-11-01T10:00:00Z",
      "2026-10-30T09:00:00Z",
    ]);
  });

  /** Ties keep the order the ledgers were passed in, so two rows at one instant never swap between renders. */
  it("keeps a status change ahead of a withdrawal stamped the same moment", () => {
    const at = "2026-10-30T10:00:00Z";
    const events = statusHistory([change({ changedAt: at })], [withdrawal({ withdrawnAt: at })]);
    expect(events.map((event) => event.title)).toEqual(["Status changed", "Offer withdrawn"]);
  });

  it("keys each line by the table it came from, so the ids cannot collide", () => {
    const events = statusHistory([change({ id: "x" })], [withdrawal({ id: "x" })]);
    expect(events.map((event) => event.id).sort()).toEqual(["change-x", "withdrawal-x"]);
  });

  it("says a status change as the pair it moved between", () => {
    const [event] = statusHistory([change()], []);
    expect(event?.title).toBe("Status changed");
    expect(event?.detail).toBe("Opted out → In the pipeline");
    expect(event?.tone).toBe("neutral");
    expect(event?.byName).toBe("Priya Raman");
    expect(event?.reason).toMatch(/fee demand/);
  });

  /** 0134 writes no status, so a withdrawal line must not read as one. */
  it("says a withdrawal as the offer it took back", () => {
    const [event] = statusHistory([], [withdrawal()]);
    expect(event?.title).toBe("Offer withdrawn");
    expect(event?.detail).toBe("TCS · Software Engineer · ₹9 LPA · on campus");
    expect(event?.tone).toBe("warning");
  });

  it("still names the company when the role and the figure were never recorded", () => {
    const [event] = statusHistory(
      [],
      [
        withdrawal({
          roleTitle: "   ",
          source: "self_placed",
          driveType: "internship",
          ctcLpa: 0,
        }),
      ],
    );
    // An internship is quoted as a stipend, and the 0 its NOT NULL CTC column
    // holds when nobody meant it is never printed as a figure.
    expect(event?.detail).toBe("TCS · Pay not recorded · self-placed");
  });

  it("quotes a self-placed salary offer as its own CTC", () => {
    const [event] = statusHistory([], [withdrawal({ source: "self_placed", ctcLpa: 6.5 })]);
    expect(event?.detail).toBe("TCS · Software Engineer · ₹6.5 LPA · self-placed");
  });

  it("keeps a line whose author cannot be read rather than dropping the change", () => {
    const [event] = statusHistory([change({ changedByName: null })], []);
    expect(event?.byName).toBeNull();
  });

  it("answers nothing when nothing has ever happened", () => {
    expect(statusHistory([], [])).toEqual([]);
  });
});
