import { Badge, Card, PageHeader } from "@components/ui";
import { advancingParticipants } from "@domain/rounds";
import type { AttendanceStatus, RoundResult } from "@domain/types";
import { useCallback, useEffect, useState } from "react";

export interface RoundParticipant {
  readonly applicationId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly attendance: AttendanceStatus;
  readonly result: RoundResult | null;
}

export interface ResultsView {
  participants(roundId: string): Promise<readonly RoundParticipant[]>;
  record(roundId: string, applicationId: string, result: RoundResult): Promise<void>;
}

const RESULTS: readonly RoundResult[] = ["selected", "rejected", "waitlisted", "on_hold"];

const label = (value: string) => value.replaceAll("_", " ");

/**
 * A round's results.
 *
 * Q10: only `selected` advances. Waitlisted and on-hold students are not
 * scheduled for the next round until the Central CPC promotes them, so the
 * screen says so out loud - otherwise a coordinator reasonably assumes a
 * waitlist is a queue that drains by itself.
 */
export function ResultsPage({ roundId, view }: { roundId: string; view: ResultsView }) {
  const [participants, setParticipants] = useState<readonly RoundParticipant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setParticipants(await view.participants(roundId));
  }, [view, roundId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function record(applicationId: string, result: RoundResult) {
    setError(null);
    try {
      await view.record(roundId, applicationId, result);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the result.");
    }
  }

  const advancing =
    participants === null
      ? 0
      : advancingParticipants(
          participants
            .filter((p) => p.result !== null)
            .map((p) => ({ studentId: p.applicationId, result: p.result as RoundResult })),
        ).length;

  const hasHeld =
    participants?.some((p) => p.result === "waitlisted" || p.result === "on_hold") ?? false;

  return (
    <div>
      <PageHeader
        title="Round results"
        // exactOptionalPropertyTypes: the prop is omitted, not set to undefined.
        {...(participants === null
          ? {}
          : { subtitle: `${advancing} of ${participants.length} advance.` })}
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {hasHeld && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-ink-700">
          Waitlisted and on-hold students are not scheduled for the next round. Promote them to
          selected first.
        </p>
      )}

      {participants === null ? (
        <p role="status" className="text-sm text-ink-500">
          Loading participants…
        </p>
      ) : participants.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            Nobody has been scheduled for this round yet. Upload the recruiter's participant list
            first.
          </p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {participants.map((participant) => (
              <li
                key={participant.applicationId}
                className="flex flex-wrap items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{participant.studentName}</p>
                  <p className="text-sm text-ink-500">{participant.rollNumber}</p>
                </div>

                <div className="flex items-center gap-3">
                  <Badge tone={participant.attendance === "absent" ? "danger" : "neutral"}>
                    {label(participant.attendance)}
                  </Badge>

                  <select
                    aria-label={`Result for ${participant.studentName}`}
                    value={participant.result ?? ""}
                    onChange={(e) =>
                      void record(participant.applicationId, e.target.value as RoundResult)
                    }
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm capitalize"
                  >
                    <option value="" disabled>
                      Not recorded
                    </option>
                    {RESULTS.map((result) => (
                      <option key={result} value={result}>
                        {label(result)}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
