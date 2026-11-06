import { EllipsisVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./ui";

/**
 * The three dots that holds the actions a screen has but does not need to
 * shout.
 *
 * 2026-11-06: the Rounds & results header carried "Manage rounds…" and "Mark
 * drive completed…" as two full-width buttons beside the round tabs. Both
 * open a popup of their own and neither is pressed daily, so they were taking
 * the row's oxygen from the actions that are.
 *
 * Same dismissal rules as the header's account menu, and the same reason: one
 * listener, and Escape hands focus back to the trigger so a keyboard user does
 * not lose their place on the page.
 */
export interface OverflowMenuItem {
  readonly label: string;
  /** Return a promise when taking it reads something first — see the onClick. */
  readonly onSelect: () => unknown;
  /** A state rule, not a form-filling question — the reason belongs in `note`. */
  readonly disabled?: boolean;
  /** Its own read or write is in flight; the row spins instead of the page. */
  readonly pending?: boolean;
  /** Why it is greyed, or the fact it reports. Said inside the item, not elsewhere. */
  readonly note?: string | null;
}

export function OverflowMenu({
  items,
  label = "More actions",
  ariaLabel,
}: {
  items: readonly OverflowMenuItem[];
  /** What the popup is about, for the reader who cannot see the dots. */
  label?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        onClick={() => setOpen((was) => !was)}
        className="flex size-8 cursor-pointer items-center justify-center rounded-control text-ink-700 transition-colors hover:bg-surface-muted"
      >
        <EllipsisVertical aria-hidden="true" className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-card border border-line bg-surface p-1.5 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-busy={item.pending ?? false}
              onClick={() => {
                // The menu is a way INTO something; once it has been taken, it
                // has done its job and must not sit over the popup it opened.
                const taken = item.onSelect();
                if (!(taken instanceof Promise)) {
                  setOpen(false);
                  return;
                }
                void taken.then(
                  () => setOpen(false),
                  () => setOpen(false),
                );
              }}
              className="disabled:cursor-not-allowed disabled:opacity-60 flex min-h-[38px] w-full cursor-pointer items-start gap-2 rounded-control px-2.5 py-2 text-left text-[13px] font-medium text-ink-700 transition-colors hover:bg-surface-muted"
            >
              {item.pending ? (
                <Spinner className="mt-0.5 shrink-0" />
              ) : (
                <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-line" />
              )}
              <span className="min-w-0">
                <span className="block break-words">{item.label}</span>
                {item.note !== undefined && item.note !== null && (
                  <span className="mt-0.5 block text-xs font-normal text-ink-500 break-words">
                    {item.note}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
