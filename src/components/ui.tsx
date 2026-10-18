import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { Link } from "react-router";

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
  // 2026-08-27: the violet accent, for the drive-type tag that is neither a
  // plain fact (neutral) nor a warning — "Internship → Full time".
  accent: "bg-violet-50 text-violet-700 border-violet-300",
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
  /*
   * The quiet one — for actions that matter less than the primary but are
   * still actions. It used to be brand-coloured text that underlined on hover,
   * which is the exact drawing of a hyperlink: staff read "Remove", "Add
   * another" and "Mark read" as navigation and stopped clicking them. A soft
   * filled block says control; a link says page.
   */
  ghost: "bg-brand-50 text-brand-700 hover:bg-brand-100",
} as const;

const DISABLED = "disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The two heights every control comes in, shared by the press and the
 * navigation below so a `View` button and a `View` link in one card are the
 * same size and cannot drift apart.
 */
const SIZING = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2.5 text-sm" } as const;

const SHAPE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors";

/**
 * The design system had no spinner, so eleven buttons spelled "Saving…" out by
 * hand and nine fired writes with nothing to stop a second click.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  isLoading = false,
  children,
  disabled,
  ...props
}: {
  variant?: keyof typeof VARIANTS;
  size?: "sm" | "md";
  isLoading?: boolean | undefined;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  // `||`, not `??`: a caller that passes `disabled={someGate}` for a state rule
  // must not switch OFF the loading guard. With `??` a gated button became
  // clickable again the moment it was spinning.
  const locked = disabled || isLoading;
  return (
    <button
      type="button"
      aria-busy={isLoading}
      disabled={locked}
      className={`${SHAPE} ${VARIANTS[variant]} ${SIZING[size]} ${DISABLED} ${className}`}
      {...props}
    >
      {isLoading && <Spinner />}
      {children}
    </button>
  );
}

/**
 * A way to open something, drawn as a control.
 *
 * `to=` changes nothing, so this stays a real `<Link>`: back button, open in a
 * new tab, the destination visible before the press. What it drops is the
 * underline — reported again on the 2026-10-18 UAT pass, where the cards on
 * every role's screen offered "View drive", "Open the drive record", "View
 * everything" and a company name in blue text, all as prose, and staff read
 * them as sentences rather than the way in.
 *
 * So: one word on every card — `View` — with the entity carried in the
 * accessible name the screen reader hears (`View Accenture — Jr. Software
 * Engineer`). Which card it opens is answered by the card, not by the button.
 */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: {
  variant?: keyof typeof VARIANTS;
  size?: "sm" | "md";
} & ComponentProps<typeof Link>) {
  return (
    <Link className={`${SHAPE} ${VARIANTS[variant]} ${SIZING[size]} ${className}`} {...props}>
      {children}
    </Link>
  );
}

/**
 * `ButtonLink` for the one thing it cannot do: hand the file to the browser.
 *
 * A resume, marksheet or offer letter leaves the app, so it stays an `<a href>`
 * and keeps the download/right-click it deserves — but the row's second
 * affordance is still a control, not a sentence. It is never called `View`:
 * that word belongs to the one link that opens the record, so this names its
 * object ("Resume", "Marksheet") and is quieter by default.
 */
export function ButtonAnchor({
  variant = "secondary",
  size = "sm",
  className = "",
  children,
  ...props
}: {
  variant?: keyof typeof VARIANTS;
  size?: "sm" | "md";
} & ComponentProps<"a">) {
  return (
    <a className={`${SHAPE} ${VARIANTS[variant]} ${SIZING[size]} ${className}`} {...props}>
      {children}
    </a>
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
  onClick,
  to,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
  /**
   * Opens the people behind the number (UAT 2026-10-16: "if it shows a count I
   * need to know who all is there"). Omitted, the card stays the plain figure
   * it always was.
   */
  onClick?: (() => void) | undefined;
  /**
   * Leads to a page instead of a popup. A count that navigates used to be a
   * `Card` wrapped in a `Link`, which draws an unclickable figure and only
   * works because the whole block happens to be an anchor. Same press, same
   * hint, real `href`.
   */
  to?: string | undefined;
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

  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1.5 font-heading text-2xl font-bold ${accent}`}>{value}</p>
      {hint !== undefined && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </>
  );

  if (onClick === undefined && to === undefined) {
    return <Card className="p-4">{body}</Card>;
  }

  const press = (
    <>
      {body}
      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 opacity-70 group-hover:opacity-100">
        See who
        <svg
          aria-hidden="true"
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </>
  );

  const shape =
    "group flex cursor-pointer flex-col rounded-card border border-line bg-surface p-4 text-left shadow-sm transition-all hover:border-brand-300 hover:shadow-md";

  return to === undefined ? (
    <button type="button" onClick={onClick} aria-haspopup="dialog" className={shape}>
      {press}
    </button>
  ) : (
    <Link to={to} className={shape}>
      {press}
    </Link>
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

// Re-export modern Shadcn primitives for convenient project-wide consumption
export * from "./accordion";
export * from "./alert-dialog";
export * from "./combobox";
export * from "./data-table";
export * from "./sheet";
export * from "./tabs";
export * from "./toast";
