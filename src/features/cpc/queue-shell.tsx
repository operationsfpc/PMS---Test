import { Button, Card, PageHeader } from "@components/ui";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ParticipationQueueView, PendingParticipation } from "./participation-queue-contract";

/**
 * Runs a decision and reloads the queue, or says why it did not work.
 *
 * `said` is what the screen tells the coordinator once the decision landed.
 * Every approval here removes the row, and a row that only vanishes reads as a
 * page that did nothing at all.
 */
export type RunDecision = (action: () => Promise<void>, said: string) => void;

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
  const [decided, setDecided] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPending(await view.pending());
    } catch (cause) {
      // 2026-10-18: a rejected reload used to leave this screen on "Loading…"
      // forever, having swallowed why. An empty queue and a failed load mean
      // opposite things to a coordinator, so the list is cleared rather than
      // defaulted to empty, and the failure is said.
      setError(cause instanceof Error ? cause.message : "Could not load the queue.");
      setPending(null);
    }
  }, [view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback<RunDecision>(
    (action, said) => {
      void (async () => {
        setError(null);
        setDecided(null);
        try {
          await action();
          setDecided(said);
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

      {decided !== null && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-ink-900"
        >
          {decided}
        </div>
      )}

      {pending === null ? (
        // Nothing to list, and the alert above already says why. A coordinator
        // is not told to refresh the browser: the load is one click away.
        error === null ? (
          <p role="status" className="text-sm text-ink-500">
            Loading…
          </p>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            Try again
          </Button>
        )
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
