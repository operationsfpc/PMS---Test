import { Card } from "@components/ui";
import { roleCategoryLabel, roleCategoryStyle } from "@domain/role-category";
import { ROLE_CATEGORIES, type RoleCategory } from "@domain/types";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * The PIF's visual kit: the section card, the labelled field wrapper, the
 * radio group, the category picker and the two style constants every input
 * shares. Used by `pif-fields.tsx` and by the parts of each form that stay
 * form-specific.
 */

/**
 * A section of the PIF, as a card: a plain header with the number and title,
 * then the fields in the two-column grid. The number is printed BESIDE the
 * heading (never inside it) so the heading's accessible name stays the plain
 * title the tests and screen readers expect.
 */
export function Section({
  number,
  title,
  id,
  action,
  children,
}: {
  number?: number;
  title: string;
  /** Anchor target for the sticky section nav. */
  id?: string;
  /** Sits at the right of the header — a role block's "Remove role". */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mb-4 scroll-mt-24">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5 border-b border-line pb-3">
          <div className="flex items-center gap-2.5">
            {number !== undefined && (
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white"
              >
                {number}
              </span>
            )}
            <h2 className="font-heading text-lg font-bold text-brand-500">{title}</h2>
          </div>
          {action}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">{children}</div>
      </Card>
    </section>
  );
}

/**
 * The sticky in-page nav. One chip per section; clicking jumps to it. It
 * floats above the form so an AE halfway down a long PIF can still see where
 * they are and what is left.
 */
