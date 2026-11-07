import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type ToastTone = "danger" | "success" | "warning" | "info";

export interface ToastItem {
  id: string;
  tone?: ToastTone | undefined;
  title: string;
  description?: string | undefined;
  issues?: readonly string[] | undefined;
  duration?: number | undefined;
  createdAt: number;
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

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 6000;
// A refusal lists fixes the field errors also carry, so it may close — just
// slower than a confirmation, and never while the pointer rests on it.
const DANGER_DURATION = 10000;

function dedupeKey(title: string, description?: string): string {
  return `${title}::${description ?? ""}`;
}

export function Toast({
  tone = "info",
  title,
  description,
  issues,
  onClose,
  onPause,
  onResume,
}: {
  tone?: ToastTone | undefined;
  title: string;
  description?: string | undefined;
  issues?: readonly string[] | undefined;
  onClose?: (() => void) | undefined;
  onPause?: (() => void) | undefined;
  onResume?: (() => void) | undefined;
}) {
  const style = TONE_CLASSES[tone];
  const Icon = style.iconComponent;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only pauses the countdown; the dismiss button is the keyboard control
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live="polite"
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      className={`animate-toast-in pointer-events-auto flex w-full flex-col rounded-2xl border p-4 shadow-xl transition-all ${style.card}`}
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
                className="cursor-pointer rounded-lg p-1 text-ink-500 transition-colors hover:bg-black/5 hover:text-ink-700"
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

interface ToastContextValue {
  toast: (opts: {
    tone?: ToastTone | undefined;
    title: string;
    description?: string | undefined;
    issues?: readonly string[] | undefined;
    duration?: number | undefined;
  }) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

interface Countdown {
  timer: number;
  remaining: number;
  startedAt: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const timersRef = useRef<Map<string, Countdown>>(new Map());
  const seenRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const entry = timersRef.current.get(id);
    if (entry !== undefined) {
      clearTimeout(entry.timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const startCountdown = useCallback(
    (id: string, ms: number) => {
      timersRef.current.set(id, {
        timer: window.setTimeout(() => dismiss(id), ms),
        remaining: ms,
        startedAt: Date.now(),
      });
    },
    [dismiss],
  );

  const pause = useCallback((id: string) => {
    const entry = timersRef.current.get(id);
    if (entry === undefined || entry.timer === 0) return;
    clearTimeout(entry.timer);
    entry.remaining -= Date.now() - entry.startedAt;
    entry.timer = 0;
  }, []);

  const resume = useCallback(
    (id: string) => {
      const entry = timersRef.current.get(id);
      if (entry === undefined || entry.timer !== 0) return;
      startCountdown(id, Math.max(entry.remaining, 500));
    },
    [startCountdown],
  );

  const toast = useCallback(
    ({
      tone = "info",
      title,
      description,
      issues,
      duration,
    }: {
      tone?: ToastTone | undefined;
      title: string;
      description?: string | undefined;
      issues?: readonly string[] | undefined;
      duration?: number | undefined;
    }) => {
      // Dedupe: same title+description within 2s → skip
      const key = dedupeKey(title, description);
      const lastSeen = seenRef.current.get(key);
      const now = Date.now();
      if (lastSeen !== undefined && now - lastSeen < 2000) {
        return "";
      }
      seenRef.current.set(key, now);

      const id = Math.random().toString(36).substring(2, 9);
      const effectiveDuration =
        duration !== undefined && duration > 0
          ? duration
          : tone === "danger"
            ? DANGER_DURATION
            : DEFAULT_DURATION;
      const item: ToastItem = {
        id,
        tone,
        title,
        description,
        issues,
        duration: effectiveDuration,
        createdAt: now,
      };
      setToasts((prev) => [...prev, item]);
      startCountdown(id, effectiveDuration);
      return id;
    },
    [startCountdown],
  );

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((entry) => {
        clearTimeout(entry.timer);
      });
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </ToastContext.Provider>
  );
}

const NOOP_TOAST: ToastContextValue = {
  toast: () => "",
  dismiss: () => {},
};

export function useAppToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  return ctx ?? NOOP_TOAST;
}

function ToastContainer({
  toasts,
  onDismiss,
  onPause,
  onResume,
}: {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  const visible = toasts.slice(0, MAX_VISIBLE);
  const overflow = toasts.length - MAX_VISIBLE;

  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2.5"
    >
      {visible.map((t) => (
        <Toast
          key={t.id}
          tone={t.tone}
          title={t.title}
          description={t.description}
          issues={t.issues}
          onClose={() => onDismiss(t.id)}
          onPause={() => onPause(t.id)}
          onResume={() => onResume(t.id)}
        />
      ))}
      {overflow > 0 && (
        <div className="pointer-events-auto rounded-2xl border border-line bg-surface px-4 py-2 text-xs font-medium text-ink-600 shadow-lg">
          +{overflow} more notification{overflow === 1 ? "" : "s"}
        </div>
      )}
    </section>
  );
}

// Backwards-compatible alias for existing callers
export function useToast() {
  return useAppToast();
}
