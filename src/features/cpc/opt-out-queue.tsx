import { Button, Card } from "@components/ui";
import { useState } from "react";
import { DeclineForm, Evidence } from "./decline-form";
import type { ParticipationQueueView } from "./participation-queue-contract";
import { QueueShell } from "./queue-shell";

/**
 * Opt-out approvals. Its own screen since F2 (UAT 2026-08-06).
 *
 * Approving is irreversible for the student and removes them from every future
 * drive, so the consequence is stated on the screen rather than left to the
 * coordinator's memory. Declining requires a reason (F1) — it is the only
 * thing the student is told, and the request cost them a signed letter.
 */
export function OptOutQueue({ view }: { view: ParticipationQueueView }) {
  const [declining, setDeclining] = useState<string | null>(null);

  return (
    <QueueShell
      view={view}
      title="Opt-out requests"
      subtitle="Approving an opt-out removes the student from all future drives and cannot be undone."
      empty="Nothing waiting for approval."
      isEmpty={(pending) => pending.optOuts.length === 0}
    >
      {(pending, run) => (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {pending.optOuts.map((request) => (
              <li key={request.id} className="flex flex-wrap items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{request.studentName}</p>
                  <p className="text-sm text-ink-500">{request.rollNumber}</p>
                  <p className="mt-1 text-sm text-ink-700">“{request.reason}”</p>
                  <Evidence
                    url={request.declarationUrl}
                    label="signed declaration"
                    missing="No signed declaration was uploaded with this request."
                  />
                </div>

                {declining === request.id ? (
                  <DeclineForm
                    label={`${request.studentName}'s opt-out`}
                    onCancel={() => setDeclining(null)}
                    onDecline={(reason) => {
                      run(() => view.declineOptOut(request.id, reason));
                      setDeclining(null);
                    }}
                  />
                ) : (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setDeclining(request.id)}>
                      Decline
                    </Button>
                    <Button size="sm" onClick={() => run(() => view.approveOptOut(request.id))}>
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
