import { Badge, Button, Card, PageHeader } from "@components/ui";
import { decidePif, type PifDecision } from "@domain/drive-lifecycle";
import type { OfferCategory } from "@domain/offer-category";
import { classifyOfferCategory, OFFER_CATEGORIES } from "@domain/offer-category";
import { supabase } from "@lib/supabase";
import { useCallback, useEffect, useState } from "react";
import {
  ApprovalError,
  type ApprovalRepository,
  createSupabaseApprovalRepository,
  type PendingPif,
} from "./approval-repository";

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
const CATEGORY_LABEL: Record<OfferCategory, string> = {
  regular: "Regular",
  dream: "Dream",
  super_dream: "Super Dream",
};

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
      setCategories(
        Object.fromEntries(
          pending.map((p) => [p.id, classifyOfferCategory(p.ctcMaxLpa ?? p.ctcMinLpa ?? 0)]),
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
            const ctcLabel =
              pif.ctcMaxLpa === null
                ? `₹${pif.ctcMinLpa ?? "—"} LPA`
                : `₹${pif.ctcMinLpa}–${pif.ctcMaxLpa} LPA`;
            const busy = busyId === pif.id;

            return (
              <Card key={pif.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="font-[Raleway] text-lg font-bold text-ink-900">
                    {pif.companyName}
                  </h2>
                  {pif.onHold && <Badge tone="warning">On hold</Badge>}
                </div>
                <p className="text-sm text-ink-500">
                  {pif.roleTitle ?? "Role not specified"} · {ctcLabel}
                  {pif.driveType !== null && ` · ${pif.driveType.replaceAll("_", " ")}`}
                </p>

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
                      value={categories[pif.id] ?? "regular"}
                      onChange={(e) =>
                        setCategories((c) => ({
                          ...c,
                          [pif.id]: e.target.value as OfferCategory,
                        }))
                      }
                    >
                      {OFFER_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-[#FF7200]">
                      Suggested from the CTC. This cannot be changed later.
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
