import { describeOfferPay } from "./offer-pay";
import type { Decision } from "./participation";
import { MAX_OPT_OUT_REASON } from "./participation";
import { participationStatusLabel } from "./participation-status";
import type { AppRole, DriveType, OfferSource, ParticipationStatus } from "./types";

/**
 * A student's standing moved by a person, and the record of who, when and why.
 *
 * Asked 2026-10-30: "if they have place cam, kam, cpc can change them to normal
 * with reason and that history should be shown for students". Two moves exist:
 *
 *  - `restore_participation` (0133) puts an opted-out student back in the
 *    pipeline. The student cannot do this themselves — 0009's guard still
 *    refuses every client path — so the only way back is a named staff member.
 *  - `withdraw_offer` (0134) takes an offer back, which is the same ask for a
 *    student who is already placed: placement lives in `offers`, not in the
 *    participation enum, so there is no status to change and the row goes away.
 *
 * Both write an append-only ledger row and both refuse a blank reason, because
 * the reason is the entire difference between a decision and an edit — and it
 * is the only explanation the student is ever given. No notification is sent by
 * either (0123 and 0129 stopped staff mail, and the ask was for the history to
 * be shown, not broadcast).
 *
 * What is in here mirrors the two migrations sentence for sentence and gate for
 * gate. The database is what actually refuses; this file is what stops a screen
 * offering a button that will fail.
 */

/** Whom 0133 lets return a student to the pipeline — the three the ask named. */
export const PARTICIPATION_RESTORE_ROLES: readonly AppRole[] = [
  "campus_placement_coordinator",
  "campus_manager",
  "key_account_manager",
];

/**
 * Whom 0134 lets withdraw an offer: the same three, plus `is_operator()`
 * (0008:28 — admin and central_placement_coordinator).
 *
 * The deliberate difference from the restore. Those two roles can already
 * `DELETE` an offer; refusing them here would take a working action away rather
 * than putting one back. What they lose is the silence.
 */
export const OFFER_WITHDRAWAL_ROLES: readonly AppRole[] = [
  ...PARTICIPATION_RESTORE_ROLES,
  "admin",
  "central_placement_coordinator",
];

/**
 * Whose record pages ask for the ledger at all — the mirror of both
 * migrations' three select policies (the campus trio via `is_campus_reader()`,
 * the six org roles via `is_org_reader()`) plus the student, who reads their
 * own rows through `current_student_id()`.
 *
 * RLS still decides what comes back; this only stops a company role spending
 * two reads on a block they are never allowed to see.
 */
export const STATUS_LEDGER_READER_ROLES: readonly AppRole[] = [
  "student",
  ...PARTICIPATION_RESTORE_ROLES,
  "admin",
  "central_placement_coordinator",
  "delivery_head",
  "ceo",
  "er_head",
  "enterprise_relations",
];

/** Whether this role may ask for the ledger at all. */
export function canReadStatusHistory(role: AppRole): boolean {
  return STATUS_LEDGER_READER_ROLES.includes(role);
}

/**
 * Whether this person may return this student to the pipeline.
 *
 * `on_hold` and `disbarred` are refused with their own sentences rather than
 * the generic one because each has a different way back, and a manager who is
 * told only "no" has no idea which: a hold is released by the Campus Manager
 * (`release_student_hold`, 0125) and a disbarment is lifted by Central
 * (0006:60). 0133 refuses both too, in the same words.
 */
export function canRestoreParticipation(actor: AppRole, status: ParticipationStatus): Decision {
  if (!PARTICIPATION_RESTORE_ROLES.includes(actor)) {
    return {
      allowed: false,
      reason:
        "Only a Campus Placement Coordinator, a Campus Manager or a Key Account Manager may return a student to the pipeline.",
    };
  }
  if (status === "on_hold") {
    return {
      allowed: false,
      reason: "Their hold is released by their Campus Manager, not by a status change.",
    };
  }
  if (status === "disbarred") {
    return {
      allowed: false,
      reason: "Disbarment is Central's decision. No campus role can lift it.",
    };
  }
  if (status === "active") {
    return { allowed: false, reason: "This student is already in the pipeline." };
  }
  return { allowed: true };
}

/** Whom 0134 lets withdraw an offer, whatever the student's standing is. */
export function canWithdrawOffer(actor: AppRole): Decision {
  if (!OFFER_WITHDRAWAL_ROLES.includes(actor)) {
    return {
      allowed: false,
      reason:
        "Only a campus placement coordinator, a campus manager, a key account manager or a central operator may withdraw an offer.",
    };
  }
  return { allowed: true };
}

/**
 * The reason, before it is sent.
 *
 * Both writes share the student's own opt-out ceiling (`MAX_OPT_OUT_REASON`) so
 * neither side gets a box the other cannot fill, and both say the same thing
 * about it as the database does — the reason is shown to the student, so a
 * screen that let a blank through would leave them with a vanished placement
 * and no word about it.
 */
