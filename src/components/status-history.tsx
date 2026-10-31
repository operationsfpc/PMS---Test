import { QuotedText } from "@components/quoted-text";
import { Badge, Card } from "@components/ui";
import type { StatusEvent } from "@domain/status-changes";
import { History } from "lucide-react";

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
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-surface-muted p-2 text-ink-700">
              <History aria-hidden="true" className="size-5" />
            </div>
            <div>
              <h2 className="font-heading text-lg font-bold text-ink-900">Status history</h2>
              <p className="text-xs text-ink-500">{subtitle}</p>
            </div>
          </div>
          {events.length > 0 && (
            <Badge tone="neutral">
              {events.length} record{events.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {problem !== null && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {problem}
          </p>
        )}

        {events.length > 0 && (
          <ul className="mt-3 divide-y divide-line">
            {events.map((event) => (
              <li key={event.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 className="font-heading text-sm font-bold text-ink-900">{event.title}</h3>
                  <span
                    className={`min-w-0 break-words text-sm [overflow-wrap:anywhere] ${
                      event.tone === "warning" ? "text-gold-700" : "text-ink-700"
                    }`}
                  >
                    {event.detail}
                  </span>
                </div>
                <p className="mt-0.5 break-words text-xs text-ink-500 [overflow-wrap:anywhere]">
                  by {event.byName ?? "name not recorded"} · {onDate(event.at)}
                </p>
                {event.reason.trim() !== "" && (
                  <QuotedText
                    text={event.reason}
                    title={`${event.title} — the reason given`}
                    {...(subject === undefined ? {} : { subject })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
