import { useCallback, useState } from "react";

export type ToastTone = "danger" | "success" | "warning" | "info";

export interface ToastItem {
  id: string;
  tone?: ToastTone | undefined;
  title: string;
  description?: string | undefined;
  issues?: readonly string[] | undefined;
  duration?: number | undefined;
}

export function Toast({
  tone = "info",
  title,
  description,
  issues,
  onClose,
}: {
  tone?: ToastTone | undefined;
  title: string;
  description?: string | undefined;
  issues?: readonly string[] | undefined;
  onClose?: (() => void) | undefined;
}) {
  const toneClasses: Record<ToastTone, { card: string; icon: string; title: string }> = {
    danger: {
      card: "border-destructive/40 bg-surface text-destructive shadow-lg ring-1 ring-destructive/10",
      icon: "text-destructive bg-destructive/10",
      title: "text-destructive font-semibold",
    },
    success: {
      card: "border-success-500/40 bg-surface text-success-800 shadow-lg ring-1 ring-success-500/10",
      icon: "text-success-600 bg-success-50",
      title: "text-success-900 font-semibold",
    },
    warning: {
      card: "border-gold-500/40 bg-surface text-gold-900 shadow-lg ring-1 ring-gold-500/10",
      icon: "text-gold-700 bg-gold-50",
      title: "text-gold-900 font-semibold",
    },
    info: {
      card: "border-brand-500/40 bg-surface text-ink-900 shadow-lg ring-1 ring-brand-500/10",
      icon: "text-brand-600 bg-brand-50",
      title: "text-ink-900 font-semibold",
    },
  };

  const style = toneClasses[tone];

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live="polite"
      className={`pointer-events-auto flex w-full max-w-md flex-col rounded-xl border p-4 shadow-xl transition-all ${style.card}`}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.icon}`}
        >
          {tone === "danger" && (
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          )}
          {tone === "success" && (
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {tone === "warning" && (
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )}
          {tone === "info" && (
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )}
        </div>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className={`text-sm ${style.title}`}>{title}</h4>
            {onClose && (
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={onClose}
                className="rounded p-1 text-ink-400 hover:bg-surface-muted hover:text-ink-700"
              >
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {description && (
            <p className="mt-1 text-xs text-ink-700 leading-relaxed">{description}</p>
          )}

          {issues && issues.length > 0 && (
            <div className="mt-2.5 max-h-48 overflow-y-auto rounded-lg border border-destructive/20 bg-destructive/5 p-2">
              <p className="text-[11px] font-semibold text-destructive uppercase tracking-wider mb-1">
                Required fixes ({issues.length}):
              </p>
              <ul className="space-y-1 text-xs text-destructive">
                {issues.map((issue) => (
                  <li key={issue} className="flex items-start gap-1.5 leading-snug">
                    <span className="font-bold shrink-0">•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <section
      aria-label="Notifications"
      className="fixed bottom-5 right-5 z-50 flex max-w-md w-full flex-col gap-2.5 px-4 pointer-events-none"
    >
      {toasts.map((t) => (
        <Toast
          key={t.id}
          tone={t.tone}
          title={t.title}
          description={t.description}
          issues={t.issues}
          onClose={() => onDismiss(t.id)}
        />
      ))}
    </section>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({
      tone = "info",
      title,
      description,
      issues,
      duration = 6000,
    }: {
      tone?: ToastTone | undefined;
      title: string;
      description?: string | undefined;
      issues?: readonly string[] | undefined;
      duration?: number | undefined;
    }) => {
      const id = Math.random().toString(36).substring(2, 9);
      const item: ToastItem = { id, tone, title, description, issues, duration };
      setToasts((prev) => [...prev, item]);

      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }
      return id;
    },
    [dismiss],
  );

  return { toasts, toast, dismiss };
}
