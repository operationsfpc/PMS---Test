import { Badge, Button, Card, PageHeader } from "@components/ui";
import { classifyOfferCategory } from "@domain/offer-category";
import { PENDING_PIFS } from "@lib/mock-data";

/**
 * Delivery Head — PIF approval queue. PRD §17.5.
 *
 * The Delivery Head sets BOTH drive type and offer category here, and both are
 * final (decision Q1). Rejection is permanent (PRD §6.1), so the UI says so
 * before the click, not after.
 *
 * Uses the real domain rule for the category suggestion — the mock must never
 * invent a second implementation of a business rule.
 */

const CATEGORY_LABEL = {
  regular: "Regular",
  dream: "Dream",
  super_dream: "Super Dream",
} as const;

export function PifApprovalQueue() {
  return (
    <>
      <PageHeader
        title="PIF approvals"
        subtitle="Approve or reject drive initiation forms raised by Account Executives."
      />

      <div className="flex flex-col gap-4">
        {PENDING_PIFS.map((pif) => {
          const bandingCtc = pif.ctcMax ?? pif.ctcMin;
          const suggested = classifyOfferCategory(bandingCtc);
          const ctcLabel =
            pif.ctcMax === null ? `₹${pif.ctcMin} LPA` : `₹${pif.ctcMin}–${pif.ctcMax} LPA`;

          return (
            <Card key={pif.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h2 className="font-heading text-lg font-bold text-ink-900">{pif.company}</h2>
                    {pif.onHold && <Badge tone="warning">On hold</Badge>}
                  </div>
                  <p className="text-sm text-ink-500">
                    {pif.role} · {pif.roleCategory}
                  </p>
                </div>
                <p className="text-sm font-semibold text-ink-900">{ctcLabel}</p>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                {[
                  ["Openings", String(pif.openings)],
                  ["Campuses", String(pif.campuses)],
                  ["Raised by", pif.raisedBy],
                  ["Status", pif.onHold ? "On hold" : "Awaiting approval"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-ink-500">{k}</dt>
                    <dd className="font-medium text-ink-900">{v}</dd>
                  </div>
                ))}
              </dl>

              {/* Classification — the Delivery Head's decision, and it is final. */}
              <fieldset className="mt-5 rounded-lg border border-line bg-surface-muted p-4">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Classification (final — cannot be changed later)
                </legend>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      className="mb-1.5 block text-sm font-medium text-ink-700"
                      htmlFor={`type-${pif.id}`}
                    >
                      Drive type
                    </label>
                    <select
                      id={`type-${pif.id}`}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                      defaultValue="placement"
                    >
                      <option value="placement">Placement</option>
                      <option value="internship_convertible">
                        Internship convertible to full-time
                      </option>
                      <option value="internship">Internship (plain)</option>
                    </select>
                  </div>

                  <div>
                    <label
                      className="mb-1.5 block text-sm font-medium text-ink-700"
                      htmlFor={`cat-${pif.id}`}
                    >
                      Offer category
                    </label>
                    <select
                      id={`cat-${pif.id}`}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                      defaultValue={suggested}
                    >
                      <option value="regular">Regular</option>
                      <option value="dream">Dream</option>
                      <option value="super_dream">Super Dream</option>
                    </select>
                    <p className="mt-1 text-xs text-ink-500">
                      Suggested <strong>{CATEGORY_LABEL[suggested]}</strong> from {ctcLabel}. The
                      decision is yours.
                    </p>
                  </div>
                </div>
              </fieldset>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button>Approve</Button>
                <Button variant="secondary">Put on hold</Button>
                <Button variant="danger">Reject permanently</Button>
                <p className="w-full text-xs text-ink-500 sm:w-auto sm:flex-1 sm:text-right">
                  Rejection is final. A fresh PIF must be raised.
                </p>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
