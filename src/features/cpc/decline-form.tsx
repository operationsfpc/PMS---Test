import { Button } from "@components/ui";
import { canDeclineParticipationRequest } from "@domain/participation";
import type { AppRole } from "@domain/types";
import { useState } from "react";

/**
 * Declining a request, with the reason that goes back to the student.
 * F1 (UAT 2026-08-06).
 *
 * The domain owns whether the reason is good enough, so this screen refuses
 * for the same reason the database does, and says the same words.
 *
 * There is deliberately no edit affordance anywhere near it: a coordinator
 * approves or declines what the student submitted, they do not rewrite it.
 */
export function DeclineForm({
  label,
  onDecline,
  onCancel,
}: {
  /** Names the row, so a queue of ten has ten distinct labels. */
  label: string;
  onDecline: (reason: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const id = `decline-reason-${label.replaceAll(/\W+/g, "-").toLowerCase()}`;

  function send() {
    // The actor's authority is checked again by the view and by RLS. Here the
    // question is only whether the REASON is one, which is what the
    // coordinator can still fix from this screen.
    const decision = canDeclineParticipationRequest(
      "central_placement_coordinator" satisfies AppRole,
      reason,
    );
    if (!decision.allowed) {
      setProblem(decision.reason);
      return;
    }
    setProblem(null);
    void onDecline(reason.trim());
  }

  return (
    <div className="w-full rounded-lg border border-danger-500/30 bg-danger-50 p-3">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-900">
        Why are you declining {label}?
      </label>
      <p className="mb-2 text-xs text-ink-700">
        The student is shown this, word for word. It is all they are told.
      </p>
      <textarea
        id={id}
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-lg border border-neutral-300 bg-surface px-3 py-2 text-sm"
      />
      {problem !== null && <p className="mt-1 text-xs font-medium text-danger-700">{problem}</p>}
      <div className="mt-2 flex gap-2">
        <Button variant="danger" size="sm" onClick={send}>
          Send decline
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The document behind a request.
 *
 * A coordinator approving evidence they cannot open is rubber-stamping, and
 * both of these decisions are irreversible in practice. The URL is signed and
 * short-lived (PRD §21.2), so it is minted per view rather than stored.
 */
export function Evidence({
  url,
  label,
  missing,
}: {
  url: string | null;
  label: string;
  missing: string;
}) {
  if (url === null) {
    return <p className="mt-1 text-xs text-danger-700">{missing}</p>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-block text-xs font-semibold text-brand-500 underline"
    >
      View {label}
    </a>
  );
}
