import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/alert-dialog";
import { useToast } from "@components/toast";
import {
  Badge,
  Button,
  ButtonAnchor,
  ButtonLink,
  Card,
  LottieLoader,
  PageHeader,
} from "@components/ui";
import { visitKey } from "@domain/company-drive";
import { describeCtcRange } from "@domain/ctc";
import { decidePif, type PifDecision } from "@domain/drive-lifecycle";
import { driveTypeLabel, driveTypeTone } from "@domain/drive-type";
import type { OfferCategory } from "@domain/offer-category";
import {
  DEFAULT_OFFER_CATEGORY_BANDS,
  describeOfferCategoryBands,
  offerCategoriesFor,
  offerCategoryLabel,
  requiredOfferCategoryFor,
  suggestOfferCategory,
} from "@domain/offer-category";
import { roleCategoryLabel, roleCategoryStyle } from "@domain/role-category";
import { describeStipendRange } from "@domain/stipend";
import { dateStamp } from "@domain/student-drive-lists";
import { workTypeLabel } from "@domain/work-type";
import {
  ApprovalError,
  type ApprovalRepository,
  createSupabaseApprovalRepository,
  type PendingDriveEvent,
  type PendingPif,
  type SentBackPif,
} from "@lib/approval-repository";
import { supabase } from "@lib/supabase";
import { useCallback, useEffect, useState } from "react";

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
      className="mb-4 rounded-card border border-brand-300 bg-brand-500/5 p-4"
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

const EVENT_MODE_LABELS: Record<string, string> = {
  on_campus: "On campus",
  physical_outside_campus: "Off campus",
  virtual: "Virtual",
  pooled: "Pooled",
};

/**
 * A rejection is final (§3.3), so the sent-back list only ever grows. The most
 * recent are what a decision gets questioned about, so the screen keeps those
 * and names how many it held back rather than pretending the list ended there.
 */
const SENT_BACK_DISPLAY_LIMIT = 12;

/**
 * One pending role, decided on its own. A standalone PIF renders as its own
 * card with the company name on it; a role under a recruitment event renders
 * inside that event's card, where the company — and the date, the venue and
 * the recruiter contacts the AE recorded — are the header it sits under.
 */
