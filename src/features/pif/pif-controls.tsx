import { Card } from "@components/ui";
import { type ReactNode, useId } from "react";

/**
 * The PIF's visual kit: the section card, the labelled field wrapper, the
 * radio group and the two style constants every input shares. Used by
 * `pif-fields.tsx` and by the parts of each form that stay form-specific.
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
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
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
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:italic placeholder:text-ink-400 placeholder:font-normal transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500 aria-invalid:border-danger-500 aria-invalid:ring-1 aria-invalid:ring-danger-500/30 focus:aria-invalid:border-danger-600";

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
