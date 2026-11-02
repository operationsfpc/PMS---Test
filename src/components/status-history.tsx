import { QuotedText } from "@components/quoted-text";
import { Badge, Card } from "@components/ui";
import type { StatusEvent } from "@domain/status-changes";
import { Clock, History, ShieldAlert, UserCheck } from "lucide-react";

/**
 * The two ledgers 0133 and 0134 write, drawn once for whoever is allowed to
 * read them.
 *
 * The staff record and the student's own screen show the same lines because
 * they are the same lines: a coordinator returning a student to the pipeline
 * promised a reason, and the only honest version of that promise is the
 * student being able to read it back. Nothing here decides who may see it —
 * RLS does, and the view throws when the read is refused, which is the alert
 * rather than an empty list pretending nothing happened.
 */

/** Asia/Kolkata, because that is where everyone reading this is. */
const onDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function eventNodeStyle(tone?: string) {
  switch (tone) {
    case "warning":
      return {
        bg: "bg-amber-50 text-amber-800 border-amber-200/80",
        icon: <Clock className="size-3.5 text-amber-700" aria-hidden="true" />,
        dot: "bg-amber-500",
      };
    case "danger":
      return {
        bg: "bg-rose-50 text-rose-800 border-rose-200/80",
        icon: <ShieldAlert className="size-3.5 text-rose-700" aria-hidden="true" />,
        dot: "bg-rose-500",
      };
    default:
      return {
        bg: "bg-emerald-50 text-emerald-800 border-emerald-200/80",
        icon: <UserCheck className="size-3.5 text-emerald-700" aria-hidden="true" />,
        dot: "bg-emerald-500",
      };
  }
}

export function StatusHistory({
  events,
  problem = null,
  subject,
  subtitle = "Every time someone moved this standing, with the reason they gave",
  className = "mb-4",
}: {
  events: readonly StatusEvent[];
  /** The sentence the read threw, said here rather than one card away. */
  problem?: string | null;
  /** Whose standing these moves were made on, so the popup says what opens. */
  subject?: string;
  subtitle?: string;
  className?: string;
}) {
  if (events.length === 0 && problem === null) return null;

  return (
    <section aria-label="Status history" className={className}>
      <Card className="rounded-2xl border border-line/70 p-5 shadow-xs sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100/60 text-brand-700 shadow-2xs">
              <History aria-hidden="true" className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-lg font-bold text-ink-900">Status history</h2>
                <span className="hidden rounded-full bg-brand-100/80 px-2 py-0.5 text-[10px] font-semibold text-brand-800 sm:inline-block">
                  Ledger
                </span>
              </div>
              <p className="text-xs text-ink-500">{subtitle}</p>
            </div>
          </div>
          {events.length > 0 && (
            <Badge tone="neutral" className="rounded-full">
              {events.length} record{events.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {problem !== null && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700 shadow-2xs"
          >
            {problem}
          </p>
        )}

        {events.length > 0 && (
          <ul className="mt-4 space-y-3.5">
            {events.map((event) => {
              const style = eventNodeStyle(event.tone);
              return (
                <li
                  key={event.id}
                  className="rounded-xl border border-line/60 bg-surface-muted/40 p-4 transition-all hover:border-line hover:bg-surface hover:shadow-2xs"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${style.bg}`}
                    >
                      {style.icon}
                      <h3 className="font-heading text-xs font-bold">{event.title}</h3>
                    </span>
                    <span
                      className={`min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere] ${
                        event.tone === "warning" ? "text-amber-800" : "text-ink-800"
                      }`}
                    >
                      {event.detail}
                    </span>
                  </div>

                  <p className="mt-1 break-words text-xs text-ink-500 [overflow-wrap:anywhere]">
                    by {event.byName ?? "name not recorded"} · {onDate(event.at)}
                  </p>

                  {event.reason.trim() !== "" && (
                    <div className="mt-2.5 rounded-lg border border-line/60 bg-surface p-3">
                      <QuotedText
                        text={event.reason}
                        title={`${event.title} — the reason given`}
                        {...(subject === undefined ? {} : { subject })}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
