import { QuotedText } from "@components/quoted-text";
import { StatusHistory } from "@components/status-history";
import { Button, Card, PageHeader } from "@components/ui";
import { canRequestOptOut, MAX_OPT_OUT_REASON, optOutReasonProblem } from "@domain/participation";
import type { StatusEvent } from "@domain/status-changes";
import { describeReadFailure } from "@lib/postgrest-read";
import { useAsyncAction } from "@lib/use-async-action";
import { useCallback, useEffect, useState } from "react";
import {
  hasPendingRequest,
  type ParticipationStatusView,
  type ParticipationView,
} from "./participation-contract";
import { RequestOutcome, submittedOn } from "./request-outcome";

/**
 * Opting out of campus placement. Its own head since F2 (UAT 2026-08-06).
 *
 * Irreversible, so the consequence is stated before the button rather than in
 * a confirmation the student has already decided to dismiss. Mobile-first:
 * students are on phones (PRD §21.2).
 */
export function OptOutPage({ view }: { view: ParticipationView }) {
  const [status, setStatus] = useState<ParticipationStatusView | null>(null);
  /** Separate from the action's error: this is about a read, not a request. */
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [declaration, setDeclaration] = useState<File | null>(null);
  /** Bumped to re-run the read after it refused to answer. */
  const [attempt, setAttempt] = useState(0);
  const actions = useAsyncAction();

  const refresh = useCallback(async () => {
    /*
     * `status()` throws now — it used to answer "active" over a refused read,
     * which offered this button to a student who had already opted out. Without
     * a catch here the card sat on "Loading…" forever, so the failure is said
     * and there is a way back.
     */
    try {
      setStatus(await view.status());
      setReadProblem(null);
    } catch (cause) {
      setStatus(null);
      setReadProblem(
        describeReadFailure(
          cause,
          "We could not read your participation status. Please try again.",
        ),
      );
    }
  }, [view]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on purpose
  useEffect(() => {
    void refresh();
  }, [refresh, attempt]);

  /*
   * 0133: the standing can now move without the student touching anything, so
   * the card that tells them "only your placement office can put you back, and
   * only by recording who and why" has to show them what that office wrote.
   * Read once on arrival — nothing this page does changes a status.
   */
  const [history, setHistory] = useState<readonly StatusEvent[]>([]);
  const [historyProblem, setHistoryProblem] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries every read this page makes
  useEffect(() => {
    let live = true;
    view.statusHistory().then(
      (events) => {
        if (live) {
          setHistory(events);
          setHistoryProblem(null);
        }
      },
      (cause: unknown) => {
        if (live)
          setHistoryProblem(
            describeReadFailure(cause, "We could not read your status history. Please try again."),
          );
      },
    );
    return () => {
      live = false;
    };
  }, [view, attempt]);

  // Validation throws instead of calling setError: the hook turns a rejection
  // into the sentence the student reads, so a missing reason and a refused
  // request share one alert rather than two states that can contradict each
  // other. And the student has no way back from this, which is exactly why a
  // second click must not be able to raise a second one.
  async function optOut() {
    // The domain owns the words, so the screen, the view and the count under
    // the box all refuse an over-long or blank reason identically.
    const reasonProblem = optOutReasonProblem(reason);
    if (reasonProblem !== null) {
      throw new Error(reasonProblem);
    }

    // The domain refuses without the declaration, so the screen and the
    // database refuse for the same reason and say the same thing.
    const decision = canRequestOptOut({
      participationStatus: status?.participationStatus ?? "active",
      hasPendingRequest: hasPendingRequest(status?.optOutRequests ?? []),
      hasDeclaration: declaration !== null,
    });
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }

    await view.requestOptOut({ reason: reason.trim(), declaration: declaration as File });
    setReason("");
    setDeclaration(null);
    await refresh();
  }

  const requests = status?.optOutRequests ?? [];

  const gate =
    status === null
      ? null
      : canRequestOptOut({
          participationStatus: status.participationStatus,
          hasPendingRequest: hasPendingRequest(requests),
          // Only the state of their participation should hide the form; a
          // missing document is a thing to ask for, not a reason to refuse.
          hasDeclaration: true,
        });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Opting out of campus placement"
        subtitle="A decision only you can make, and only once."
      />

      {actions.error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          {actions.error}
        </div>
      )}

      {readProblem !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          {readProblem}
        </div>
      )}

      {/*
       * F3: every request the student has ever raised, with what happened to
       * it. It used to disappear the moment a coordinator touched it, so a
       * student who had uploaded a signed letter could never confirm it had
       * been read.
       */}
      {requests.length > 0 && (
        <Card className="mb-6">
          <h2 className="border-b border-line p-4 text-lg text-ink-900">Your requests</h2>
          <ul className="divide-y divide-line">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                  <QuotedText text={request.reason} title="Your opt-out reason" />
                  <p className="mt-0.5 text-xs text-ink-500">
                    Submitted {submittedOn(request.submittedAt)}
                  </p>
                </div>
                <RequestOutcome status={request.status} reason={request.decisionReason} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5 sm:p-6">
        <p className="text-sm text-ink-700">
          Opting out removes you from all future drives. You{" "}
          <strong>cannot undo it yourself</strong> — only your placement office can put you back,
          and only by recording who and why. Drives you are already part of will continue.
        </p>

        {status === null ? (
          readProblem === null ? (
            <p role="status" className="mt-3 text-sm text-ink-500">
              Loading…
            </p>
          ) : (
            /* The sentence is already in the alert above; this is the way out of
               the card, which otherwise shows the warning and no control. */
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Check my status again
            </Button>
          )
        ) : status.participationStatus === "opted_out" ? (
          <p className="mt-4 text-sm font-medium text-ink-900">
            You have opted out of campus placement.
          </p>
        ) : gate?.allowed === false ? (
          <p className="mt-4 text-sm text-ink-700">{gate.reason}</p>
        ) : (
          <div className="mt-4">
            <label htmlFor="optout-reason" className="mb-1 block text-sm font-medium text-ink-700">
              Why are you opting out?
            </label>
            <textarea
              id="optout-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={MAX_OPT_OUT_REASON}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
            <p className="mt-1 text-right text-xs text-ink-500">
              {reason.length} / {MAX_OPT_OUT_REASON.toLocaleString("en-IN")} characters
            </p>
            <div className="mt-4">
              <label
                htmlFor="optout-declaration"
                className="mb-1 block text-sm font-medium text-ink-700"
              >
                Signed declaration <span className="text-destructive">*</span>
              </label>
              <p className="mb-2 text-xs text-ink-500">
                A <strong>handwritten and signed</strong> letter confirming that you are opting out.
                A clear photograph is fine. Your Campus Placement Coordinator has to approve it, and
                you cannot undo the decision afterwards.
              </p>
              <input
                id="optout-declaration"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setDeclaration(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-3">
              <Button
                variant="secondary"
                isLoading={actions.busy}
                onClick={() => void actions.run(optOut)}
              >
                Request opt-out
              </Button>
            </div>
          </div>
        )}
      </Card>

      <StatusHistory
        events={history}
        problem={historyProblem}
        subtitle="Every move the placement office made on your standing, with the reason they gave"
        className="mt-6"
      />
    </div>
  );
}
