import { useEffect, useId, useRef, useState } from "react";

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  readonly sublabel?: string | null;
}

export interface ComboboxProps {
  readonly id?: string;
  readonly name?: string;
  readonly value?: string;
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
  readonly options: readonly ComboboxOption[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly error?: boolean;
  readonly allowCustom?: boolean;
  readonly className?: string;
  readonly "aria-label"?: string;
}

export function Combobox({
  id: explicitId,
  name,
  value = "",
  onChange,
  onBlur,
  options,
  placeholder = "Search or select…",
  disabled = false,
  error = false,
  allowCustom = true,
  className = "",
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const generatedId = useId();
  const id = explicitId ?? generatedId;
  const listboxId = `${id}-listbox`;

  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter options based on typed input
  const filteredOptions = options.filter((opt) => {
    if (!value.trim()) return true;
    const query = value.toLowerCase();
    return (
      opt.label.toLowerCase().includes(query) ||
      (opt.sublabel?.toLowerCase().includes(query) ?? false)
    );
  });

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  function handleSelect(option: ComboboxOption) {
    onChange(option.label);
    setIsOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(filteredOptions.length - 1);
      } else {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
      }
    } else if (e.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
        e.preventDefault();
        handleSelect(filteredOptions[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          disabled={disabled}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => {
            if (options.length > 0) setIsOpen(true);
          }}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className={`h-10 w-full rounded-lg border bg-surface px-3 pr-8 text-sm text-ink-900 transition-colors placeholder:italic placeholder:text-ink-400 placeholder:font-normal focus:border-brand-500 focus:outline-hidden focus:ring-1 focus:ring-brand-500 disabled:opacity-50 ${
            error ? "border-destructive/60 ring-1 ring-destructive/20" : "border-line"
          } ${className}`}
        />

        {/* Toggle / Chevron Button */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle suggestions"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setIsOpen((prev) => !prev);
            inputRef.current?.focus();
          }}
          className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-ink-400 hover:text-ink-700"
        >
          <svg
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Floating Popover Suggestions */}
      {isOpen && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-surface p-1 shadow-xl"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, index) => {
              const isSelected = opt.label.trim().toLowerCase() === value.trim().toLowerCase();
              const isHighlighted = index === highlightedIndex;

              return (
                <button
                  type="button"
                  key={opt.value || opt.label}
                  role="option"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
                    isHighlighted || isSelected
                      ? "bg-brand-50 text-brand-900 font-semibold"
                      : "text-ink-700 hover:bg-surface-muted"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="rounded-sm bg-surface-muted px-1.5 py-0.5 text-[10px] font-normal text-ink-500 border border-line">
                        {opt.sublabel}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <svg
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-brand-600 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-2 text-xs text-ink-500">
              {allowCustom && value.trim() ? (
                <span>
                  No exact match. <strong>"{value}"</strong> will be created as a new entry.
                </span>
              ) : (
                "No matching options found."
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
