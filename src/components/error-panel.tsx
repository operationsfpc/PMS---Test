import type { ReactNode } from "react";
import { Button } from "./ui";

/**
 * A load that failed, and the control that tries it again.
 *
 * 2026-10-18: nine screens reported a failed load honestly and then told the
 * reader to "Refresh the page" or "Please try again" — an instruction dressed as
 * an error message, with no button to carry it out. A reader who has just been
 * told to do something should be handed the thing that does it.
 *
 * Failure is still never shown as an empty list: "nothing waiting" and "we
 * could not ask" mean opposite things, and only one of them is good news.
 */
export function ErrorPanel({
  onRetry,
  retryLabel = "Try again",
  children,
}: {
  readonly onRetry?: (() => void) | undefined;
  readonly retryLabel?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-card border border-danger-500/30 bg-danger-50 p-4 text-sm text-danger-700"
    >
      <p>{children}</p>
      {onRetry !== undefined && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
