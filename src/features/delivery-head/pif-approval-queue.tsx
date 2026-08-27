import { Badge, Button, Card, PageHeader } from "@components/ui";
import { describeCtcRange } from "@domain/ctc";
import { decidePif, type PifDecision } from "@domain/drive-lifecycle";
import type { OfferCategory } from "@domain/offer-category";
import {
  DEFAULT_OFFER_CATEGORY_BANDS,
  describeOfferCategoryBands,
  OFFER_CATEGORIES,
  offerCategoryLabel,
  suggestOfferCategory,
} from "@domain/offer-category";
import {
  ApprovalError,
  type ApprovalRepository,
  createSupabaseApprovalRepository,
  type PendingPif,
} from "@lib/approval-repository";
import { supabase } from "@lib/supabase";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

/**
 * Delivery Head — PIF approval queue. PRD §17.5.
 *
 * Two irreversible things happen on this screen:
 *   - `offer_category` is set, and §3.3 makes it immutable afterwards.
 *   - Rejection is permanent (§3.1); no edit, no resubmission.
 *
 * Both are stated before the click, not after. The category is *suggested* by
 * the real domain rule and remains the Delivery Head's to change - the screen
 * never re-implements the banding.
 */
/**
 * The CTC bands, stated where the classification is made.
 *
 * Requested 2026-08-17 (Karthik). The dropdown was already pre-set from the
 * CTC, but the rule behind the suggestion was nowhere on screen - so changing
 * it was a guess, and §3.3 makes the result immutable. One banner for the
 * screen, not one per card: the bands do not vary by PIF.
 *
 * The wording is derived from `DEFAULT_OFFER_CATEGORY_BANDS`, so retuning the
 * bands retunes the sentence. It is guidance, not a lock - Q1 leaves the final
 * call with the Delivery Head, and a banner that read as a rule would make a
 * legitimate override feel like a violation.
 */
