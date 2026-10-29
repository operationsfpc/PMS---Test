import { ErrorPanel } from "@components/error-panel";
import { Button, Card, PageHeader } from "@components/ui";
import { toYmd } from "@domain/drive-date-filter";
import { holdDraftProblem } from "@domain/holds";
import { canRecordSelfPlacement, canRequestSelfPlacedHold } from "@domain/participation";
import { useAsyncAction } from "@lib/use-async-action";
import { useCallback, useEffect, useState } from "react";
import type { ParticipationStatusView, ParticipationView } from "./participation-contract";
import { RequestOutcome, submittedOn } from "./request-outcome";

/**
 * An offer the student found themselves. Its own head since F2 (UAT
 * 2026-08-06).
 *
 * Recorded as a separate statistic (PRD §16.2): it never touches the category
 * ladder, the internship cap or on-campus eligibility. Students ask about that
 * constantly, so the screen says it rather than waiting to be asked.
 *
 * 0130 splits the screen by what the student's status still allows:
 *   active     — the offer and a self-placement hold request leave together
 *                (offer letter + handwritten declaration). Nothing closes until
 *                a Campus Manager confirms it.
 *   opted_out  — there are no drives left to hold; the offer is recorded for
 *                the statistic, exactly as before.
 */
export function OffCampusPage({ view }: { view: ParticipationView }) {
  const [status, setStatus] = useState<ParticipationStatusView | null>(null);
  // The gate below reads this status, so a failed read is not a silent nothing:
  // assuming "active" would hand a disbarred student a form they cannot file.
  const [statusProblem, setStatusProblem] = useState<string | null>(null);
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [ctc, setCtc] = useState("");
  const [offerLetter, setOfferLetter] = useState<File | null>(null);
  const [declaration, setDeclaration] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState(() => toYmd(new Date()));
  const [endsAt, setEndsAt] = useState("");
  /** Said after a successful send, so nobody guesses what happens next. */
  const [sent, setSent] = useState<"hold" | "offer" | null>(null);
  const actions = useAsyncAction();

  const refresh = useCallback(async () => {
    try {
      setStatus(await view.status());
      setStatusProblem(null);
    } catch {
      // Anything already on screen stays — a failed re-read must not wipe the
      // offers this page showed a moment ago.
      setStatusProblem("We could not check your participation status.");
    }
  }, [view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const holdFlow = status?.participationStatus === "active";

  // Validation throws so that a missing CTC and a refused upload arrive in the
  // same alert as a failed request — one error source, not two. A double click
  // here records the same offer twice, and the coordinator then has to work out
  // which of the two rows to decline.
  async function selfPlace() {
    const value = Number(ctc);
    if (company.trim() === "" || !Number.isFinite(value) || value <= 0) {
      throw new Error("Enter the company and a valid CTC in LPA.");
    }

    // An unknown status is not an "active" one. The read that answers this is
    // the same read the panel above reports failing.
    if (status === null) {
      throw new Error(
        "We could not check your participation status, so nothing has been recorded. Try again.",
      );
    }

    if (holdFlow) {
      const decision = canRequestSelfPlacedHold({
        participationStatus: status.participationStatus,
        hasOfferLetter: offerLetter !== null,
        hasDeclaration: declaration !== null,
      });
      if (!decision.allowed) {
        throw new Error(decision.reason);
      }

      // The same draft gate the manager's dialog uses, asked before two
      // documents are uploaded.
      const draftProblem = holdDraftProblem({
        kind: "self_placed",
        reason,
        startsAt,
        endsAt,
      });
      if (draftProblem !== null) {
        throw new Error(draftProblem);
      }

      await view.requestSelfPlacedHold({
        companyName: company.trim(),
        roleTitle: roleTitle.trim(),
        ctcLpa: value,
        offerLetter: offerLetter as File,
        declaration: declaration as File,
        reason: reason.trim(),
        startsAt,
        endsAt,
      });
      setSent("hold");
    } else {
      const decision = canRecordSelfPlacement({
        participationStatus: status.participationStatus,
        hasOfferLetter: offerLetter !== null,
      });
      if (!decision.allowed) {
        throw new Error(decision.reason);
      }

      await view.recordSelfPlacement({
        companyName: company.trim(),
        roleTitle: roleTitle.trim(),
        ctcLpa: value,
        offerLetter: offerLetter as File,
      });
      setSent("offer");
    }

    setCompany("");
    setRoleTitle("");
    setCtc("");
    setOfferLetter(null);
    setDeclaration(null);
    setReason("");
    setEndsAt("");
    await refresh();
  }

  const placements = status?.selfPlacements ?? [];

  const field = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Off-campus offer"
        subtitle="An offer you found yourself, recorded and verified separately."
      />

      {actions.error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {actions.error}
        </div>
      )}

      {sent !== null && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-700"
        >
          {sent === "hold"
            ? "Your offer is recorded and your hold request is with your Campus Manager. Your drives stay open until they confirm it."
            : "Your offer is recorded. Your placement coordinator verifies it before it counts."}
        </div>
      )}

      {statusProblem !== null && (
        <div className="mb-4">
          <ErrorPanel onRetry={() => void refresh()} retryLabel="Check again">
            {statusProblem} Until it loads, an offer cannot be recorded.
          </ErrorPanel>
        </div>
      )}

      {/*
       * F3: "After the approval of the Self offer letter, the student is not
       * able to go back to check the submission and approval status of it."
       * Every offer stays, decided or not, with what was submitted.
       */}
      {placements.length > 0 && (
        <Card className="mb-6">
          <h2 className="border-b border-line p-4 text-lg text-ink-900">
            Offers you have recorded
          </h2>
          <ul className="divide-y divide-line">
            {placements.map((placement) => (
              <li
                key={placement.id}
                className="flex flex-wrap items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{placement.companyName}</p>
                  <p className="text-sm text-ink-500">
                    {placement.roleTitle === null || placement.roleTitle === ""
                      ? `₹${placement.ctcLpa} LPA`
                      : `${placement.roleTitle} · ₹${placement.ctcLpa} LPA`}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Submitted {submittedOn(placement.submittedAt)}
                  </p>
                </div>
                <RequestOutcome status={placement.status} reason={placement.decisionReason} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5 sm:p-6">
        {status === null ? (
          // Which form applies — offer only, or offer plus hold request — is
          // answered by the status, so neither is shown before it arrives.
          <p role="status" className="text-sm text-ink-500">
            {statusProblem === null
              ? "Checking your participation status…"
              : "An offer cannot be recorded until your participation status loads."}
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-700">
              {holdFlow ? (
                <>
                  Recording an offer here also asks your Campus Manager to place a{" "}
                  <strong>self-placement hold</strong> on you. Until they confirm it, nothing
                  changes — you can still apply. Once confirmed, drives close to you and no
                  notification reaches you until the college releases it.
                </>
              ) : (
                <>
                  Recorded as a separate statistic. It <strong>does not affect</strong> your
                  on-campus eligibility or which drives you can apply to.
                </>
              )}
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="sp-company" className="mb-1 block text-sm font-medium text-ink-700">
                  Company
                </label>
                <input
                  id="sp-company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className={field}
                />
              </div>
              <div>
                <label htmlFor="sp-role" className="mb-1 block text-sm font-medium text-ink-700">
                  Role
                </label>
                <input
                  id="sp-role"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  className={field}
                />
              </div>
              <div>
                <label htmlFor="sp-ctc" className="mb-1 block text-sm font-medium text-ink-700">
                  CTC (LPA)
                </label>
                <input
                  id="sp-ctc"
                  inputMode="decimal"
                  value={ctc}
                  onChange={(e) => setCtc(e.target.value)}
                  className={field}
                />
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="sp-letter" className="mb-1 block text-sm font-medium text-ink-700">
                Offer letter <span className="text-destructive">*</span>
              </label>
              <p className="mb-2 text-xs text-ink-500">
                {holdFlow
                  ? "Your Campus Manager reads it before confirming the hold, and your placement coordinator verifies it before the offer counts."
                  : "Required. There is no drive behind an off-campus offer, so the letter is the only evidence there is — it must be verified by your Campus Placement Coordinator before it counts towards anything."}
              </p>
              <input
                id="sp-letter"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setOfferLetter(e.target.files?.[0] ?? null)}
                className={field}
              />
            </div>

            {holdFlow && (
              <>
                <div className="mt-4">
                  <label
                    htmlFor="sp-declaration"
                    className="mb-1 block text-sm font-medium text-ink-700"
                  >
                    Signed declaration <span className="text-destructive">*</span>
                  </label>
                  <p className="mb-2 text-xs text-ink-500">
                    A <strong>handwritten and signed</strong> letter confirming that you have
                    accepted this offer and are asking for your placements to be held. A clear
                    photograph is fine. Only your college sees it.
                  </p>
                  <input
                    id="sp-declaration"
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) => setDeclaration(e.target.files?.[0] ?? null)}
                    className={field}
                  />
                </div>

                <div className="mt-4">
                  <label
                    htmlFor="sp-reason"
                    className="mb-1 block text-sm font-medium text-ink-700"
                  >
                    Why hold your placements? <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="sp-reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Offer from Freshworks (SDE), joining January — asking not to be put forward for more drives."
                    className={field}
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    This is what your college reads with the request.
                  </p>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="sp-starts"
                      className="mb-1 block text-sm font-medium text-ink-700"
                    >
                      From
                    </label>
                    <input
                      id="sp-starts"
                      type="date"
                      value={startsAt}
                      onChange={(e) => setStartsAt(e.target.value)}
                      className={field}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sp-ends"
                      className="mb-1 block text-sm font-medium text-ink-700"
                    >
                      Review by <span className="text-destructive">*</span>
                    </label>
                    <input
                      id="sp-ends"
                      type="date"
                      value={endsAt}
                      onChange={(e) => setEndsAt(e.target.value)}
                      className={field}
                    />
                    <p className="mt-1 text-xs text-ink-500">
                      A reminder for your college, not a switch: the hold stays until they release
                      it.
                    </p>
                  </div>
                </div>
              </>
            )}

            <div className="mt-4">
              <Button isLoading={actions.busy} onClick={() => void actions.run(selfPlace)}>
                {holdFlow ? "Send hold request" : "Record off-campus offer"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
