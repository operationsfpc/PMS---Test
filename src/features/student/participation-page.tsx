import { Badge, Button, Card, PageHeader } from "@components/ui";
import { canRecordSelfPlacement, canRequestOptOut } from "@domain/participation";
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
  /** Mandatory (UAT 2026-08-05): the coordinator has to verify it. */
  readonly offerLetter: File;
}

export interface NewOptOut {
  readonly reason: string;
  /** Mandatory (UAT 2026-08-05): handwritten, signed, and irreversible. */
  readonly declaration: File;
}

export interface ParticipationView {
  status(): Promise<ParticipationStatusView>;
  requestOptOut(request: NewOptOut): Promise<void>;
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
  const [declaration, setDeclaration] = useState<File | null>(null);
  const [offerLetter, setOfferLetter] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await view.status());
  }, [view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function optOut() {
    if (reason.trim() === "") return;

    // The domain refuses without the declaration, so the screen and the
    // database refuse for the same reason and say the same thing.
    const decision = canRequestOptOut({
      participationStatus: status?.participationStatus ?? "active",
      hasPendingRequest: status?.hasPendingRequest ?? false,
      hasDeclaration: declaration !== null,
    });
    if (!decision.allowed) {
      setError(decision.reason);
      return;
    }

    setError(null);
    try {
      await view.requestOptOut({ reason: reason.trim(), declaration: declaration as File });
      setReason("");
      setDeclaration(null);
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

    const decision = canRecordSelfPlacement({
      participationStatus: status?.participationStatus ?? "active",
      hasOfferLetter: offerLetter !== null,
    });
    if (!decision.allowed) {
      setError(decision.reason);
      return;
    }

    setError(null);
    try {
      await view.recordSelfPlacement({
        companyName: company.trim(),
        roleTitle: roleTitle.trim(),
        ctcLpa: value,
        offerLetter: offerLetter as File,
      });
      setCompany("");
      setRoleTitle("");
      setCtc("");
      setOfferLetter(null);
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
          // Only the state of their participation should hide the form; a
          // missing document is a thing to ask for, not a reason to refuse.
          hasDeclaration: true,
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
            <div className="mt-4">
              <label
                htmlFor="optout-declaration"
                className="mb-1 block text-sm font-medium text-ink-700"
              >
                Signed declaration <span className="text-destructive">*</span>
              </label>
              <p className="mb-2 text-xs text-ink-500">
                A <strong>handwritten and signed</strong> letter confirming that you are opting out.
                A clear photograph is fine. Your Campus Placement Coordinator has to approve it, and
                opting out cannot be reversed afterwards.
              </p>
              <input
                id="optout-declaration"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setDeclaration(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
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
          <label htmlFor="sp-letter" className="mb-1 block text-sm font-medium text-ink-700">
            Offer letter <span className="text-destructive">*</span>
          </label>
          <p className="mb-2 text-xs text-ink-500">
            Required. There is no drive behind an off-campus offer, so the letter is the only
            evidence there is — it must be{" "}
            <strong>verified by your Campus Placement Coordinator</strong> before it counts towards
            anything.
          </p>
          <input
            id="sp-letter"
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setOfferLetter(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-4">
          <Button onClick={() => void selfPlace()}>Record off-campus offer</Button>
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
