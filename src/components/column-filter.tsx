import { Filter } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "./ui";

/**
 * A column header filter button, shadcn-style.
 *
 * Clicking opens a dropdown with filter controls for that column. The dropdown
 * closes on outside click or Escape. The button shows a filled icon when a
 * filter is active, so a coordinator scanning the headers sees which columns
 * are narrowed.
 */
export function ColumnFilterButton({
  label,
  active,
  children,
}: {
  /** The column name, for the accessible label. */
  label: string;
  /** Whether a filter is currently applied to this column. */
  active: boolean;
  /** The dropdown content — filter controls for this column. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={`Filter ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center gap-1 rounded transition-colors hover:text-ink-900 ${
          active ? "text-brand-600" : "text-ink-400"
        }`}
      >
        <Filter aria-hidden="true" className={`size-3.5 ${active ? "fill-current" : ""}`} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Filter ${label}`}
          className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-line bg-surface p-3 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A text search input for a column filter dropdown.
 *
 * Used for columns where the filter is a text match (company name, role title,
 * etc.). The input is labelled by the column name, and the placeholder says
 * what to search for.
 */
export function ColumnFilterSearch({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const inputId = useId();
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-xs font-semibold text-ink-700">
        {label}
      </label>
      <input
        id={inputId}
        type="search"
        value={localValue}
        onChange={(event) => {
          setLocalValue(event.target.value);
          onChange(event.target.value);
        }}
        placeholder={placeholder ?? `Search ${label.toLowerCase()}…`}
        className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-hidden focus:ring-1 focus:ring-brand-500"
      />
      {localValue !== "" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setLocalValue("");
            onChange("");
          }}
          className="self-start"
        >
          Clear
        </Button>
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
  options: readonly { value: string; label: string }[];
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
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-ink-700">{label}</p>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-ink-900 hover:bg-surface-muted"
          >
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
              className="size-3.5 rounded border-line text-brand-600 focus:ring-brand-500"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => onChange([])} className="self-start">
          Clear
        </Button>
      )}
    </div>
  );
}
