import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";

/**
 * Form primitives, brand-styled and mobile-first.
 * Every control is label-associated — tests query by accessible name only.
 */

const controlClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[15px] " +
  "text-ink-900 placeholder:text-ink-300 transition-colors " +
  "hover:border-brand-300 focus:border-brand-500 focus:outline-none " +
  "focus:ring-2 focus:ring-violet-400/40 disabled:bg-surface-muted";

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string | undefined;
  required?: boolean | undefined;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-700">
        {label}
        {required === true && (
          <span className="ml-0.5 text-danger-500" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children(id)}
      {hint !== undefined && <p className="text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  hint,
  ...props
}: { label: string; hint?: string | undefined } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} required={props.required}>
      {(id) => <input id={id} className={controlClass} {...props} />}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  options,
  ...props
}: {
  label: string;
  hint?: string | undefined;
  options: readonly string[];
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} required={props.required}>
      {(id) => (
        <select id={id} className={controlClass} defaultValue="" {...props}>
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
  ...props
}: { label: string; hint?: string | undefined } & InputHTMLAttributes<HTMLInputElement>) {
  const withLimits = hint === undefined ? UPLOAD_LIMITS : `${hint} ${UPLOAD_LIMITS}`;

  return (
    <Field label={label} hint={withLimits} required={props.required}>
      {(id) => (
        <input
          id={id}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="w-full cursor-pointer rounded-lg border border-dashed border-line bg-surface-muted px-3 py-2.5 text-sm text-ink-500 file:mr-3 file:rounded-md file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:border-brand-300"
          {...props}
        />
      )}
    </Field>
  );
}
