import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";

/**
 * Form primitives, brand-styled and mobile-first.
 * Every control is label-associated — tests query by accessible name only.
 */

export const baseControlClass =
  "w-full rounded-lg border bg-surface px-3 py-2.5 text-[15px] " +
  "text-ink-900 placeholder:text-ink-300 transition-colors focus:outline-none disabled:bg-surface-muted";

export const getControlClass = (hasError?: boolean, extraClass?: string) => {
  const stateClass = hasError
    ? "border-danger-500 ring-1 ring-danger-500 focus:border-danger-600 focus:ring-2 focus:ring-danger-400/40 bg-danger-50/10"
    : "border-line hover:border-brand-300 focus:border-brand-500 focus:ring-2 focus:ring-violet-400/40";
  return [baseControlClass, stateClass, extraClass].filter(Boolean).join(" ");
};

export const controlClass = getControlClass(false);

/**
 * One field, with its own label, limits and failure reason.
 *
 * The asterisk used to be `aria-hidden`, which called "required" out to
 * sighted users only, and there was nowhere to put a validation message - a
 * student who omitted a marksheet was told the form failed but never which
 * one. Both are the field's job, so every control gets them for free.
 */
export function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  required?: boolean | undefined;
  error?: string | undefined;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
      .filter((x): x is string => x !== null)
      .join(" ") || undefined;

  const hasError = error !== undefined && error.trim() !== "";

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className={`text-sm transition-colors ${
          hasError ? "font-semibold text-danger-700" : "font-medium text-ink-700"
        }`}
      >
        <span>{label}</span>
        {required === true && (
          <>
            <span className="ml-0.5 text-danger-500" aria-hidden="true">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
        {hasError && (
          <span
            aria-hidden="true"
            className="ml-2 inline-flex items-center rounded bg-danger-100 px-1.5 py-0.5 text-[11px] font-bold text-danger-800"
          >
            Invalid
          </span>
        )}
      </label>
      {children(id, describedBy)}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One numbered step of a long form.
 *
 * Lifted out of the SRF (2026-08-06) rather than copied: "skills and
 * achievements editing page, want it to have similar look and feel to the
 * original student registration form." Two copies of this markup would drift
 * apart the first time either screen was touched, and the student would be the
 * one to notice.
 */
export function FormSection({
  id,
  title,
  step,
  description,
  children,
}: {
  /** Anchor target, so a progress tracker can jump back to it. */
  id?: string | undefined;
  title: string;
  step: number;
  description?: string | undefined;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      // Without this the sticky header covers the heading being jumped to.
      className="scroll-mt-24 rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6"
      aria-labelledby={headingId}
    >
      <div className="mb-5 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white"
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg text-ink-900">
            {title}
          </h2>
          {description !== undefined && (
            <p className="mt-0.5 text-sm text-ink-500">{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
} & InputHTMLAttributes<HTMLInputElement>) {
  const hasError = error !== undefined && error.trim() !== "";
  return (
    <Field label={label} hint={hint} required={props.required} error={error}>
      {(id, describedBy) => (
        <input
          id={id}
          className={getControlClass(hasError, className)}
          aria-required={props.required === true ? true : undefined}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  options,
  error,
  className,
  ...props
}: {
  label: string;
  hint?: string | undefined;
  options: readonly string[];
  error?: string | undefined;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const hasError = error !== undefined && error.trim() !== "";
  return (
    <Field label={label} hint={hint} required={props.required} error={error}>
      {(id, describedBy) => (
        <select
          id={id}
          className={getControlClass(hasError, className)}
          aria-required={props.required === true ? true : undefined}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={describedBy}
          defaultValue=""
          {...props}
        >
          <option value="" disabled>
            Select…
          </option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CheckboxField({
  label,
  description,
  ...props
}: { label: ReactNode; description?: string | undefined } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-brand-300 has-checked:border-brand-500 has-checked:bg-brand-50">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-brand-500"
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink-900">
          {label}
        </label>
        {description !== undefined && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
      </div>
    </div>
  );
}

/**
 * Upload limits, stated once.
 *
 * 5 MB is the storage cap set by 0010; PDF is what the picker has always
 * restricted to. Neither was ever shown to the student, so the first they knew
 * of either was a rejected upload. Exported so the tests - and any other
 * upload surface - use the same numbers the input enforces.
 */
export const UPLOAD_MAX_MB = 5;
export const UPLOAD_ACCEPT = "application/pdf";
export const UPLOAD_LIMITS = `PDF only, up to ${UPLOAD_MAX_MB} MB.`;

export function FileField({
  label,
  hint,
  error,
  className,
  ...props
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
} & InputHTMLAttributes<HTMLInputElement>) {
  const withLimits = hint === undefined ? UPLOAD_LIMITS : `${hint} ${UPLOAD_LIMITS}`;
  const hasError = error !== undefined && error.trim() !== "";

  return (
    <Field label={label} hint={withLimits} required={props.required} error={error}>
      {(id, describedBy) => (
        <input
          id={id}
          type="file"
          accept={UPLOAD_ACCEPT}
          // No aria-required here: a file input has no role that supports it,
          // and the native `required` from props already conveys the state.
          aria-invalid={hasError ? true : undefined}
          aria-describedby={describedBy}
          className={`w-full cursor-pointer rounded-lg border ${
            hasError
              ? "border-danger-500 ring-1 ring-danger-500 bg-danger-50/10 text-danger-900"
              : "border-dashed border-line bg-surface-muted hover:border-brand-300 text-ink-500"
          } px-3 py-2.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white ${
            className ?? ""
          }`}
          {...props}
        />
      )}
    </Field>
  );
}
