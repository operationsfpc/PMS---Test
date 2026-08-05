import { Button, Card } from "@components/ui";
import { useState } from "react";
import { DeclineForm, Evidence } from "./decline-form";
import type { ParticipationQueueView } from "./participation-queue-contract";
import { QueueShell } from "./queue-shell";

/**
 * Off-campus offer approvals. Its own screen since F2 (UAT 2026-08-06).
 *
 * Approving is what creates the `offers` row, and with it a number the college
 * reports. There is no drive behind an off-campus offer, so the letter is the
 * only evidence there is — and a decline has to say what was wrong with it
 * (F1), because the student cannot otherwise fix anything.
 */
export function OffCampusQueue({ view }: { view: ParticipationQueueView }) {
  const [declining, setDeclining] = useState<string | null>(null);

  return (
    <QueueShell
      view={view}
      title="Off-campus offers"
      subtitle="Approving records the offer as a placement statistic. It never affects on-campus eligibility."
      empty="Nothing waiting for approval."
      isEmpty={(pending) => pending.selfPlacements.length === 0}
    >
      {(pending, run) => (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {pending.selfPlacements.map((placement) => (
              <li
                key={placement.id}
                className="flex flex-wrap items-start justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{placement.studentName}</p>
                  <p className="text-sm text-ink-500">
                    {placement.rollNumber} · {placement.companyName} · ₹{placement.ctcLpa} LPA
                  </p>
                  <Evidence
                    url={placement.offerLetterUrl}
                    label="offer letter"
                    missing="No offer letter was uploaded with this request."
                  />
                </div>

                {declining === placement.id ? (
                  <DeclineForm
                    label={`${placement.studentName}'s off-campus offer`}
                    onCancel={() => setDeclining(null)}
                    onDecline={(reason) => {
                      run(() => view.declineSelfPlacement(placement.id, reason));
                      setDeclining(null);
                    }}
                  />
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDeclining(placement.id)}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => run(() => view.approveSelfPlacement(placement.id))}
                    >
                      Approve
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </QueueShell>
  );
}
