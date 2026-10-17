import { type ReactNode, useEffect } from "react";

/**
 * A drill-down popup behind a dashboard number: the list of drives (or
 * whatever) the number counts, in place rather than behind a navigation.
 *
 * Presentation only — the contents decide what to list and how to filter.
 * Escape and the close button follow the `Sheet` pattern so every popup on the
 * platform behaves the same.
 */
export function DrilldownModal({
  eyebrow,
  title,
  subtitle,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="fpc-gradient h-1.5 w-full" />
        <header className="flex items-start justify-between gap-4 border-b border-line bg-surface-muted/40 p-5">
          <div className="min-w-0">
            <span className="inline-block rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
              {eyebrow}
            </span>
            <h2 className="mt-1 truncate text-lg font-bold text-ink-900">{title}</h2>
            {subtitle !== undefined && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-surface-muted hover:text-ink-900"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
