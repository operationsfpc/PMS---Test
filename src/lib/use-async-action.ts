import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Every write button on this platform used to answer with whatever text the
 * page author had typed into the label — "Saving…", "Publishing…", eleven
 * spellings — and nine of them kept the button clickable while the request was
 * still out. A second click on `publish_drive` is a second announcement.
 *
 * `useAsyncAction` is the one place that knows a request is in flight: it
 * tracks pending state per key so a row's spinner does not light up its
 * neighbours, refuses the second click, and turns a rejection into copy the
 * user can act on.
 */
export interface AsyncActions {
  /**
   * Run `action`, keyed by `key` so a list of rows can share one hook.
   * Resolves `true` on success, `false` when it failed or was refused because
   * the same key was already running.
   */
  run(action: () => Promise<unknown>, key?: string): Promise<boolean>;
  isPending(key?: string): boolean;
  /** Any action from this hook is in flight — for disabling a whole form. */
  busy: boolean;
  /** The last failure's message, in the copy the view wrote. */
  error: string | null;
  dismissError(): void;
}

/** The view layers throw `Error`s with the sentence the user should read. */
const describe = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "That didn’t go through. Please try again.";

export function useAsyncAction(): AsyncActions {
  const running = useRef(new Set<string>());
  const mounted = useRef(true);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const sync = useCallback(() => {
    if (!mounted.current) return;
    setPending(new Set(running.current));
  }, []);

  const run = useCallback(
    async (action: () => Promise<unknown>, key = "@default") => {
      if (running.current.has(key)) return false;

      running.current.add(key);
      sync();
      if (mounted.current) setError(null);

      try {
        await action();
        return true;
      } catch (cause) {
        if (mounted.current) setError(describe(cause));
        return false;
      } finally {
        running.current.delete(key);
        sync();
      }
    },
    [sync],
  );

  const isPending = useCallback(
    (key = "@default") => pending.has(key),
    // `pending` is the only input that matters: a ref read would not re-render.
    [pending],
  );

  return {
    run,
    isPending,
    busy: pending.size > 0,
    error,
    dismissError: () => setError(null),
  };
}