function PendingRoleCard({
  pif,
  standalone,
  pending,
  category,
  reason,
  onCategory,
  onReason,
  onApprove,
  onReject,
}: {
  pif: PendingPif;
  standalone: boolean;
  pending: "approve" | "reject" | null;
  category: OfferCategory | undefined;
  reason: string;
  onCategory: (value: OfferCategory) => void;
  onReason: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  /**
   * Which verb the card is about to carry out, or none. §3.1 makes a rejection
   * final and §3.3 makes the category immutable, so neither may fire on a bare
   * click — the drive record already asks first, and this screen is the one
   * that decides.
   */
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);
  const reasonTyped = reason.trim() !== "";

  // One formatter for every screen (C3) — the inline version here
  // printed "₹— LPA" for an internship that has no CTC at all.
  const ctc = describeCtcRange(pif.ctcMinLpa, pif.ctcMaxLpa);
  const stipend = describeStipendRange(pif.stipendMinMonthly, pif.stipendMaxMonthly);
  // Both are shown when both exist: a convertible drive is approved
  // on its stipend AND on its eventual salary.
  const pay =
    ctc === null && stipend === null
      ? "No CTC or stipend recorded"
      : [ctc, stipend === null ? null : `Stipend ${stipend}`]
          .filter((part) => part !== null)
          .join(" · ");
  const categoryOptions = offerCategoriesFor(pif.driveType);
  const categoryIsFixed = requiredOfferCategoryFor(pif.driveType) !== null;

  const body = (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {standalone ? (
          <h2 className="min-w-0 break-words font-heading text-lg font-bold text-ink-900 [overflow-wrap:anywhere]">
            {pif.companyName}
          </h2>
        ) : (
          <h3 className="font-heading text-base font-bold text-ink-900">
            {pif.roleTitle ?? "Role not specified"}
          </h3>
        )}
        {/* 2026-08-27: the type, on every drive summary. */}
        <Badge tone={driveTypeTone(pif.driveType)}>{driveTypeLabel(pif.driveType)}</Badge>
        {pif.roleCategory != null && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${roleCategoryStyle(pif.roleCategory).badgeClass}`}
          >
            {roleCategoryLabel(pif.roleCategory)}
          </span>
        )}
        {pif.onHold && <Badge tone="warning">On hold</Badge>}
        {/* N1: "delivery head should be able to click and view all
            relevant fields of the drive." */}
        <ButtonLink
          size="sm"
          to={`/drives/${pif.id}`}
          aria-label={`View ${pif.companyName} — ${pif.roleTitle ?? "role not specified"}`}
        >
          View
        </ButtonLink>
      </div>
      <p className="text-sm text-ink-500">
        {standalone ? `${pif.roleTitle ?? "Role not specified"} · ` : ""}
        {pay}
      </p>

      {/*
       * J1/J2/J3 (2026-08-18, answer 10). The Delivery Head approves
       * the commercials of a role, and until today this card carried
       * a company, a title and a CTC — so the shift a student would
       * work, when they would start, and the recruiter's own JD were
       * all things the approver had to take on trust.
       */}
      <dl className="mt-3 grid gap-3 rounded-lg bg-surface-muted p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Shift</dt>
          <dd className="mt-0.5 text-sm text-ink-800">{pif.shift}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Joining</dt>
          <dd className="mt-0.5 text-sm text-ink-800">{pif.joining}</dd>
        </div>
        {/* 0138: where the work happens. Said here even when the AE said
            nothing, because an approver who cannot see the gap cannot ask
            for it. */}
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Work type</dt>
          <dd className="mt-0.5 text-sm text-ink-800">{workTypeLabel(pif.workType)}</dd>
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
              <ButtonAnchor
                size="sm"
                variant="ghost"
                href={pif.jobDescriptionUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${pif.jobDescriptionName ?? "the job description"} for ${pif.companyName}`}
              >
                {pif.jobDescriptionName ?? "Job description"}
              </ButtonAnchor>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`cat-${pif.id}`} className="mb-1 block text-sm font-medium text-ink-900">
            Offer category
          </label>
          <select
            id={`cat-${pif.id}`}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            // Never a silent default: §3.3 makes this immutable, so
            // a category nobody chose must not be approvable.
            value={category ?? ""}
            onChange={(e) => onCategory(e.target.value as OfferCategory)}
          >
            {/* The banner above and this dropdown must not be able
                to call the same category different things, so both
                take their words from the domain. */}
            <option value="" disabled>
              Choose a category…
            </option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {offerCategoryLabel(c)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-warning">
            {categoryIsFixed
              ? "This drive is an internship, so Internship is the only category it can carry. This cannot be changed later."
              : category === undefined
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
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            value={reason}
            onChange={(e) => onReason(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-500">
            Required to reject. Rejection is final — the PIF cannot be edited or resubmitted, and a
            fresh one must be raised.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          isLoading={pending === "approve"}
          // A written reason means the mind is on sending the drive back, and
          // the two verbs are opposites: only one of them may be armed.
          disabled={pending !== null || reasonTyped}
          onClick={() => setConfirming("approve")}
        >
          Approve
        </Button>
        <Button
          variant="secondary"
          isLoading={pending === "reject"}
          disabled={pending !== null}
          onClick={() => setConfirming("reject")}
        >
          Reject permanently
        </Button>
        {reasonTyped && pending === null && (
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
            A reason is written, so Approve is off.
            <Button variant="ghost" size="sm" onClick={() => onReason("")}>
              Clear it
            </Button>
            to approve this role.
          </span>
        )}
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "approve"
                ? `Approve ${pif.companyName} — ${pif.roleTitle ?? "Role not specified"}`
                : `Send back ${pif.companyName} — ${pif.roleTitle ?? "Role not specified"}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "approve"
                ? "This fixes the offer category, and §3.3 makes it unchangeable afterwards. The students hear about the drive only when a coordinator publishes it."
                : "Rejection is final: this PIF cannot be edited or resubmitted, and a fresh one must be raised. The reason below is what the account executive reads."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <p className="text-sm text-ink-700 [overflow-wrap:anywhere]">
            {confirming === "approve"
              ? category === undefined
                ? "No offer category has been chosen yet."
                : `Offer category: ${offerCategoryLabel(category)} · ${pay}`
              : reason.trim() === ""
                ? "No reason has been written yet."
                : `Reason: ${reason.trim()}`}
          </p>

          <AlertDialogFooter>
            <AlertDialogCancel />
            {confirming === "approve" ? (
              <AlertDialogAction
                disabled={category === undefined}
                onClick={() => {
                  setConfirming(null);
                  onApprove();
                }}
              >
                Confirm — approve
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                variant="danger"
                disabled={reason.trim() === ""}
                onClick={() => {
                  setConfirming(null);
                  onReject();
                }}
              >
                Confirm — reject permanently
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (standalone) return <Card className="p-5">{body}</Card>;
  return <div className="rounded-card border border-line bg-surface p-4">{body}</div>;
}

export function PifApprovalQueue({ repository }: { repository?: ApprovalRepository }) {
  const { toast } = useToast();
  const [repo] = useState<ApprovalRepository>(
    () => repository ?? createSupabaseApprovalRepository(supabase()),
  );
  const [rows, setRows] = useState<readonly PendingPif[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which card is working, and which verb was pressed. A row-level flag would
   * spin "Reject permanently" while an approval is out, which reads exactly
   * like the click that was missed.
   */
  const [pending, setPending] = useState<{
    id: string;
    verb: "approve" | "reject";
  } | null>(null);
  const [categories, setCategories] = useState<Record<string, OfferCategory>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  /**
   * 2026-11-06: "rejected drive list is not shows". A rejection wrote the row
   * and dropped the card, and no read this screen makes asked for status
   * rejected, so the drives the Delivery Head refused were findable only on the
   * dashboard — while §3.3 makes each refusal final and unedited.
   *
   * Kept apart from the queue's own error because they mean different things:
   * a pending list that will not load stops every approval, and a sent-back
   * list that will not load must not.
   */
  const [sentBack, setSentBack] = useState<readonly SentBackPif[] | null>(null);
  const [sentBackProblem, setSentBackProblem] = useState<string | null>(null);

  const loadSentBack = useCallback(async () => {
    try {
      setSentBack(await repo.sentBack());
      setSentBackProblem(null);
    } catch (caught) {
      setSentBack(null);
      setSentBackProblem(caught instanceof ApprovalError ? caught.message : "Could not load them.");
    }
  }, [repo]);

  const load = useCallback(async () => {
    // The two reads are independent and neither waits on the other: a sent-back
    // list that will not load must not stop an approval, and vice versa.
    void loadSentBack();
    try {
      const pending = await repo.pending();
      setRows(pending);
      // UAT 2026-08-27: a cap-only internship carries no CTC, and asking for
      // a suggestion used to THROW — one such PIF emptied the whole queue
      // behind "Could not load the queue". No suggestion is a valid answer.
      // 2026-08-27: an internship's category is not a judgement, it is a
      // restatement of its type, so it is filled in rather than asked for.
      setCategories(
        Object.fromEntries(
          pending
            .map(
              (p) =>
                [
                  p.id,
                  requiredOfferCategoryFor(p.driveType) ??
                    suggestOfferCategory(p.ctcMaxLpa ?? p.ctcMinLpa),
                ] as const,
            )
            .filter((entry): entry is readonly [string, OfferCategory] => entry[1] !== null),
        ),
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApprovalError ? caught.message : "Could not load the queue.");
      // Never []: an empty queue and a broken one mean opposite things.
      setRows(null);
    }
  }, [repo, loadSentBack]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(pif: PendingPif, approve: boolean) {
    const intent: PifDecision = approve
      ? { decision: "approve", offerCategory: categories[pif.id] ?? null }
      : { decision: "reject", reason: reasons[pif.id] ?? "" };

    // Same rule the repository and the database enforce - asked here only so
    // the Delivery Head gets the answer without a round trip. Not a copy of it.
    const check = decidePif("submitted", intent, pif.driveType);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setPending({ id: pif.id, verb: approve ? "approve" : "reject" });
    setError(null);
    try {
      await repo.decide(pif.id, "submitted", intent);
      setRows((current) => (current ?? []).filter((r) => r.id !== pif.id));
      if (!approve) {
        // The card leaves the queue, so the only place it can still be found is
        // the list below — re-read it before saying the drive was rejected.
        await loadSentBack();
      }
      const chosenCategory = categories[pif.id];
      const categoryLabel =
        approve && chosenCategory !== undefined ? ` as ${offerCategoryLabel(chosenCategory)}` : "";
      toast({
        tone: approve ? "success" : "danger",
        title: approve ? "Drive approved" : "Drive rejected",
        description: `${pif.companyName} — ${pif.roleTitle} ${approve ? `approved${categoryLabel}` : "rejected"}.`,
      });
    } catch (caught) {
      const msg = caught instanceof ApprovalError ? caught.message : "Could not save the decision.";
      setError(msg);
      toast({
        tone: "danger",
        title: approve ? "Could not approve drive" : "Could not reject drive",
        description: msg,
      });
    } finally {
      setPending(null);
    }
  }

  /** The verb this card is working on, so only that button spins. */
  const pendingFor = (pif: PendingPif) => (pending?.id === pif.id ? pending.verb : null);

  // Roles raised under one recruitment event sit together under that event's
  // header — but each keeps its own category, its own reason and its own
  // buttons, because §3.3 makes every category an individual, immutable
  // decision. PIFs without an event keep their own cards, unchanged.
  const eventGroups: { key: string; event: PendingDriveEvent; roles: PendingPif[] }[] = [];
  const standalone: PendingPif[] = [];
  for (const pif of rows ?? []) {
    if (pif.companyDriveId !== null && pif.event !== null) {
      const key = visitKey(pif.companyDriveId, pif.id);
      const group = eventGroups.find((g) => g.key === key);
      if (group) {
        group.roles.push(pif);
      } else {
        eventGroups.push({ key, event: pif.event, roles: [pif] });
      }
    } else {
      standalone.push(pif);
    }
  }

  const sentBackShown = (sentBack ?? []).slice(0, SENT_BACK_DISPLAY_LIMIT);
  const sentBackHidden = (sentBack?.length ?? 0) - sentBackShown.length;

  return (
    <>
      <PageHeader
        title="PIF approvals"
        subtitle="Approve or reject drive initiation forms raised by Account Executives."
      />

      {error !== null && (
        <Card className="mb-4 border border-danger-500 bg-danger-50 p-4">
          <p role="alert" className="text-sm text-danger-500">
            {error}
          </p>
        </Card>
      )}

      {/* Stated before the queue: the rule has to be read before the click,
          not after the classification is already immutable. */}
      {rows !== null && rows.length > 0 && <CtcBandNote />}

      {rows === null ? (
        error === null ? (
          <LottieLoader size="fullscreen" message="Loading the approval queue…" />
        ) : null
      ) : rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-700">
            Nothing awaiting approval. Newly submitted PIFs will appear here.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {eventGroups.map(({ key, event, roles }) => (
            <Card key={key} className="p-5">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words font-heading text-lg font-bold text-ink-900 [overflow-wrap:anywhere]">
                  {event.companyName}
                </h2>
                <Badge tone="accent">
                  {roles.length} role{roles.length === 1 ? "" : "s"}
                </Badge>
              </div>
              <p className="text-sm text-ink-500">
                One recruitment event · {event.tentativeDate ?? "date to be announced"}
                {event.driveMode !== null &&
                  ` · ${EVENT_MODE_LABELS[event.driveMode] ?? event.driveMode.replace(/_/g, " ")}`}
                {event.venue !== null && event.venue !== "" && ` · ${event.venue}`}
              </p>
              {event.contacts.length > 0 && (
                <p className="mt-1 text-xs text-ink-500">
                  Company contacts:{" "}
                  {event.contacts
                    .map((c) =>
                      [
                        [c.name, c.designation].filter((p) => p !== null && p !== "").join(", "),
                        c.email !== null && c.email !== "" ? c.email : null,
                      ]
                        .filter((p) => p !== null && p !== "")
                        .join(" · "),
                    )
                    .join(" | ")}
                </p>
              )}
              <p className="mt-2 text-xs font-semibold text-ink-700">
                Each role is decided on its own below — approving one does not approve the others.
              </p>
              <div className="mt-3 flex flex-col gap-3">
                {roles.map((pif) => (
                  <PendingRoleCard
                    key={pif.id}
                    pif={pif}
                    standalone={false}
                    pending={pendingFor(pif)}
                    category={categories[pif.id]}
                    reason={reasons[pif.id] ?? ""}
                    onCategory={(value) => setCategories((c) => ({ ...c, [pif.id]: value }))}
                    onReason={(value) => setReasons((r) => ({ ...r, [pif.id]: value }))}
                    onApprove={() => void decide(pif, true)}
                    onReject={() => void decide(pif, false)}
                  />
                ))}
              </div>
            </Card>
          ))}
          {standalone.map((pif) => (
            <PendingRoleCard
              key={pif.id}
              pif={pif}
              standalone
              pending={pendingFor(pif)}
              category={categories[pif.id]}
              reason={reasons[pif.id] ?? ""}
              onCategory={(value) => setCategories((c) => ({ ...c, [pif.id]: value }))}
              onReason={(value) => setReasons((r) => ({ ...r, [pif.id]: value }))}
              onApprove={() => void decide(pif, true)}
              onReject={() => void decide(pif, false)}
            />
          ))}
        </div>
      )}

      <section aria-labelledby="sent-back-heading" className="mt-6">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 id="sent-back-heading" className="font-heading text-base font-bold text-ink-900">
            Sent back
          </h2>
          {sentBack !== null && sentBack.length > 0 && (
            <Badge tone="neutral">
              {sentBack.length} drive{sentBack.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        <p className="text-sm text-ink-500">
          A drive you send back is not edited or resubmitted — this is the record of each refusal.
        </p>

        {sentBackProblem !== null ? (
          <p role="alert" className="mt-3 text-sm text-danger-700">
            {sentBackProblem}
          </p>
        ) : sentBack === null ? (
          <p className="mt-3 text-sm text-ink-500">Loading the drives you sent back…</p>
        ) : sentBack.length === 0 ? (
          <p className="mt-3 text-sm text-ink-700">Nothing sent back yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {sentBackShown.map((pif) => {
              const role = pif.roleTitle ?? "Role not specified";
              const sentDay = dateStamp(pif.decidedAt);

              return (
                <li key={pif.id} className="rounded-card border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 break-words font-heading text-sm font-bold text-ink-900 [overflow-wrap:anywhere]">
                      {pif.companyName}
                    </h3>
                    <span className="min-w-0 break-words text-sm text-ink-700 [overflow-wrap:anywhere]">
                      {role}
                    </span>
                    {pif.roleCategory !== null && (
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${roleCategoryStyle(pif.roleCategory).badgeClass}`}
                      >
                        {roleCategoryLabel(pif.roleCategory)}
                      </span>
                    )}
                    <ButtonLink
                      size="sm"
                      to={`/drives/${pif.id}`}
                      aria-label={`View ${pif.companyName} — ${role}`}
                    >
                      View
                    </ButtonLink>
                  </div>
                  <p className="mt-2 text-sm text-ink-700 [overflow-wrap:anywhere]">
                    {pif.reason ?? "No reason was recorded."}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    {sentDay === null
                      ? "Sent back — no date on this record."
                      : `Sent back ${sentDay}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {sentBackHidden > 0 && (
          <p className="mt-2 text-xs text-ink-500">
            Showing the {SENT_BACK_DISPLAY_LIMIT} most recent; {sentBackHidden} earlier{" "}
            {sentBackHidden === 1 ? "drive" : "drives"} sent back not listed.
          </p>
        )}
      </section>
    </>
  );
}