function reasonProblem(reason: string, missing: string): string | null {
  const trimmed = reason.trim();
  if (trimmed === "") return missing;
  if (trimmed.length > MAX_OPT_OUT_REASON) {
    return `The reason must fit in ${MAX_OPT_OUT_REASON.toLocaleString("en-GB")} characters.`;
  }
  return null;
}

/** The restore's reason (0133). */
export function restoreReasonProblem(reason: string): string | null {
  return reasonProblem(reason, "Say why the student is coming back. The reason is shown to them.");
}

/** The withdrawal's reason (0134). */
export function withdrawalReasonProblem(reason: string): string | null {
  return reasonProblem(reason, "Say why the offer is being withdrawn. The student is shown this.");
}

/**
 * One row of `participation_status_changes` (0133).
 *
 * `changedByName` is the embedded profile, and null on the (impossible-by-the-
 * RPC) row whose author was deleted — the ledger keeps the row, so the screen
 * keeps saying who it cannot read rather than dropping the change.
 */
export interface ParticipationChange {
  readonly id: string;
  readonly fromStatus: ParticipationStatus;
  readonly toStatus: ParticipationStatus;
  readonly reason: string;
  readonly changedByName: string | null;
  /** ISO `timestamptz` as the API returns it. */
  readonly changedAt: string;
}

/**
 * One row of `offer_withdrawals` (0134).
 *
 * The offer itself is gone — this row is its snapshot — so the pay fields come
 * out of the `offer` jsonb rather than a live join, and a withdrawn internship
 * is still quoted as a stipend instead of the `₹0 LPA` its NOT NULL CTC column
 * holds.
 */
export interface OfferWithdrawal {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly source: OfferSource;
  readonly driveType: DriveType;
  readonly ctcLpa: number;
  readonly stipendMonthly: number | null;
  readonly reason: string;
  readonly withdrawnByName: string | null;
  readonly withdrawnAt: string;
}

/** The badge's colour, named by intent. A subset of the UI's `Tone`. */
export type StatusEventTone = "neutral" | "warning";

/**
 * One line of the merged history, in the shape both screens draw.
 *
 * Built by `statusHistory`: one line per act, newest first, with the fact the
 * act moved and the person's words on it. A student and a coordinator reading
 * the same line get the same words — which is the point of the ledger.
 */
export interface StatusEvent {
  readonly id: string;
  readonly title: string;
  /** What changed, on one line: "Opted out → In the pipeline", "TCS · ₹6 LPA". */
  readonly detail: string;
  readonly byName: string | null;
  readonly at: string;
  readonly reason: string;
  readonly tone: StatusEventTone;
}

const restoreDetail = (change: ParticipationChange): string =>
  `${participationStatusLabel(change.fromStatus)} → ${participationStatusLabel(change.toStatus)}`;

/** The company, the role, the pay and where the offer came from. */
function withdrawalDetail(withdrawal: OfferWithdrawal): string {
  const parts = [withdrawal.companyName];
  if (withdrawal.roleTitle !== null && withdrawal.roleTitle.trim() !== "") {
    parts.push(withdrawal.roleTitle);
  }
  parts.push(describeOfferPay(withdrawal));
  parts.push(withdrawal.source === "self_placed" ? "self-placed" : "on campus");
  return parts.join(" · ");
}

/**
 * Both ledgers, merged newest first.
 *
 * One list rather than two blocks because the question a record page is
 * answering is "what has been done to this student's standing, and when", and
 * an opted-out student whose offer was taken back has one story, not two.
 * `id` is prefixed by the table it came from, so the two never collide as React
 * keys.
 */
export function statusHistory(
  changes: readonly ParticipationChange[],
  withdrawals: readonly OfferWithdrawal[],
): StatusEvent[] {
  const events: StatusEvent[] = [
    ...changes.map((change) => ({
      id: `change-${change.id}`,
      title: "Status changed",
      detail: restoreDetail(change),
      byName: change.changedByName,
      at: change.changedAt,
      reason: change.reason,
      tone: "neutral" as const,
    })),
    ...withdrawals.map((withdrawal) => ({
      id: `withdrawal-${withdrawal.id}`,
      // A withdrawal is not a status change: 0134 writes no status, and a line
      // that said "Status changed" would send the reader looking for a move
      // that never happened.
      title: "Offer withdrawn",
      detail: withdrawalDetail(withdrawal),
      byName: withdrawal.withdrawnByName,
      at: withdrawal.withdrawnAt,
      reason: withdrawal.reason,
      tone: "warning" as const,
    })),
  ];

  // ISO timestamps order correctly as text, so no Date is built to sort them.
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