export function SectionNav({
  label,
  items,
}: {
  label: string;
  items: readonly { id: string; label: string; number?: number }[];
}) {
  return (
    <nav
      aria-label={label}
      className="sticky top-2 z-20 mb-4 flex flex-wrap gap-2 rounded-card border border-line bg-surface/95 p-2 shadow-sm backdrop-blur"
    >
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-field bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700"
        >
          {item.number !== undefined && (
            <span
              aria-hidden="true"
              className="flex size-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-800"
            >
              {item.number}
            </span>
          )}
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * One field: its label, its control, and the reason it was refused.
 *
 * The refusal is the field's own business, and it is said AT the field. The
 * PIF used to report validation failures only in a toast, so an AE was told
 * "4 fields require attention" and then had to find them. The label turns
 * red, the control turns red, and the reason sits under it - the same
 * treatment the SRF gives a student's form.
 */
export function Labelled({
  label,
  error,
  children,
  wide = false,
  required = false,
}: {
  label: string;
  error?: string | undefined;
  /** The control, and whether it failed: set `aria-invalid` on it. */
  children: (id: string, invalid: boolean) => ReactNode;
  wide?: boolean;
  /** G2 (UAT 2026-08-20): required to SUBMIT — the marker the form was missing. */
  required?: boolean;
}) {
  const id = useId();
  const hasError = error !== undefined && error.trim() !== "";
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label
        htmlFor={id}
        className={`mb-1 block text-sm ${
          hasError ? "font-semibold text-danger-700" : "font-medium text-ink-900"
        }`}
      >
        {required ? `${label} *` : label}
        {hasError && (
          <span
            aria-hidden="true"
            className="ml-2 inline-flex items-center rounded bg-danger-100 px-1.5 py-0.5 text-[11px] font-bold text-danger-800"
          >
            Invalid
          </span>
        )}
      </label>
      {children(id, hasError)}
      {hasError && (
        <p role="alert" className="mt-1 text-xs font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The one control style every PIF input shares.
 *
 * `aria-invalid:` is what turns a refused field red: the control says it is
 * invalid and the style follows, so a field cannot look fine while the form
 * says it is wrong.
 */
export const control =
  "w-full rounded-lg border border-field bg-surface px-3 py-2 text-sm outline-none placeholder:italic placeholder:text-ink-500 placeholder:font-normal transition-colors focus:border-brand-600 focus:ring-1 focus:ring-brand-500 aria-invalid:border-danger-500 aria-invalid:ring-1 aria-invalid:ring-danger-500/30 focus:aria-invalid:border-danger-600";

/**
 * An untouched optional number is NOT zero.
 *
 * This read `v === "" ? null : Number(v)`, and RHF hands `setValueAs` the
 * DEFAULT value - `null` - for a field nobody typed in. `Number(null)` is 0,
 * so every blank optional number was submitted as a real zero: a maximum CTC
 * of 0 (which then failed "cannot be below the minimum"), and a CGPA cutoff
 * of 0 stored as a cutoff rather than as "none set".
 */
export const numeric = {
  setValueAs: (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v)),
};

/**
 * A radio group, as a fieldset with a real legend.
 *
 * Nothing is preselected anywhere it is used: a preselected first option is an
 * answer nobody gave, and it would be stored as if the AE had chosen it.
 */
export function RadioGroup({
  legend,
  name,
  options,
  value,
  onChange,
  error,
  required = false,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  error?: string | undefined;
  /** G2: required to submit. */
  required?: boolean;
}) {
  return (
    <fieldset>
      <legend
        className={`mb-2 text-sm ${
          error !== undefined ? "font-semibold text-danger-700" : "font-medium text-ink-900"
        }`}
      >
        {required ? `${legend} *` : legend}
      </legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-4 accent-brand-500"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error !== undefined && (
        <p role="alert" className="mt-1 text-xs font-medium text-danger-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * The role category, as a picker that accepts MORE THAN ONE.
 *
 * A recruiter visiting once for "Software / Technical" AND "Sales" states one
 * job brief with two categories, so the AE must be able to say both on the same
 * PIF. Each category raised here becomes its OWN drive row under the visit —
 * students prefer categories one at a time and every eligibility gate matches a
 * student's preference against a single `drives.role_category`, so one row per
 * category is what makes both audiences visible to each other. The expansion
 * happens in the repository, not here: this widget only holds the answer.
 *
 * `aria-expanded` on a plain button is the disclosure pattern: the panel is a
 * checklist, not a list of options, so it is named as a group of checkboxes
 * rather than pretended to be a `<select>`. The value travels through
 * `onChange` exactly as `ShiftField` moves a radio choice — no hidden input,
 * because the form reads its own state.
 */
export function CategoryDropdown({
  id,
  value,
  onChange,
  invalid = false,
}: {
  /** The id the enclosing `Labelled` hands down, so the label points at the control. */
  id: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Always in `ROLE_CATEGORIES` order, whatever tick order the AE used.
  const picked = ROLE_CATEGORIES.filter((category) => value.includes(category));
  const summary =
    picked.length === 0
      ? "Choose…"
      : picked.map((category) => roleCategoryLabel(category)).join(", ");

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Back to the trigger, because Escape means "I am not choosing now" and
      // the focus must not be left on a box that just disappeared.
      document.getElementById(id)?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, id]);

  function toggle(category: RoleCategory, on: boolean) {
    onChange(
      on
        ? ROLE_CATEGORIES.filter((c) => c === category || value.includes(c))
        : value.filter((c) => c !== category),
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-controls={ROLE_CATEGORIES.map((category) => `${id}-${category}`).join(" ")}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((prev) => !prev)}
        className={`${control} flex items-center justify-between gap-2 text-left ${
          picked.length === 0 ? "italic text-ink-500" : "text-ink-900"
        }`}
      >
        <span className="truncate">{summary}</span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-ink-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <svg
            aria-hidden="true"
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {/* The choices stay in the DOM and hidden, because they are what the
          trigger's `aria-controls` names and what Tab reaches — a closed
          trigger that points at nothing would be a broken reference. */}
      {/* biome-ignore lint/a11y/useSemanticElements: <fieldset> would print the
          group name again inside the popover, under the label that already
          says "Role category *". */}
      <div
        role="group"
        aria-label="Role categories"
        className={`${open ? "block" : "hidden"} absolute z-50 mt-1 w-full rounded-lg border border-line bg-surface p-1 shadow-xl`}
      >
        {ROLE_CATEGORIES.map((category) => (
          <label
            key={category}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink-800 hover:bg-surface-muted"
          >
            <input
              id={`${id}-${category}`}
              type="checkbox"
              checked={value.includes(category)}
              onChange={(event) => toggle(category, event.target.checked)}
              className="size-4 shrink-0 accent-brand-500"
            />
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${roleCategoryStyle(category).dot}`}
            />
            {roleCategoryLabel(category)}
          </label>
        ))}
        <p className="border-t border-line px-2.5 py-2 text-xs text-ink-500">
          Each category you choose becomes its own role row under this visit, with the same brief,
          compensation and bar.
        </p>
      </div>
    </div>
  );
}
