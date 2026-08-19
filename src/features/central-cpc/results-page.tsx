import { Badge, Button, Card, PageHeader } from "@components/ui";
import { advancedBeyond, advancingParticipants } from "@domain/rounds";
import type { AttendanceStatus, RoundResult } from "@domain/types";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

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

export interface DriveRoundInfo {
  readonly roundId: string;
  readonly sequence: number;
  readonly name: string;
}

/**
 * 2026-08-12 (approved spec, WS6): the whole drive's rounds on one screen.
 * The Central CPC records on behalf of the recruiter (D8); advancement is an
 * explicit act, never a side effect of the last result typed.
 */
export interface DriveRoundsView extends ResultsView {
  rounds(driveId: string): Promise<readonly DriveRoundInfo[]>;
  /** Schedules the current round's `selected` into the next. Returns how many. */
  advance(fromRoundId: string, toRoundId: string): Promise<number>;
  addRound(driveId: string, name: string): Promise<void>;
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
export function ResultsPage({
  roundId,
  view,
  locked = EMPTY_LOCK,
}: {
  roundId: string;
  view: ResultsView;
  /**
   * F1 (UAT 2026-08-19): applications already sitting in a LATER round. Their
   * result here is history — rendered, never re-editable. Progression is
   * strictly linear.
   */
  locked?: ReadonlySet<string>;
}) {
  const [participants, setParticipants] = useState<readonly RoundParticipant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * F2 (UAT 2026-08-19): `selected` and `rejected` notify the student the
   * moment they land (0043's trigger), so the screen asks first. Interim
   * states (waitlisted, on hold) are quiet and record directly.
   */
  const [pending, setPending] = useState<{
    applicationId: string;
    studentName: string;
    result: RoundResult;
  } | null>(null);

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

  function requestRecord(participant: RoundParticipant, result: RoundResult) {
    if (result === "selected" || result === "rejected") {
      setPending({
        applicationId: participant.applicationId,
        studentName: participant.studentName,
        result,
      });
      return;
    }
    void record(participant.applicationId, result);
  }

  const advancing = countAdvancing(participants);

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

                  {locked.has(participant.applicationId) ? (
                    // F1: they sit in a later round — this result is history.
                    <span className="text-sm font-medium capitalize text-ink-700">
                      {participant.result === null ? "—" : label(participant.result)}{" "}
                      <span className="font-normal text-ink-500">(advanced)</span>
                    </span>
                  ) : (
                    <select
                      aria-label={`Result for ${participant.studentName}`}
                      value={participant.result ?? ""}
                      onChange={(e) => requestRecord(participant, e.target.value as RoundResult)}
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
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pending !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="alertdialog"
            aria-label="Confirm result"
            className="w-full max-w-md rounded-card bg-white p-6 shadow-xl"
          >
            <h2 className="font-heading text-lg font-bold text-ink-900">
              Record {label(pending.result)}?
            </h2>
            <p className="mt-2 text-sm text-ink-700">
              <strong>{pending.studentName}</strong> will be recorded as{" "}
              <strong className="capitalize">{label(pending.result)}</strong> in this round and{" "}
              <strong>notified immediately</strong>.
              {pending.result === "selected" && " Advancing them later schedules the next round."}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const request = pending;
                  setPending(null);
                  if (request !== null) void record(request.applicationId, request.result);
                }}
              >
                Confirm — record and notify
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY_LOCK: ReadonlySet<string> = new Set();

function countAdvancing(participants: readonly RoundParticipant[] | null): number {
  if (participants === null) return 0;
  return advancingParticipants(
    participants
      .filter((p) => p.result !== null)
      .map((p) => ({ studentId: p.applicationId, result: p.result as RoundResult })),
  ).length;
}

/**
 * The drive's rounds as numbered tabs. Each round is the existing ResultsPage
 * section; what this adds is the SHAPE the client asked for on 2026-08-12:
 * numbered rounds, adding one, and pushing the selected into the next —
 * explicitly, so who advanced is a decision with an author, not a residue.
 */
export function DriveRoundsPage({ driveId, view }: { driveId: string; view: DriveRoundsView }) {
  const [rounds, setRounds] = useState<readonly DriveRoundInfo[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [participants, setParticipants] = useState<readonly RoundParticipant[] | null>(null);
  /** F1: applications sitting in any round after the active one. */
  const [locked, setLocked] = useState<ReadonlySet<string>>(EMPTY_LOCK);
  const [adding, setAdding] = useState(false);
  const [roundName, setRoundName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Remounts the embedded ResultsPage when the world changes underneath it. */
  const [reloadKey, setReloadKey] = useState(0);

  const loadRounds = useCallback(async () => {
    const loaded = await view.rounds(driveId);
    setRounds(loaded);
    setActive((current) => current ?? loaded[0]?.roundId ?? null);
  }, [view, driveId]);

  useEffect(() => {
    void loadRounds();
  }, [loadRounds]);

  /**
   * The active round's participants AND who has moved past it. Both reload
   * together — the UAT bug "advancing works once but fails on the second
   * attempt without a page refresh" was this screen never re-reading after it
   * wrote.
   */
  const loadParticipants = useCallback(async () => {
    if (active === null || rounds === null) return;
    const activeRound = rounds.find((r) => r.roundId === active);
    if (activeRound === undefined) return;

    setParticipants(null);
    const later = rounds.filter((r) => r.sequence > activeRound.sequence);
    const [own, ...beyond] = await Promise.all([
      view.participants(active),
      ...later.map((r) => view.participants(r.roundId)),
    ]);

    setParticipants(own ?? []);
    setLocked(
      advancedBeyond(
        activeRound.sequence,
        later.map((r, i) => ({
          sequence: r.sequence,
          applicationIds: (beyond[i] ?? []).map((p) => p.applicationId),
        })),
      ),
    );
  }, [view, active, rounds]);

  useEffect(() => {
    void loadParticipants();
  }, [loadParticipants]);

  const activeRound = (rounds ?? []).find((r) => r.roundId === active) ?? null;
  const nextRound =
    activeRound === null
      ? null
      : ((rounds ?? []).find((r) => r.sequence === activeRound.sequence + 1) ?? null);
  // F1: someone already advanced is never advanced a second time, so they do
  // not count towards the button either.
  const advancing = countAdvancing(
    participants === null ? null : participants.filter((p) => !locked.has(p.applicationId)),
  );

  async function advance() {
    if (activeRound === null || nextRound === null) return;
    setError(null);
    try {
      const moved = await view.advance(activeRound.roundId, nextRound.roundId);
      setNotice(
        `${moved} ${moved === 1 ? "student" : "students"} scheduled for Round ${nextRound.sequence} (${nextRound.name}).`,
      );
      // Re-read the world instead of arguing with it (the F5 bug).
      await loadParticipants();
      setReloadKey((k) => k + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not advance the students.");
    }
  }

  async function createRound() {
    const name = roundName.trim();
    if (name === "") return;
    setError(null);
    try {
      await view.addRound(driveId, name);
      setAdding(false);
      setRoundName("");
      await loadRounds();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the round.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Rounds & results"
        subtitle="You are recording on behalf of the recruiter. Every result you record is told to the student; advancing schedules them for the next round."
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {notice !== null && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-ink-900"
        >
          {notice}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(rounds ?? []).map((round) => (
          <button
            key={round.roundId}
            type="button"
            onClick={() => {
              setNotice(null);
              setActive(round.roundId);
            }}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              round.roundId === active
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-line bg-surface text-ink-700 hover:bg-surface-muted"
            }`}
          >
            Round {round.sequence} · {round.name}
          </button>
        ))}
        {adding ? (
          <span className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
              Round name
              <input
                type="text"
                value={roundName}
                onChange={(e) => setRoundName(e.target.value)}
                className="rounded-lg border border-line px-2 py-1.5 text-sm text-ink-900"
              />
            </label>
            <Button size="sm" onClick={() => void createRound()}>
              Create Round {(rounds?.length ?? 0) + 1}
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg border border-dashed border-line px-3 py-2 text-sm font-medium text-ink-500 hover:bg-surface-muted"
          >
            + Add round
          </button>
        )}
      </div>

      {active !== null && (
        <>
          <ResultsPage
            key={`${active}-${reloadKey}`}
            roundId={active}
            view={view}
            locked={locked}
          />
          <div className="mt-4">
            {nextRound !== null ? (
              advancing > 0 && (
                <Button onClick={() => void advance()}>
                  Advance {advancing} selected to Round {nextRound.sequence} — schedules them
                </Button>
              )
            ) : (
              <p className="text-sm text-ink-700">
                This is the final round. Declare offers on{" "}
                <Link
                  to={`/central/offers?drive=${driveId}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  Final selection
                </Link>
                .
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
