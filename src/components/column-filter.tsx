import { Filter } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";

/**
 * A column header filter button, shadcn-style.
 *
 * Clicking opens a dropdown with filter controls for that column. The dropdown
 * is rendered in a portal with fixed positioning so it never gets clipped by
 * table overflow or moves inside scrollable containers.
 */
export function ColumnFilterButton({
  label,
  active,
  align = "left",
  children,
}: {
  /** The column name, for the accessible label. */
  label: string;
  /** Whether a filter is currently applied to this column. */
  active: boolean;
  /** Popover alignment relative to button. */
  align?: "left" | "right";
  /** The dropdown content — filter controls for this column. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const width = 240;
      let left = align === "right" ? rect.right - width : rect.left;
      if (typeof window !== "undefined") {
        if (left + width > window.innerWidth - 12) {
          left = Math.max(12, window.innerWidth - width - 12);
        }
        if (left < 12) left = 12;
      }
      setCoords({
        top: rect.bottom + 4,
        left,
      });
    }

    updatePosition();

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, align]);

  return (
    <div className="inline-flex items-center">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Filter ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex min-h-[32px] min-w-[32px] items-center justify-center gap-1 rounded p-0.5 transition-colors hover:text-ink-900 sm:min-h-0 sm:min-w-0 ${
          active ? "text-brand-600" : "text-ink-400"
        }`}
      >
        <Filter aria-hidden="true" className={`size-3.5 ${active ? "fill-current" : ""}`} />
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            role="dialog"
            aria-label={`Filter ${label}`}
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 9999,
            }}
            className="min-w-[230px] max-w-xs rounded-xl border border-line bg-surface p-3 shadow-xl"
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly count?: number | undefined;
}

/**
 * A searchable filter input with optional list of existing selectable options.
 *
 * Shows the search input and, when options are provided, lists all available
 * options with student counts. Users can either type to filter or click an
 * existing option directly.
 */
export function ColumnFilterSearch({
  label,
  value,
  onChange,
  placeholder,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  options?: readonly FilterOption[] | undefined;
}) {
  const inputId = useId();
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const filteredOptions = useMemo(() => {
    if (!options || options.length === 0) return [];
    if (!localValue.trim()) return options;
    const q = localValue.toLowerCase().trim();
    return options.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [options, localValue]);

  return (
    <div className="flex flex-col gap-2 min-w-[230px]">
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-xs font-semibold text-ink-700">
          {label}
        </label>
        {localValue !== "" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLocalValue("");
              onChange("");
            }}
            className="h-auto px-1.5 py-0.5 text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50"
          >
            Clear
          </Button>
        )}
      </div>

      <input
        id={inputId}
        type="search"
        value={localValue}
        onChange={(event) => {
          setLocalValue(event.target.value);
          onChange(event.target.value);
        }}
        placeholder={placeholder ?? `Search ${label.toLowerCase()}…`}
        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-hidden focus:ring-1 focus:ring-brand-500"
      />

      {options && options.length > 0 && (
        <div className="mt-1 max-h-48 overflow-y-auto space-y-0.5 border-t border-line/60 pt-2 [scrollbar-width:thin]">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            Available ({options.length})
          </p>
          {filteredOptions.length === 0 ? (
            <p className="px-1 py-2 text-center text-xs text-ink-400">
              No matching {label.toLowerCase()}
            </p>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = localValue.toLowerCase() === opt.value.toLowerCase();
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setLocalValue(opt.value);
                    onChange(opt.value);
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? "bg-brand-50 font-semibold text-brand-700"
                      : "text-ink-700 hover:bg-surface-muted"
                  }`}
                >
                  <span className="truncate mr-2" title={opt.label}>
                    {opt.label}
                  </span>
                  {opt.count !== undefined && (
                    <span
                      aria-hidden="true"
                      className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-mono text-ink-500 shrink-0"
                    >
                      {opt.count}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A set of checkboxes for a column filter dropdown.
 *
 * Used for columns where the filter is an enum (status, type, etc.). Each
 * option is a checkbox, and the filter is applied when one or more are checked.
 * An empty selection means no filter is applied (all values shown).
 */
export function ColumnFilterOptions({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly FilterOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <div className="flex flex-col gap-2 min-w-[200px]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-700">{label}</p>
        {selected.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange([])}
            className="h-auto px-1.5 py-0.5 text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50"
          >
            Clear
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pt-1 [scrollbar-width:thin]">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-xs text-ink-900 hover:bg-surface-muted transition-colors"
          >
            <span className="flex items-center gap-2 min-w-0">
              <input
                type="checkbox"
                aria-label={option.label}
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
                className="size-3.5 rounded border-line text-brand-600 focus:ring-brand-500"
              />
              <span className="truncate">{option.label}</span>
            </span>
            {option.count !== undefined && (
              <span
                aria-hidden="true"
                className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-mono text-ink-500 shrink-0 ml-2"
              >
                {option.count}
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
