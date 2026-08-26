import { Badge, Button, Card, PageHeader } from "@components/ui";
import { type CompletionReadiness, decideCompletion } from "@domain/drive-completion";
import {
  buildMeetingSlotsTemplate,
  matchMeetingSlots,
  parseMeetingSlotsCsv,
  type SlotAssignment,
} from "@domain/meeting-slots";
import { describeRoundFreeze, type RoundFacts } from "@domain/round-editing";
import { ROUND_MODES, roundLocationKind, roundModeLabel } from "@domain/round-mode";
import { describeParticipantOutcome } from "@domain/round-outcome";
import { advancedBeyond, advancingParticipants, roundDetailsFrozen } from "@domain/rounds";
import type { AttendanceStatus, RoundResult } from "@domain/types";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

export interface RoundParticipant {
  readonly applicationId: string;
  readonly studentName: string;
  readonly rollNumber: string;
  readonly attendance: AttendanceStatus;
  readonly result: RoundResult | null;
  /** F5 (UAT 2026-08-19): this student's own link and slot, when one is set. */
  readonly meetingLink?: string | null;
  readonly participantScheduledAt?: string | null;
}

export interface ResultsView {
  participants(roundId: string): Promise<readonly RoundParticipant[]>;
  record(roundId: string, applicationId: string, result: RoundResult): Promise<void>;
}

export interface DriveRoundInfo {
  readonly roundId: string;
  readonly sequence: number;
  readonly name: string;
  /** F4 (UAT 2026-08-19): the round's own details, editable after creation. */
  readonly mode: string | null;
  readonly scheduledAt: string | null;
  readonly interviewLink: string | null;
  /** G6b (UAT 2026-08-20): a physical round's address — not a URL. */
  readonly venue: string | null;
}

export interface RoundDetailsUpdate {
  readonly mode: string | null;
  readonly scheduledAt: string | null;
  readonly interviewLink: string | null;
  readonly venue: string | null;
}

/**
 * 2026-08-12 (approved spec, WS6): the whole drive's rounds on one screen.
 * The Central CPC records on behalf of the recruiter (D8); advancement is an
 * explicit act, never a side effect of the last result typed.
 */
