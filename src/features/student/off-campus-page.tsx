import { Button, Card, PageHeader } from "@components/ui";
import { canRecordSelfPlacement } from "@domain/participation";
import { useCallback, useEffect, useState } from "react";
import type { ParticipationStatusView, ParticipationView } from "./participation-contract";
import { RequestOutcome, submittedOn } from "./request-outcome";

/**
 * An offer the student found themselves. Its own head since F2 (UAT
 * 2026-08-06).
 *
 * Recorded as a separate statistic (PRD §16.2): it never touches the category
 * ladder, the internship cap or on-campus eligibility. Students ask about that
 * constantly, so the screen says it rather than waiting to be asked.
 */
export function OffCampusPage({ view }: { view: ParticipationView }) {
  const [status, setStatus] = useState<ParticipationStatusView | null>(null);
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [ctc, setCtc] = useState("");
  const [offerLetter, setOfferLetter] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await view.status());
  }, [view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const placements = status?.selfPlacements ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Off-campus offer"
        subtitle="An offer you found yourself, recorded and verified separately."
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/*
       * F3: "After the approval of the Self offer letter, the student is not
       * able to go back to check the submission and approval status of it."
       * Every offer stays, decided or not, with what was submitted.
       */}
      {placements.length > 0 && (
        <Card className="mb-6">
          <h2 className="border-b border-line p-4 text-lg text-ink-900">
            Offers you have recorded
          </h2>
          <ul className="divide-y divide-line">
            {placements.map((placement) => (
              <li
                key={placement.id}
                className="flex flex-wrap items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{placement.companyName}</p>
                  <p className="text-sm text-ink-500">
                    {placement.roleTitle === null || placement.roleTitle === ""
                      ? `₹${placement.ctcLpa} LPA`
                      : `${placement.roleTitle} · ₹${placement.ctcLpa} LPA`}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Submitted {submittedOn(placement.submittedAt)}
                  </p>
                </div>
                <RequestOutcome status={placement.status} reason={placement.decisionReason} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5 sm:p-6">
        <p className="text-sm text-ink-700">
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
      </Card>
    </div>
  );
}
