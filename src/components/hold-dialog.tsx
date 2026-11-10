import { DrilldownModal } from "@components/drilldown-modal";
import { Button } from "@components/ui";
import { toYmd } from "@domain/drive-date-filter";
import { HOLD_ORDER_MAX_BYTES, type HoldDraft, holdDraftProblem } from "@domain/holds";
import type { HoldsView } from "@lib/holds-view";
import { useAsyncAction } from "@lib/use-async-action";
import { useState } from "react";

/** The student the hold is being placed on. */
export interface HoldTarget {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
}

/**
 * The Campus Manager's hold form (0125).
 *
 * Placing one closes every drive to the student and stops their notifications —
 * which is why the reason is mandatory and the review date is not a deadline:
 * the hold stays until someone releases it from the student's record. Nothing is
 * decided here that the database does not decide again: `place_student_hold`
 * refuses a manager outside the college, a student already held, and a window
 * that ends before it starts, and its sentence is what the manager reads back.
 */
export function HoldDialog({
  target,
  holds,
  onClose,
  onPlaced,
}: {
  target: HoldTarget;
  holds: HoldsView;
  onClose: () => void;
  /** Given back the target it was placed on, so the page can say who. */
  onPlaced: (student: HoldTarget) => void;
}) {
  const [draft, setDraft] = useState<HoldDraft>({
    kind: "pause",
    reason: "",
    startsAt: toYmd(new Date()),
    endsAt: "",
  });
  const [order, setOrder] = useState<File | null>(null);
  /** What is wrong with the draft, said once, next to the box it concerns. */
  const [problem, setProblem] = useState<string | null>(null);
  const actions = useAsyncAction();

  const change = (next: Partial<HoldDraft>) => setDraft((current) => ({ ...current, ...next }));

  async function place() {
    const { kind } = draft;
    const tooBig = order !== null && order.size > HOLD_ORDER_MAX_BYTES;
    const first = tooBig
      ? `The attachment is over ${Math.round(HOLD_ORDER_MAX_BYTES / 1024 / 1024)} MB, which the college's storage refuses.`
      : holdDraftProblem(draft);

    setProblem(first);
    // Nothing is sent while the draft is wrong, so a manager never has to work
    // out which half of a partly-placed hold landed.
    if (first !== null || kind === null) return;

    const placed = await actions.run(() =>
      holds.place({
        studentId: target.studentId,
        kind,
        reason: draft.reason,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        order,
      }),
    );

    if (placed) onPlaced(target);
  }

  const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900";

  return (
    <DrilldownModal
      eyebrow="Placement hold"
      title={`Hold ${target.fullName}`}
      subtitle={`Roll ${target.rollNumber} — hold request is submitted to Key Account Manager for approval.`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="hold-reason" className="mb-1 block text-sm font-medium text-ink-700">
            <span>Hold Reason / Comments</span>
            <span className="ml-0.5 font-bold text-danger-500" aria-hidden="true">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </label>
          <textarea
            id="hold-reason"
            rows={3}
            value={draft.reason}
            onChange={(e) => {
              change({ reason: e.target.value });
              setProblem(null);
            }}
            placeholder="Reason for placing placement hold (e.g. pending training clearance, administrative hold)..."
            className={field}
          />
          <p className="mt-1 text-xs text-ink-500">
            The student is shown this reason on their own screen. Supporting attachments are
            internal only.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="hold-starts" className="mb-1 block text-sm font-medium text-ink-700">
              From
            </label>
            <input
              id="hold-starts"
              type="date"
              value={draft.startsAt}
              onChange={(e) => {
                change({ startsAt: e.target.value });
                setProblem(null);
              }}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="hold-ends" className="mb-1 block text-sm font-medium text-ink-700">
              <span>Review by</span>
              <span className="ml-0.5 font-bold text-danger-500" aria-hidden="true">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </label>
            <input
              id="hold-ends"
              type="date"
              value={draft.endsAt}
              onChange={(e) => {
                change({ endsAt: e.target.value });
                setProblem(null);
              }}
              className={field}
            />
            <p className="mt-1 text-xs text-ink-500">
              A reminder, not a switch: the hold stays on until you release it.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="hold-order" className="mb-1 block text-sm font-medium text-ink-700">
            Attachment <span className="font-normal text-ink-500">(optional)</span>
          </label>
          <input
            id="hold-order"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => {
              setOrder(e.target.files?.[0] ?? null);
              setProblem(null);
            }}
            className={field}
          />
          <p className="mt-1 text-xs text-ink-500">
            The fee demand, the offer letter, the note the hold was raised over. PDF or image, up to{" "}
            {Math.round(HOLD_ORDER_MAX_BYTES / 1024 / 1024)} MB. Kept with the college that wrote it
            — the student cannot open it.
          </p>
        </div>

        {(problem !== null || actions.error !== null) && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {problem ?? actions.error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button isLoading={actions.isPending()} onClick={() => void place()}>
            Place hold
          </Button>
          <Button variant="secondary" disabled={actions.busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </DrilldownModal>
  );
}
