import { Button, Card, PageHeader } from "@components/ui";
import { canRequestOptOut } from "@domain/participation";
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
  const [reason, setReason] = useState("");
  const [declaration, setDeclaration] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await view.status());
  }, [view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function optOut() {
    if (reason.trim() === "") return;

    // The domain refuses without the declaration, so the screen and the
    // database refuse for the same reason and say the same thing.
    const decision = canRequestOptOut({
      participationStatus: status?.participationStatus ?? "active",
      hasPendingRequest: hasPendingRequest(status?.optOutRequests ?? []),
      hasDeclaration: declaration !== null,
    });
    if (!decision.allowed) {
      setError(decision.reason);
      return;
    }

    setError(null);
    try {
      await view.requestOptOut({ reason: reason.trim(), declaration: declaration as File });
      setReason("");
      setDeclaration(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send your request.");
    }
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

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
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
                <div className="min-w-0">
                  <p className="text-sm text-ink-900">“{request.reason}”</p>
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
          Opting out removes you from all future drives. It <strong>cannot be reversed</strong>.
          Drives you are already part of will continue.
        </p>

        {status === null ? (
          <p role="status" className="mt-3 text-sm text-ink-500">
            Loading…
          </p>
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
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
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
                opting out cannot be reversed afterwards.
              </p>
              <input
                id="optout-declaration"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setDeclaration(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-3">
              <Button variant="secondary" onClick={() => void optOut()}>
                Request opt-out
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
