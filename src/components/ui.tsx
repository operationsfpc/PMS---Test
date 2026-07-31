import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Shared presentation primitives. Brand-styled, light-mode, accessible. */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-line bg-surface shadow-sm ${className}`}>
      {children}
    </div>
  );
}

const TONES = {
  neutral: "bg-surface-muted text-ink-700 border-line",
  brand: "bg-brand-50 text-brand-600 border-brand-200",
  success: "bg-success-50 text-success-500 border-success-500/30",
  warning: "bg-gold-50 text-gold-700 border-gold-300",
  danger: "bg-danger-50 text-danger-700 border-danger-500/30",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const VARIANTS = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 shadow-sm",
  secondary: "bg-surface text-ink-700 border border-line hover:border-brand-300",
  gold: "bg-gold-500 text-brand-900 hover:bg-gold-600 shadow-sm",
  danger: "bg-surface text-danger-700 border border-danger-500/40 hover:bg-danger-50",
  ghost: "text-brand-500 hover:bg-brand-50",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: {
  variant?: keyof typeof VARIANTS;
  size?: "sm" | "md";
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizing = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm";
  return (
    <button
      type="button"
      className={`rounded-lg font-semibold transition-colors ${VARIANTS[variant]} ${sizing} ${className}`}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl text-ink-900">{title}</h1>
        {subtitle !== undefined && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
}) {
  const accent =
    tone === "brand"
      ? "text-brand-500"
      : tone === "success"
        ? "text-success-500"
        : tone === "danger"
          ? "text-danger-500"
          : tone === "warning"
            ? "text-gold-700"
            : "text-ink-900";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1.5 font-heading text-2xl font-bold ${accent}`}>{value}</p>
      {hint !== undefined && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </Card>
  );
}

export function DataTable({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