function CtcBandNote() {
  const bands = describeOfferCategoryBands(DEFAULT_OFFER_CATEGORY_BANDS);

  return (
    <aside
      role="note"
      aria-label="CTC bands for offer categories"
      className="mb-4 rounded-card border border-[#A46AFC] bg-[#A46AFC]/5 p-4"
    >
      <p className="text-sm font-semibold text-ink-900">How CTC maps to an offer category</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-700">
        {bands.map((band) => (
          <li key={band.category}>
            <strong>{band.label}</strong> — {band.range}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-500">
        Guidance only — the category below is suggested from the CTC and the final call is yours. A
        band edge belongs to the band above it: exactly ₹5 LPA is Dream, and exactly ₹10 LPA is
        Super Dream.
      </p>
    </aside>
  );
}

export function PifApprovalQueue({ repository }: { repository?: ApprovalRepository }) {
  const [repo] = useState<ApprovalRepository>(
    () => repository ?? createSupabaseApprovalRepository(supabase()),
  );
  const [rows, setRows] = useState<readonly PendingPif[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Record<string, OfferCategory>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const pending = await repo.pending();
      setRows(pending);
      // UAT 2026-08-27: a cap-only internship carries no CTC, and asking for
      // a suggestion used to THROW — one such PIF emptied the whole queue
      // behind "Could not load the queue". No suggestion is a valid answer.
      setCategories(
        Object.fromEntries(
          pending
            .map((p) => [p.id, suggestOfferCategory(p.ctcMaxLpa ?? p.ctcMinLpa)] as const)
            .filter((entry): entry is readonly [string, OfferCategory] => entry[1] !== null),
        ),
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApprovalError ? caught.message : "Could not load the queue.");
      // Never []: an empty queue and a broken one mean opposite things.
      setRows(null);
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(pif: PendingPif, approve: boolean) {
    const intent: PifDecision = approve
      ? { decision: "approve", offerCategory: categories[pif.id] ?? null }
      : { decision: "reject", reason: reasons[pif.id] ?? "" };

    // Same rule the repository and the database enforce - asked here only so
    // the Delivery Head gets the answer without a round trip. Not a copy of it.
    const check = decidePif("submitted", intent);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setBusyId(pif.id);
    setError(null);
    try {
      await repo.decide(pif.id, "submitted", intent);
      setRows((current) => (current ?? []).filter((r) => r.id !== pif.id));
    } catch (caught) {
      setError(caught instanceof ApprovalError ? caught.message : "Could not save the decision.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="PIF approvals"
        subtitle="Approve or reject drive initiation forms raised by Account Executives."
      />

      {error !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {error}
          </p>
        </Card>
      )}

      {/* Stated before the queue: the rule has to be read before the click,
          not after the classification is already immutable. */}
      {rows !== null && rows.length > 0 && <CtcBandNote />}

      {rows === null ? (
        error === null ? (
          <p role="status" className="p-6 text-sm text-neutral-500">
            Loading the queue…
          </p>
        ) : null
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            Nothing awaiting approval. Newly submitted PIFs will appear here.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((pif) => {
            // One formatter for every screen (C3) — the inline version here
            // printed "₹— LPA" for an internship that has no CTC at all.
            const ctcLabel = describeCtcRange(pif.ctcMinLpa, pif.ctcMaxLpa) ?? "CTC not specified";
            const busy = busyId === pif.id;

            return (
              <Card key={pif.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="font-[Raleway] text-lg font-bold text-ink-900">
                    {pif.companyName}
                  </h2>
                  {pif.onHold && <Badge tone="warning">On hold</Badge>}
                  {/* N1: "delivery head should be able to click and view all
                      relevant fields of the drive." */}
                  <Link
                    to={`/drives/${pif.id}`}
                    className="text-xs font-semibold text-[#3D3777] underline underline-offset-2"
                  >
                    View the full drive
                  </Link>
                </div>
                <p className="text-sm text-ink-500">
                  {pif.roleTitle ?? "Role not specified"} · {ctcLabel}
                  {pif.driveType !== null && ` · ${pif.driveType.replaceAll("_", " ")}`}
                </p>

                {/*
                 * J1/J2/J3 (2026-08-18, answer 10). The Delivery Head approves
                 * the commercials of a role, and until today this card carried
                 * a company, a title and a CTC — so the shift a student would
                 * work, when they would start, and the recruiter's own JD were
                 * all things the approver had to take on trust.
                 */}
                <dl className="mt-3 grid gap-3 rounded-lg bg-surface-muted p-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Shift
                    </dt>
                    <dd className="mt-0.5 text-sm text-ink-800">{pif.shift}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Joining
                    </dt>
                    <dd className="mt-0.5 text-sm text-ink-800">{pif.joining}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Job description
                    </dt>
                    <dd className="mt-0.5 text-sm text-ink-800">
                      {pif.jobDescriptionUrl === null ? (
                        // Never a link that opens nothing: an approver who
                        // clicks one cannot tell a missing file from a broken
                        // permission.
                        <span className="text-ink-500">No job description attached</span>
                      ) : (
                        <a
                          href={pif.jobDescriptionUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-[#3D3777] underline underline-offset-2"
                        >
                          {pif.jobDescriptionName ?? "Open the job description (PDF)"}
                        </a>
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`cat-${pif.id}`}
                      className="mb-1 block text-sm font-medium text-ink-900"
                    >
                      Offer category
                    </label>
                    <select
                      id={`cat-${pif.id}`}
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                      // Never a silent default: §3.3 makes this immutable, so
                      // a category nobody chose must not be approvable.
                      value={categories[pif.id] ?? ""}
                      onChange={(e) =>
                        setCategories((c) => ({
                          ...c,
                          [pif.id]: e.target.value as OfferCategory,
                        }))
                      }
                    >
                      {/* The banner above and this dropdown must not be able
                          to call the same category different things, so both
                          take their words from the domain. */}
                      <option value="" disabled>
                        Choose a category…
                      </option>
                      {OFFER_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {offerCategoryLabel(c)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-[#FF7200]">
                      {categories[pif.id] === undefined
                        ? "No CTC on this PIF, so nothing is suggested — choose the category. This cannot be changed later."
                        : "Suggested from the CTC. This cannot be changed later."}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor={`reason-${pif.id}`}
                      className="mb-1 block text-sm font-medium text-ink-900"
                    >
                      Rejection reason
                    </label>
                    <input
                      id={`reason-${pif.id}`}
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                      value={reasons[pif.id] ?? ""}
                      onChange={(e) => setReasons((r) => ({ ...r, [pif.id]: e.target.value }))}
                    />
                    <p className="mt-1 text-xs text-ink-500">
                      Required to reject. Rejection is final — the PIF cannot be edited or
                      resubmitted, and a fresh one must be raised.
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Button disabled={busy} onClick={() => void decide(pif, true)}>
                    {busy ? "Saving…" : "Approve"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void decide(pif, false)}
                  >
                    Reject permanently
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
