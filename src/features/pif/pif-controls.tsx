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
            <h2 className="font-[Raleway] text-lg font-bold text-[#3D3777]">{title}</h2>
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
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
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

export function Labelled({
  label,
  error,
  children,
  wide = false,
  required = false,
}: {
  label: string;
  error?: string | undefined;
  children: (id: string) => ReactNode;
  wide?: boolean;
  /** G2 (UAT 2026-08-20): required to SUBMIT — the marker the form was missing. */
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-900">
        {required ? `${label} *` : label}
      </label>
      {children(id)}
      {error !== undefined && (
        <p className="mt-1 text-xs text-[#DD4820]" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

export const control =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-[#A46AFC]";

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
      <legend className="mb-2 text-sm font-medium text-ink-900">
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
              className="size-4 accent-[#3D3777]"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error !== undefined && (
        <p className="mt-1 text-xs text-[#DD4820]" role="status">
          {error}
        </p>
      )}
    </fieldset>
  );
}
