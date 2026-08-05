import { Card, PageHeader } from "@components/ui";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ParticipationQueueView, PendingParticipation } from "./participation-queue-contract";

/** Runs a decision and reloads the queue, or says why it did not work. */
export type RunDecision = (action: () => Promise<void>) => void;

/**
 * The loading, empty and error scaffolding both approval queues share.
 *
 * Split out when F2 made them two screens: duplicating it would have given the
 * two queues a chance to disagree about what "nothing waiting" looks like, and
 * about whether a failed decision is reported at all.
 */
export function QueueShell({
  view,
  title,
  subtitle,
  empty,
  isEmpty,
  children,
}: {
  view: ParticipationQueueView;
  title: string;
  subtitle: string;
  empty: string;
  isEmpty: (pending: PendingParticipation) => boolean;
  children: (pending: PendingParticipation, run: RunDecision) => ReactNode;
}) {
  const [pending, setPending] = useState<PendingParticipation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPending(await view.pending());
  }, [view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback<RunDecision>(
    (action) => {
      void (async () => {
        setError(null);
        try {
          await action();
          await refresh();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Something went wrong.");
        }
      })();
    },
    [refresh],
  );

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />

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
      ) : isEmpty(pending) ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">{empty}</p>
        </Card>
      ) : (
        children(pending, run)
      )}
    </div>
  );
}