export interface DriveRoundsView extends ResultsView {
  rounds(driveId: string): Promise<readonly DriveRoundInfo[]>;
  /**
   * Schedules the current round's `selected` into the next. Returns how many.
   * F3: an optional proof of the company's instruction travels with it.
   */
  advance(fromRoundId: string, toRoundId: string, proof?: File | null): Promise<number>;
  addRound(driveId: string, name: string): Promise<void>;
  /** F4: mode, time and shared link — editable after creation. */
  updateRound(roundId: string, details: RoundDetailsUpdate): Promise<void>;
  /**
   * F5: the per-student slots, already matched to applications by the domain
   * against the roster this screen is showing (UAT 2026-08-26). The view
   * writes them and reports back any the database did not accept — it no
   * longer re-decides who is in the round.
   */
  assignSlots(
    roundId: string,
    assignments: readonly SlotAssignment[],
  ): Promise<{ matched: number; unmatched: readonly string[] }>;
  /** F5: one student's own link and slot. */
  setParticipantSlot(
    roundId: string,
    applicationId: string,
    meetingLink: string | null,
    scheduledAt: string | null,
  ): Promise<void>;
  /** B2 (2026-08-21): each round's recorded facts — what freezes it. */
  roundFacts(driveId: string): Promise<ReadonlyMap<string, RoundFacts>>;
  renameRound(roundId: string, name: string): Promise<void>;
  /** Removes the round and renumbers the survivors to close the gap. */
  removeRound(driveId: string, roundId: string): Promise<void>;
  /**
   * 2026-08-26: the applications on this drive holding a DECLARED offer.
   *
   * Asked of the drive rather than the round: an offer belongs to the drive,
   * and the final round — the one where offers happen — has no later round for
   * F1's lock to key on.
   */
  offerHolders(driveId: string): Promise<ReadonlySet<string>>;
  /** C3: how close the drive is to done — feeds the completion dialog. */
  completionFacts(driveId: string): Promise<CompletionReadiness>;
  /** C3 (answer 3b): `reason` is null on an ordinary, fully-decided completion. */
  completeDrive(driveId: string, reason: string | null): Promise<void>;
}

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
  offered = EMPTY_LOCK,
  saveSlot,
  onRecorded,
}: {
  roundId: string;
  view: ResultsView;
  /**
   * F1 (UAT 2026-08-19): applications already sitting in a LATER round. Their
   * result here is history — rendered, never re-editable. Progression is
   * strictly linear.
   */
  locked?: ReadonlySet<string>;
  /**
   * 2026-08-26: applications holding a DECLARED OFFER. The final round has no
   * later round, so `locked` never covered the one row that must not be
   * re-decided — the student who has been offered the job.
   */
  offered?: ReadonlySet<string>;
  /** F5: when given, each row offers the student's own meeting link. */
  saveSlot?: (applicationId: string, meetingLink: string) => Promise<void>;
  /**
   * UAT 2026-08-21 ("Advance button stuck until F5"): fires after results
   * land, so an embedding screen can re-read the state IT derives from them
   * — the parent rounds page arms its Advance button from its own copy of
   * the participants, which this page's writes would otherwise never touch.
   */
  onRecorded?: () => void | Promise<void>;
}) {
  const [participants, setParticipants] = useState<readonly RoundParticipant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * M2 (approved 2026-08-21): results are recorded in BULK — checkboxes, a
   * bottom action bar, and one confirmation for the whole batch. F2's rule
   * survives it: `selected` and `rejected` notify the students the moment
   * they land (0043's trigger), so those two ask first; `on_hold` is an
   * interim state and records quietly.
   */
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<RoundResult | null>(null);

  const refresh = useCallback(async () => {
    setParticipants(await view.participants(roundId));
  }, [view, roundId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function recordChecked(result: RoundResult) {
    setError(null);
    try {
      // Sequential on purpose: each write notifies a student, and a pile of
      // parallel failures produces one unreadable error.
      for (const applicationId of checked) {
        await view.record(roundId, applicationId, result);
      }
      setChecked(new Set());
      await refresh();
      await onRecorded?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the results.");
      // The sequential loop may have landed SOME results before failing —
      // the embedder's derived state must see those too.
      await refresh();
      await onRecorded?.();
    }
  }

  function requestRecord(result: RoundResult) {
    if (result === "selected" || result === "rejected") {
      setPending(result);
      return;
    }
    void recordChecked(result);
  }

  function toggle(applicationId: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(applicationId)) next.delete(applicationId);
      else next.add(applicationId);
      return next;
    });
  }

  /** One decision per row: what it says, and whether it may still be changed. */
  const outcomeOf = (participant: RoundParticipant) =>
    describeParticipantOutcome({
      result: participant.result,
      advanced: locked.has(participant.applicationId),
      offerDeclared: offered.has(participant.applicationId),
    });

  /** The rows a result can still be recorded FOR: undecided and still open. */
  const undecided = (participants ?? []).filter((p) => p.result === null && outcomeOf(p).editable);

  const checkedNames = (participants ?? [])
    .filter((p) => checked.has(p.applicationId))
    .map((p) => p.studentName);

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
        <>
          <div className="mb-2 flex flex-wrap items-center gap-4 text-sm">
            <button
              type="button"
              onClick={() => setChecked(new Set(undecided.map((p) => p.applicationId)))}
              className="font-medium text-brand-600 hover:underline"
            >
              Select all undecided
            </button>
            <button
              type="button"
              onClick={() => setChecked(new Set())}
              className="font-medium text-brand-600 hover:underline"
            >
              Clear
            </button>
            <span className="text-ink-500">
              {checked.size} selected of {undecided.length} undecided
            </span>
          </div>

          <Card>
            <ul className="divide-y divide-neutral-200">
              {participants.map((participant) => {
                const outcome = outcomeOf(participant);
                return (
                  <li
                    key={participant.applicationId}
                    className="flex flex-wrap items-center justify-between gap-4 p-4"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      {/* Decided rows keep their checkbox — the old select
                        allowed corrections, and the bulk bar must too. A row
                        closed by an advance or an offer does not. */}
                      {outcome.editable && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${participant.studentName}`}
                          checked={checked.has(participant.applicationId)}
                          onChange={() => toggle(participant.applicationId)}
                          className="mt-1 size-4 accent-[#3D3777]"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{participant.studentName}</p>
                        <p className="text-sm text-ink-500">{participant.rollNumber}</p>
                        {saveSlot !== undefined && (
                          <SlotEditor participant={participant} saveSlot={saveSlot} />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge tone={participant.attendance === "absent" ? "danger" : "neutral"}>
                        {label(participant.attendance)}
                      </Badge>

                      {/* F1's "(advanced)" and 2026-08-26's "Offer declared"
                        are the same decision, made once in the domain. */}
                      <span className="text-sm font-medium text-ink-700">
                        {outcome.label}
                        {outcome.note !== null && (
                          <span className="font-normal text-ink-500"> ({outcome.note})</span>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* M2: the bottom action bar — the ONE place results are recorded. */}
          <div className="sticky bottom-2 mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-brand-600 p-3 text-white shadow-lg">
            <span className="text-sm font-semibold">{checked.size} selected</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={checked.size === 0}
              onClick={() => requestRecord("selected")}
            >
              Mark Selected
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={checked.size === 0}
              onClick={() => requestRecord("rejected")}
            >
              Mark Rejected
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={checked.size === 0}
              onClick={() => requestRecord("on_hold")}
            >
              Mark On hold
            </Button>
          </div>
        </>
      )}

      {pending !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="alertdialog"
            aria-label="Confirm results"
            className="w-full max-w-md rounded-card bg-white p-6 shadow-xl"
          >
            <h2 className="font-heading text-lg font-bold text-ink-900">
              Mark {checked.size} {checked.size === 1 ? "student" : "students"} as{" "}
              <span className="capitalize">{label(pending)}</span>?
            </h2>
            <p className="mt-2 text-sm text-ink-700">
              <strong>{checkedNames.join(", ")}</strong> will be recorded as{" "}
              <strong className="capitalize">{label(pending)}</strong> in this round and{" "}
              <strong>notified immediately</strong>.
              {pending === "selected" && " Advancing them later schedules the next round."}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const request = pending;
                  setPending(null);
                  if (request !== null) void recordChecked(request);
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

/**
 * F5 (UAT 2026-08-19): one student's own meeting link, edited in their row.
 * The bulk CSV covers the recruiter's spreadsheet; this covers the one link
 * that arrived by WhatsApp at 9pm.
 */
function SlotEditor({
  participant,
  saveSlot,
}: {
  participant: RoundParticipant;
  saveSlot: (applicationId: string, meetingLink: string) => Promise<void>;
}) {
  const [link, setLink] = useState(participant.meetingLink ?? "");
  const [saved, setSaved] = useState(false);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="url"
        aria-label={`Meeting link for ${participant.studentName}`}
        placeholder="https://…"
        value={link}
        onChange={(e) => {
          setSaved(false);
          setLink(e.target.value);
        }}
        className="w-64 rounded-lg border border-line px-2 py-1 text-xs text-ink-900"
      />
      <button
        type="button"
        onClick={() => {
          // Promise.resolve: a test double may return undefined, and a crash
          // in a click handler is a silent one.
          void Promise.resolve(saveSlot(participant.applicationId, link.trim())).then(() =>
            setSaved(true),
          );
        }}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        Save link
      </button>
      {saved && <span className="text-xs text-success-700">✓ Saved</span>}
    </div>
  );
}

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
/** Real downloads go through a Blob; tests hand in a spy. */
function browserDownload(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DriveRoundsPage({
  driveId,
  view,
  download = browserDownload,
}: {
  driveId: string;
  view: DriveRoundsView;
  download?: (filename: string, text: string) => void;
}) {
  const [rounds, setRounds] = useState<readonly DriveRoundInfo[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [participants, setParticipants] = useState<readonly RoundParticipant[] | null>(null);
  /** F1: applications sitting in any round after the active one. */
  const [locked, setLocked] = useState<ReadonlySet<string>>(EMPTY_LOCK);
  /** 2026-08-26: applications on this drive that already hold an offer. */
  const [offered, setOffered] = useState<ReadonlySet<string>>(EMPTY_LOCK);
  const [adding, setAdding] = useState(false);
  const [roundName, setRoundName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Remounts the embedded ResultsPage when the world changes underneath it. */
  const [reloadKey, setReloadKey] = useState(0);
  /** F4: the details panel, opened per round. */
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<RoundDetailsUpdate>({
    mode: null,
    scheduledAt: null,
    interviewLink: null,
    venue: null,
  });
  /** F3: the advance waits behind a confirmation carrying the optional proof. */
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [proof, setProof] = useState<File | null>(null);
  /** B2 (M2, 2026-08-21): the manage-rounds dialog and its per-round facts. */
  const [managing, setManaging] = useState(false);
  const [facts, setFacts] = useState<ReadonlyMap<string, RoundFacts>>(new Map());
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<DriveRoundInfo | null>(null);
  /** C3 (answer 3b): the completion dialog, its readiness and typed reason. */
  const [completing, setCompleting] = useState<CompletionReadiness | null>(null);
  const [completionReason, setCompletionReason] = useState("");
  const [completionError, setCompletionError] = useState<string | null>(null);

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

    // Asked on the same beat as the participants: a row closed by an offer
    // must not re-open for the instant between two loads.
    setOffered(await view.offerHolders(driveId));
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
  }, [view, active, rounds, driveId]);

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
      const moved = await view.advance(activeRound.roundId, nextRound.roundId, proof);
      setNotice(
        `${moved} ${moved === 1 ? "student" : "students"} scheduled for Round ${nextRound.sequence} (${nextRound.name}).`,
      );
      setProof(null);
      // Re-read the world instead of arguing with it (the F5 bug).
      await loadParticipants();
      setReloadKey((k) => k + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not advance the students.");
    }
  }

  /**
   * G6c (UAT 2026-08-20, Q5 answer a): the active round's details freeze the
   * moment participation is a recorded fact. The domain owns the boundary;
   * 0055's trigger enforces the same rule server-side.
   */
  const detailsFrozen = roundDetailsFrozen(participants ?? []);

  function openDetails() {
    if (activeRound === null) return;
    setDetailsDraft({
      mode: activeRound.mode,
      scheduledAt: activeRound.scheduledAt,
      interviewLink: activeRound.interviewLink,
      venue: activeRound.venue,
    });
    setEditingDetails(true);
  }

  async function saveDetails() {
    if (activeRound === null) return;
    setError(null);
    try {
      await view.updateRound(activeRound.roundId, detailsDraft);
      setEditingDetails(false);
      setNotice("Round details saved. Participating students are notified.");
      await loadRounds();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the round details.");
    }
  }

  /**
   * F5: the recruiter's spreadsheet of per-student links, judged by the domain.
   *
   * UAT 2026-08-26 (live): the upload said no participant carried roll numbers
   * that were printed on the screen underneath it. Matching now happens HERE,
   * against `participants` — the very list being rendered — so the screen and
   * the matcher cannot disagree again.
   */
  async function uploadSlots(file: File) {
    if (activeRound === null) return;
    setError(null);
    setNotice(null);
    const { slots, problems } = parseMeetingSlotsCsv(await file.text());
    if (problems.length > 0) {
      setError(problems.join(" "));
      return;
    }

    const { assignments, unmatched } = matchMeetingSlots(slots, participants ?? []);
    const missing = (names: readonly string[]) =>
      `No participant in this round carries these roll numbers: ${names.join(", ")}.`;

    // Nothing to send: say so without troubling the server, and point at the
    // template — the file that cannot mismatch.
    if (assignments.length === 0) {
      setError(
        `${missing(unmatched)} Download the template to get this round's roll numbers exactly as they are recorded.`,
      );
      return;
    }

    try {
      const { matched, unmatched: rejected } = await view.assignSlots(
        activeRound.roundId,
        assignments,
      );
      const notAssigned = [...unmatched, ...rejected];
      if (notAssigned.length > 0) {
        setError(
          `${missing(notAssigned)} ${matched} ${matched === 1 ? "link" : "links"} assigned.`,
        );
      } else {
        setNotice(`${matched} ${matched === 1 ? "link" : "links"} assigned and notified.`);
      }
      setReloadKey((k) => k + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not assign the links.");
    }
  }

  /**
   * The template is THIS round's roster, not an invented sample: download,
   * type the links into column B, upload back. A roll-number mismatch becomes
   * impossible because the roll numbers came from the round itself.
   */
  function downloadSlotsTemplate() {
    const round = activeRound;
    if (round === null) return;
    download(
      `round-${round.sequence}-meeting-links.csv`,
      buildMeetingSlotsTemplate(
        (participants ?? []).map((participant) => ({
          rollNumber: participant.rollNumber,
          meetingLink: participant.meetingLink ?? null,
          scheduledAt: participant.participantScheduledAt ?? null,
        })),
      ),
    );
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

  async function openManage() {
    setError(null);
    try {
      setFacts(await view.roundFacts(driveId));
      setRenames(Object.fromEntries((rounds ?? []).map((r) => [r.roundId, r.name])));
      setManaging(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the rounds' facts.");
    }
  }

  async function saveRename(round: DriveRoundInfo) {
    const name = (renames[round.roundId] ?? "").trim();
    if (name === "" || name === round.name) return;
    setError(null);
    try {
      await view.renameRound(round.roundId, name);
      setNotice(`Round ${round.sequence} renamed to “${name}”.`);
      await loadRounds();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename the round.");
    }
  }

  async function confirmRemove() {
    if (removing === null) return;
    setError(null);
    try {
      await view.removeRound(driveId, removing.roundId);
      setNotice(`Round ${removing.sequence} (${removing.name}) removed. Rounds renumbered.`);
      setRemoving(null);
      setManaging(false);
      setActive(null);
      await loadRounds();
      setReloadKey((k) => k + 1);
    } catch (cause) {
      setRemoving(null);
      setError(cause instanceof Error ? cause.message : "Could not remove the round.");
    }
  }

  async function openCompletion() {
    setError(null);
    setCompletionReason("");
    setCompletionError(null);
    try {
      setCompleting(await view.completionFacts(driveId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the drive's progress.");
    }
  }

  async function confirmCompletion() {
    if (completing === null) return;
    // The domain judges the reason — 3b: early completion demands one.
    const decision = decideCompletion(completing, completionReason);
    if (!decision.allowed) {
      setCompletionError(decision.reason);
      return;
    }
    try {
      await view.completeDrive(driveId, completing.ready ? null : completionReason.trim());
      setCompleting(null);
      setNotice("Drive marked completed. It now appears under Drives → Completed.");
    } catch (cause) {
      setCompletionError(cause instanceof Error ? cause.message : "Could not complete the drive.");
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

        <span className="ml-auto flex gap-2">
          {/* B2: rename or knock off rounds the company dropped. */}
          <Button size="sm" variant="secondary" onClick={() => void openManage()}>
            Manage rounds…
          </Button>
          {/* C3: the drive is done when every applicant has an outcome. */}
          <Button size="sm" variant="secondary" onClick={() => void openCompletion()}>
            Mark drive completed…
          </Button>
        </span>
      </div>

      {active !== null && activeRound !== null && (
        <>
          {/* F4 (UAT 2026-08-19): the round's own details — shown, and
              editable AFTER creation, which is when the company finally says. */}
          <Card className="mb-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-700">
                <strong>Round {activeRound.sequence} details:</strong>{" "}
                {roundModeLabel(activeRound.mode)}
                {activeRound.scheduledAt !== null &&
                  ` · ${new Date(activeRound.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}`}
                {activeRound.venue !== null && ` · at ${activeRound.venue}`}
                {activeRound.interviewLink !== null && " · shared link set"}
              </p>
              {detailsFrozen ? (
                // G6c: a closed process is not edited. The lock is stated, not
                // silent — a vanished button reads as a defect, not a rule.
                <p className="text-xs font-medium text-ink-500">
                  Round details are locked — students have begun participating in this round.
                </p>
              ) : (
                !editingDetails && (
                  <Button variant="secondary" size="sm" onClick={openDetails}>
                    Edit round details
                  </Button>
                )
              )}
            </div>

            {editingDetails && !detailsFrozen && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
                  Round mode
                  <select
                    value={detailsDraft.mode ?? ""}
                    onChange={(e) => {
                      const mode = e.target.value === "" ? null : e.target.value;
                      // G6b: the mode decides WHICH location field exists. The
                      // abandoned one is cleared, not merely hidden — a hidden
                      // field still submits (the J2 lesson).
                      setDetailsDraft((d) =>
                        roundLocationKind(mode) === "venue"
                          ? { ...d, mode, interviewLink: null }
                          : { ...d, mode, venue: null },
                      );
                    }}
                    className="rounded-lg border border-line px-2 py-2 text-sm text-ink-900"
                  >
                    <option value="">Not set</option>
                    {ROUND_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {roundModeLabel(mode)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
                  Scheduled at (IST)
                  <input
                    type="datetime-local"
                    value={detailsDraft.scheduledAt ?? ""}
                    onChange={(e) =>
                      setDetailsDraft((d) => ({
                        ...d,
                        scheduledAt: e.target.value === "" ? null : e.target.value,
                      }))
                    }
                    className="rounded-lg border border-line px-2 py-2 text-sm text-ink-900"
                  />
                </label>
                {roundLocationKind(detailsDraft.mode) === "venue" ? (
                  // G6b: a physical round happens at an ADDRESS. Offering a URL
                  // box forced coordinators to lie to it.
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
                    Venue (address)
                    <input
                      type="text"
                      placeholder="Building, street, city…"
                      value={detailsDraft.venue ?? ""}
                      onChange={(e) =>
                        setDetailsDraft((d) => ({
                          ...d,
                          venue: e.target.value === "" ? null : e.target.value,
                        }))
                      }
                      className="rounded-lg border border-line px-2 py-2 text-sm text-ink-900"
                    />
                  </label>
                ) : (
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
                    Shared interview link
                    <input
                      type="url"
                      placeholder="https://…"
                      value={detailsDraft.interviewLink ?? ""}
                      onChange={(e) =>
                        setDetailsDraft((d) => ({
                          ...d,
                          interviewLink: e.target.value === "" ? null : e.target.value,
                        }))
                      }
                      className="rounded-lg border border-line px-2 py-2 text-sm text-ink-900"
                    />
                  </label>
                )}

                <div className="sm:col-span-3 flex flex-wrap items-end justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
                      Upload per-student links (CSV: roll_number,meeting_link,scheduled_at)
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file !== undefined) void uploadSlots(file);
                          e.target.value = "";
                        }}
                        className="text-sm"
                      />
                    </label>
                    {/* UAT 2026-08-26: "there's no sample to reference". This
                        one is better than a sample — it is this round's own
                        roll numbers, so a filled-in template always matches. */}
                    <span className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={downloadSlotsTemplate}>
                        Download CSV template
                      </Button>
                      <span className="text-xs text-ink-500">
                        Pre-filled with this round&rsquo;s {(participants ?? []).length}{" "}
                        {(participants ?? []).length === 1 ? "student" : "students"} — add a link
                        against each roll number and upload it back.
                      </span>
                    </span>
                  </div>
                  <span className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditingDetails(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void saveDetails()}>
                      Save round details
                    </Button>
                  </span>
                </div>
              </div>
            )}
          </Card>

          <ResultsPage
            key={`${active}-${reloadKey}`}
            roundId={active}
            view={view}
            locked={locked}
            offered={offered}
            onRecorded={loadParticipants}
            saveSlot={(applicationId, meetingLink) =>
              view.setParticipantSlot(
                activeRound.roundId,
                applicationId,
                meetingLink === "" ? null : meetingLink,
                null,
              )
            }
          />
          <div className="mt-4">
            {nextRound !== null ? (
              advancing > 0 ? (
                <Button onClick={() => setAdvanceOpen(true)}>
                  Advance {advancing} selected to Round {nextRound.sequence} — schedules them
                </Button>
              ) : (
                // G6a (UAT 2026-08-20): "No Advance to Round 2 button
                // available." It only appeared once someone was Selected, so a
                // fresh round showed nothing and the feature read as missing.
                // It stands disabled now, with the instruction that arms it.
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled>Advance to Round {nextRound.sequence}</Button>
                  <p className="text-sm text-ink-500">
                    Mark students as <strong>Selected</strong> first — only selected students
                    advance to the next round.
                  </p>
                </div>
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

          {/* F3 (UAT 2026-08-19): the advance asks first, and the company's
              own instruction — a mail, a screenshot — can travel with it. */}
          {advanceOpen && nextRound !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div
                role="alertdialog"
                aria-label="Confirm advancing"
                className="w-full max-w-md rounded-card bg-white p-6 shadow-xl"
              >
                <h2 className="font-heading text-lg font-bold text-ink-900">
                  Advance {advancing} to Round {nextRound.sequence}?
                </h2>
                <p className="mt-2 text-sm text-ink-700">
                  {advancing} {advancing === 1 ? "student" : "students"} marked{" "}
                  <strong>selected</strong> will be scheduled for Round {nextRound.sequence} (
                  {nextRound.name}). Once advanced, their result in this round is final.
                </p>
                <div className="mt-4">
                  <label
                    htmlFor="advance-proof"
                    className="mb-1 block text-xs font-medium text-ink-500"
                  >
                    Proof of company communication (PDF or image, optional)
                  </label>
                  <input
                    id="advance-proof"
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                    className="text-sm"
                  />
                  {proof !== null && (
                    <p className="mt-1 text-xs text-ink-700">Attached: {proof.name}</p>
                  )}
                </div>
                <div className="mt-5 flex justify-end gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAdvanceOpen(false);
                      setProof(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      setAdvanceOpen(false);
                      void advance();
                    }}
                  >
                    Confirm — advance and schedule
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* B2 (M2): rename or remove rounds — frozen ones say why they refuse. */}
      {managing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-label="Manage rounds"
            className="w-full max-w-lg rounded-card bg-white p-6 shadow-xl"
          >
            <h2 className="font-heading text-lg font-bold text-ink-900">Manage rounds</h2>
            <p className="mt-1 text-sm text-ink-500">
              Rename or remove rounds the company has dropped. A round with recorded attendance or
              results is frozen — history is not edited.
            </p>

            <ul className="mt-4 divide-y divide-neutral-200">
              {(rounds ?? []).map((round) => {
                const freeze = describeRoundFreeze(
                  facts.get(round.roundId) ?? {
                    hasParticipants: false,
                    hasAttendance: false,
                    hasResults: false,
                  },
                );
                return (
                  <li
                    key={round.roundId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    {freeze !== null ? (
                      <>
                        <span className="text-sm font-medium text-ink-900">
                          Round {round.sequence} · {round.name}
                        </span>
                        <span className="text-xs text-ink-500">{freeze}</span>
                      </>
                    ) : (
                      <>
                        <label className="flex items-center gap-2 text-sm">
                          <span className="font-medium text-ink-900">Round {round.sequence} ·</span>
                          <input
                            type="text"
                            aria-label={`Rename round ${round.sequence}`}
                            value={renames[round.roundId] ?? round.name}
                            onChange={(e) =>
                              setRenames((r) => ({ ...r, [round.roundId]: e.target.value }))
                            }
                            className="rounded-lg border border-line px-2 py-1.5 text-sm"
                          />
                        </label>
                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void saveRename(round)}
                          >
                            Save name
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`Remove round ${round.sequence}`}
                            onClick={() => setRemoving(round)}
                          >
                            Remove
                          </Button>
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 flex justify-end">
              <Button variant="secondary" onClick={() => setManaging(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {removing !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div
            role="alertdialog"
            aria-label="Remove round"
            className="w-full max-w-md rounded-card bg-white p-6 shadow-xl"
          >
            <h2 className="font-heading text-lg font-bold text-ink-900">
              Remove Round {removing.sequence} — {removing.name}?
            </h2>
            <p className="mt-2 text-sm text-ink-700">
              The remaining rounds renumber to close the gap. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button onClick={() => void confirmRemove()}>Remove round</Button>
            </div>
          </div>
        </div>
      )}

      {/* C3 (answer 3b): completing the drive, with the early-reason path. */}
      {completing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="alertdialog"
            aria-label="Complete drive"
            className="w-full max-w-md rounded-card bg-white p-6 shadow-xl"
          >
            <h2 className="font-heading text-lg font-bold text-ink-900">Mark drive completed?</h2>
            {completing.ready ? (
              <p className="mt-2 text-sm text-ink-700">
                Every applicant has a final outcome. The drive moves to Drives → Completed.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-ink-700">
                  {completing.undecided}{" "}
                  {completing.undecided === 1 ? "student still has" : "students still have"} no
                  final outcome. Completing now requires a reason — it is audit-logged.
                </p>
                <label
                  className="mt-3 block text-sm font-medium text-ink-900"
                  htmlFor="completion-reason"
                >
                  Reason
                </label>
                <input
                  id="completion-reason"
                  value={completionReason}
                  onChange={(e) => setCompletionReason(e.target.value)}
                  placeholder="e.g. Company closed the process after Round 2"
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              </>
            )}
            {completionError !== null && (
              <p role="status" className="mt-2 text-sm text-destructive">
                {completionError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setCompleting(null)}>
                Cancel
              </Button>
              <Button onClick={() => void confirmCompletion()}>Complete drive</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
