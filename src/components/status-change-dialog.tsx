import { Button } from "@components/ui";
import { useAsyncAction } from "@lib/use-async-action";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Label } from "@/components/shadcn/label";
import { Textarea } from "@/components/shadcn/textarea";

/**
 * The copy and the verb for one move, chosen by the screen that offers it.
 *
 * A restore and a withdrawal are the same form — one mandatory reason and one
 * RPC — but what they promise the reader differs, so the caller writes the
 * sentences and the dialog only insists the reason arrives before the request.
 */
export interface StatusChangePlan {
  readonly eyebrow: string;
  readonly title: string;
  /** What happens to the student, in outcomes rather than in table names. */
  readonly effect: string;
  readonly reasonLabel: string;
  readonly placeholder: string;
  /** Where the reason goes, so the writer knows they are being read. */
  readonly note: string;
  readonly submitLabel: string;
  /** What is wrong with this reason, or null. The domain owns the words. */
  reasonProblem(reason: string): string | null;
  submit(reason: string): Promise<void>;
}

/**
 * The one box a staff member fills to move a student's standing (0133, 0134).
 *
 * Nothing is sent without a reason: the reason is the difference between a
 * decision and an edit, and it is the only explanation the student is ever
 * given. The database refuses the same things again under RLS — this screen
 * stops a manager believing a blank note would do, and gives back the
 * database's own sentence when it says no.
 */
export function StatusChangeDialog({
  plan,
  onClose,
  onDone,
}: {
  plan: StatusChangePlan;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const actions = useAsyncAction();

  async function confirm() {
    const first = plan.reasonProblem(reason);
    setProblem(first);
    if (first !== null) return;
    if (await actions.run(() => plan.submit(reason))) onDone();
  }

  return (
    <Dialog
      open
      // Escape and the backdrop must not abandon a half-written reason while
      // the request is out — the ledger row is already being written.
      onOpenChange={(next) => {
        if (!next && !actions.busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
            {plan.eyebrow}
          </p>
          <DialogTitle>{plan.title}</DialogTitle>
          <DialogDescription>{plan.effect}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="status-change-reason">
            {plan.reasonLabel} <span className="text-danger-600">*</span>
          </Label>
          <Textarea
            id="status-change-reason"
            rows={4}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setProblem(null);
            }}
            placeholder={plan.placeholder}
          />
          <p className="text-xs text-ink-500">{plan.note}</p>
        </div>

        {(problem !== null || actions.error !== null) && (
          <div
            role="alert"
            className="rounded-lg border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
          >
            {problem ?? actions.error}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={actions.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button isLoading={actions.isPending()} onClick={() => void confirm()}>
            {plan.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
