import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
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

const TONE_CLASSES: Record<
  ToastTone,
  { card: string; icon: string; title: string; iconComponent: typeof Info }
> = {
  danger: {
    card: "border-danger-200/90 bg-danger-50/95 text-danger-950 shadow-xl shadow-danger-900/5 ring-1 ring-danger-200/40 backdrop-blur-md",
    icon: "text-danger-700 bg-danger-100",
    title: "text-danger-950 font-semibold",
    iconComponent: AlertCircle,
  },
  success: {
    card: "border-success-200/90 bg-success-50/95 text-success-950 shadow-xl shadow-success-900/5 ring-1 ring-success-200/40 backdrop-blur-md",
    icon: "text-success-700 bg-success-100",
    title: "text-success-950 font-semibold",
    iconComponent: CheckCircle2,
  },
  warning: {
    card: "border-gold-200/90 bg-gold-50/95 text-gold-950 shadow-xl shadow-gold-900/5 ring-1 ring-gold-200/40 backdrop-blur-md",
    icon: "text-gold-800 bg-gold-100",
    title: "text-gold-950 font-semibold",
    iconComponent: AlertTriangle,
  },
  info: {
    card: "border-brand-200/90 bg-brand-50/95 text-ink-900 shadow-xl shadow-brand-900/5 ring-1 ring-brand-200/40 backdrop-blur-md",
    icon: "text-brand-700 bg-brand-100",
    title: "text-brand-950 font-semibold",
    iconComponent: Info,
  },
};

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
  const style = TONE_CLASSES[tone];
  const Icon = style.iconComponent;

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live="polite"
      className={`pointer-events-auto flex w-full max-w-md flex-col rounded-2xl border p-4 shadow-xl transition-all ${style.card}`}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${style.icon}`}
        >
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className={`text-sm ${style.title}`}>{title}</h4>
            {onClose && (
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={onClose}
                className="cursor-pointer rounded-lg p-1 text-ink-400 transition-colors hover:bg-black/5 hover:text-ink-700"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {description && (
            <p className="mt-1 text-xs text-ink-700 leading-relaxed">{description}</p>
          )}

          {issues && issues.length > 0 && (
            <div className="mt-2.5 max-h-48 overflow-y-auto rounded-xl border border-danger-200/60 bg-white/70 p-2.5 shadow-2xs backdrop-blur-xs">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-danger-700">
                Required fixes ({issues.length}):
              </p>
              <ul className="space-y-1 text-xs text-danger-900">
                {issues.map((issue) => (
                  <li key={issue} className="flex items-start gap-1.5 leading-snug">
                    <span className="shrink-0 font-bold text-danger-600">•</span>
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
