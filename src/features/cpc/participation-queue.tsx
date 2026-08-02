import { Button, Card, PageHeader } from "@components/ui";
import { useCallback, useEffect, useState } from "react";

export interface PendingOptOut {
  readonly id: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly reason: string;
}

export interface PendingSelfPlacement {
  readonly id: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly companyName: string;
  readonly ctcLpa: number;
}

export interface PendingParticipation {
  readonly optOuts: readonly PendingOptOut[];
  readonly selfPlacements: readonly PendingSelfPlacement[];
}

export interface ParticipationQueueView {
  pending(): Promise<PendingParticipation>;
  approveOptOut(requestId: string): Promise<void>;
  rejectOptOut(requestId: string): Promise<void>;
  approveSelfPlacement(offerId: string): Promise<void>;
}

/**
 * Opt-out and self-placement approvals.
 *
 * Approving an opt-out is irreversible for the student and removes them from
 * every future drive, so the consequence is stated on the screen rather than
 * left to the coordinator's memory.
 */
export function ParticipationQueue({ view }: { view: ParticipationQueueView }) {
  const [pending, setPending] = useState<PendingParticipation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPending(await view.pending());
  }, [view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }

  const nothingWaiting =
    pending !== null && pending.optOuts.length === 0 && pending.selfPlacements.length === 0;

  return (
    <div>
      <PageHeader
        title="Opt-outs and off-campus offers"
        subtitle="Approving an opt-out removes the student from all future drives and cannot be undone."
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {pending === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading…
        </p>
      ) : nothingWaiting ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">Nothing waiting for approval.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {pending.optOuts.length > 0 && (
            <Card>
              <h2 className="border-b border-neutral-200 p-4 text-lg text-ink-900">
                Opt-out requests
              </h2>
              <ul className="divide-y divide-neutral-200">
                {pending.optOuts.map((request) => (
                  <li
                    key={request.id}
                    className="flex flex-wrap items-start justify-between gap-4 p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{request.studentName}</p>
                      <p className="text-sm text-ink-500">{request.rollNumber}</p>
                      <p className="mt-1 text-sm text-ink-700">“{request.reason}”</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void run(() => view.rejectOptOut(request.id))}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void run(() => view.approveOptOut(request.id))}
                      >
                        Approve
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {pending.selfPlacements.length > 0 && (
            <Card>
              <h2 className="border-b border-neutral-200 p-4 text-lg text-ink-900">
                Off-campus offers
              </h2>
              <ul className="divide-y divide-neutral-200">
                {pending.selfPlacements.map((placement) => (
                  <li
                    key={placement.id}
                    className="flex flex-wrap items-center justify-between gap-4 p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{placement.studentName}</p>
                      <p className="text-sm text-ink-500">
                        {placement.rollNumber} · {placement.companyName} · ₹{placement.ctcLpa} LPA
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void run(() => view.approveSelfPlacement(placement.id))}
                    >
                      Approve
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
