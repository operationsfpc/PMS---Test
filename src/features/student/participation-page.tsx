import { Badge, Button, Card, PageHeader } from "@components/ui";
import { canRequestOptOut } from "@domain/participation";
import type { ParticipationStatus } from "@domain/types";
import { useCallback, useEffect, useState } from "react";

export interface SelfPlacement {
  readonly id: string;
  readonly companyName: string;
  readonly ctcLpa: number;
  readonly approved: boolean;
}

export interface ParticipationStatusView {
  readonly participationStatus: ParticipationStatus;
  readonly hasPendingRequest: boolean;
  readonly selfPlacements: readonly SelfPlacement[];
}

export interface NewSelfPlacement {
  readonly companyName: string;
  readonly roleTitle: string;
  readonly ctcLpa: number;
}

export interface ParticipationView {
  status(): Promise<ParticipationStatusView>;
  requestOptOut(reason: string): Promise<void>;
  recordSelfPlacement(placement: NewSelfPlacement): Promise<void>;
}

/**
 * The student's own participation.
 *
 * Mobile-first: students are on phones (PRD 21.2). Opting out is irreversible,
 * so it is stated before the button, not in a confirmation the student has
 * already decided to dismiss.
 */
export function ParticipationPage({ view }: { view: ParticipationView }) {
  const [status, setStatus] = useState<ParticipationStatusView | null>(null);
  const [reason, setReason] = useState("");
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [ctc, setCtc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await view.status());
  }, [view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function optOut() {
    if (reason.trim() === "") return;
    setError(null);
    try {
      await view.requestOptOut(reason.trim());
      setReason("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send your request.");
    }
  }

  async function selfPlace() {
    const value = Number(ctc);
    if (company.trim() === "" || !Number.isFinite(value) || value <= 0) {
      setError("Enter the company and a valid CTC in LPA.");
      return;
    }
    setError(null);
    try {
      await view.recordSelfPlacement({
        companyName: company.trim(),
        roleTitle: roleTitle.trim(),
        ctcLpa: value,
      });
      setCompany("");
      setRoleTitle("");
      setCtc("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the offer.");
    }
  }

  const optOutDecision =
    status === null
      ? null
      : canRequestOptOut({
          participationStatus: status.participationStatus,
          hasPendingRequest: status.hasPendingRequest,
        });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My participation" />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <Card className="mb-6 p-5 sm:p-6">
        <h2 className="text-lg text-ink-900">Opting out of campus placement</h2>
        <p className="mt-2 text-sm text-ink-700">
          Opting out removes you from all future drives. It <strong>cannot be reversed</strong>.
          Drives you are already part of will continue.
        </p>

        {status === null ? (
          <p role="status" className="mt-3 text-sm text-ink-500">
            Loading…
          </p>
        ) : status.participationStatus === "opted_out" ? (
          <p className="mt-4 text-sm font-medium text-ink-900">
            You have opted out of campus placement.
          </p>
        ) : status.hasPendingRequest ? (
          <p className="mt-4 text-sm font-medium text-ink-900">
            Your opt-out request is waiting for approval.
          </p>
        ) : optOutDecision?.allowed === false ? (
          <p className="mt-4 text-sm text-ink-700">{optOutDecision.reason}</p>
        ) : (
          <div className="mt-4">
            <label htmlFor="optout-reason" className="mb-1 block text-sm font-medium text-ink-700">
              Why are you opting out?
            </label>
            <textarea
              id="optout-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <div className="mt-3">
              <Button variant="secondary" onClick={() => void optOut()}>
                Request opt-out
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg text-ink-900">Off-campus offer</h2>
        <p className="mt-2 text-sm text-ink-700">
          Recorded as a separate statistic. It <strong>does not affect</strong> your on-campus
          eligibility or which drives you can apply to.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="sp-company" className="mb-1 block text-sm font-medium text-ink-700">
              Company
            </label>
            <input
              id="sp-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="sp-role" className="mb-1 block text-sm font-medium text-ink-700">
              Role
            </label>
            <input
              id="sp-role"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="sp-ctc" className="mb-1 block text-sm font-medium text-ink-700">
              CTC (LPA)
            </label>
            <input
              id="sp-ctc"
              inputMode="decimal"
              value={ctc}
              onChange={(e) => setCtc(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4">
          <Button onClick={() => void selfPlace()}>Submit off-campus offer</Button>
        </div>

        {status !== null && status.selfPlacements.length > 0 && (
          <ul className="mt-5 divide-y divide-neutral-200 border-t border-neutral-200">
            {status.selfPlacements.map((placement) => (
              <li key={placement.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-ink-900">{placement.companyName}</p>
                  <p className="text-sm text-ink-500">₹{placement.ctcLpa} LPA</p>
                </div>
                <Badge tone={placement.approved ? "success" : "warning"}>
                  {placement.approved ? "Approved" : "Awaiting approval"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
