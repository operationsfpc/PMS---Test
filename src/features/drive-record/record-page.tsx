import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/alert-dialog";
import { TablePager } from "@components/table-pager";
import { useToast } from "@components/toast";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  LottieLoader,
  PageHeader,
  type Tone,
} from "@components/ui";
import { decidePif, type PifDecision } from "@domain/drive-lifecycle";
import {
  canApproveDrive,
  canPublishDrive,
  canRaiseDrive,
  canShortlistFromPortfolio,
  FUNNEL_STAGES,
  type FunnelStageKey,
  filterFunnelStage,
} from "@domain/drive-portfolio";
import { driveStatusLabel, driveStatusTone } from "@domain/drive-status";
import { asDriveType, driveTypeLabel, driveTypeTone } from "@domain/drive-type";
import { describeDriveFreeze } from "@domain/drive-working";
import type { OfferCategory } from "@domain/offer-category";
import {
  offerCategoriesFor,
  offerCategoryLabel,
  offerCategoryRestatesType,
  requiredOfferCategoryFor,
  suggestOfferCategory,
} from "@domain/offer-category";
import { roleCategoryLabel, roleCategoryStyle } from "@domain/role-category";
import type { AppRole, DriveStatus, DriveType } from "@domain/types";
import { workTypeLabel } from "@domain/work-type";
import { ExternalLink, FileText, Search, TriangleAlert } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import type { DriveRecord, DriveRecordView } from "./record-view";
import { Bar } from "./student-apply-bar";

/**
 * N1 — the drive's one canonical page (approved mockup 2026-08-19).
 *
 * READ-ONLY by design: a page that shows everything and edits nothing cannot
 * leak a permission by accident. Editing stays where it lives — the PIF for
 * the AE, publish-and-target for the Central CPC.
 *
 * `role` is REQUIRED, not defaulted: a permissive default is a permission
 * granted by forgetfulness (the CockpitPage rule).
 */

const AREA_LABEL: Record<string, string> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

const when = (iso: string | null) =>
  iso === null
    ? "—"
    : new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" });

/**
 * One section of the record. The heading is plain ink on a rule: the hues this
 * card used to wear (brand, violet, gold, green) were chosen per section by the
 * author and meant nothing, so a reader scanning five coloured headings learned
 * nothing. Colour stays where it still means something — the status and type
 * badges above, the gold caution on an apply-time snapshot.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-2xl border border-line/70 p-5 shadow-xs transition-shadow hover:shadow-sm sm:p-6 bg-surface">
      <div className="mb-4 border-b border-line/60 pb-3">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-ink-900">
          {title}
        </h2>
      </div>
      {children}
    </Card>
  );
}

function Fact({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  if (value.trim() === "" || value === "—") return null;
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800 break-words [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

const TILE_STYLES = {
  neutral: {
    container: "border-line bg-surface",
    label: "text-ink-500",
    value: "text-ink-900",
  },
  emerald: {
    container: "border-success-200/80 bg-success-50/40 hover:border-success-300",
    label: "text-success-700",
    value: "text-success-950 font-extrabold",
  },
  sky: {
    container: "border-brand-200/80 bg-brand-50/40 hover:border-brand-400",
    label: "text-brand-700",
    value: "text-brand-950 font-extrabold",
  },
  brand: {
    container: "border-brand-200/80 bg-brand-50/40 hover:border-brand-400",
    label: "text-brand-700",
    value: "text-brand-950 font-extrabold",
  },
  amber: {
    container: "border-gold-200/80 bg-gold-50/40 hover:border-gold-300",
    label: "text-gold-700",
    value: "text-gold-950 font-extrabold",
  },
} as const;

function formatLocation(locations: string): string {
  if (!locations || locations.trim() === "") return "Not stated";
  return locations
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return "";
      return trimmed
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

function formatDriveMode(driveMode: string): string {
  if (!driveMode || driveMode.trim() === "") return "Not stated";
  const raw = `${driveMode.replaceAll("_", " ")} drive`;
  return raw
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function renderCtc(ctcLabel: string) {
  if (!ctcLabel || ctcLabel.trim() === "" || ctcLabel === "Not stated") {
    return "Not stated";
  }
  const match = ctcLabel.match(/^(.*?)\s*(LPA|lpa)(.*)$/);
  if (match?.[2]) {
    const numberPart = match[1]?.trim();
    const unitPart = match[2]?.trim();
    const extra = match[3]?.trim();
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1.5">
        <span className="text-xl sm:text-2xl font-extrabold tracking-tight font-heading text-success-950">
          {numberPart}
        </span>{" "}
        <span className="text-xs font-bold uppercase tracking-wider text-success-800">
          {unitPart}
        </span>
        {extra ? ` ${extra}` : null}
      </span>
    );
  }
  return (
    <span className="text-xl sm:text-2xl font-extrabold tracking-tight text-success-950">
      {ctcLabel}
    </span>
  );
}

function statusTone(status: string): Tone {
  const t = driveStatusTone(status);
  return t === "neutral" ? "brand" : t;
}

function offerCategoryBadgeTone(category: OfferCategory): Tone {
  switch (category) {
    case "regular":
      return "brand";
    case "dream":
      return "accent";
    case "super_dream":
      return "success";
    case "internship":
      return "warning";
    default:
      return "brand";
  }
}

function driveTypeBadgeTone(type: DriveType | null): Tone {
  switch (type) {
    case "placement":
      return "brand";
    case "internship_convertible":
      return "accent";
    case "internship":
      return "warning";
    default:
      return "brand";
  }
}

/**
 * The four figures a reader scans first, in the same shape as `Fact` above.
 * Color-coded with subtle, consistent pastel accents for immediate recognition.
 */
function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "emerald" | "sky" | "brand" | "amber" | "neutral";
}) {
  const s = TILE_STYLES[tone] ?? TILE_STYLES.neutral;
  return (
    <div className={`min-w-0 rounded-xl border p-4 shadow-xs transition-colors ${s.container}`}>
      <span className={`text-xs font-bold uppercase tracking-wide ${s.label}`}>{label}</span>
      <div
        className={`mt-1 break-words font-heading text-sm font-bold [overflow-wrap:anywhere] ${s.value}`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * A snapshot value, read from the REAL envelope: `buildApplicationSnapshot`
 * nests everything under `profile`, with `academics` inside it.
 *
 * 🔴 2026-08-24: this used to read one level too shallow (`snapshot.academics`)
 * — the same defect that showed "CGPA 0" on shortlisting. The shallow reads
 * stay as fallbacks only.
 */
function fromSnapshot(envelope: Record<string, unknown>, key: string): string {
  const snapshot = (envelope.profile ?? envelope) as Record<string, unknown>;
  const academics = (snapshot.academics ?? snapshot) as Record<string, unknown>;
  const value = academics[key] ?? snapshot[key];
  return value === null || value === undefined ? "—" : String(value);
}

const STAGE_LABEL: Record<FunnelStageKey, string> = {
  applied: "Applied",
  shortlisted: "Shortlisted",
  in_rounds: "In rounds",
  offers: "Offers",
  not_selected: "Not selected",
};

export function DriveRecordPage({
  view,
  role,
  driveId,
  stage,
  headerAction,
  decide,
}: {
  view: DriveRecordView;
  role: AppRole;
  driveId: string;
  /** C8: the funnel number that linked here — `?stage=` on the route. */
  stage?: string | undefined;
  headerAction?: React.ReactNode;
  /** Optional approval callback for delivery heads reviewing submitted drives. */
  decide?:
    | ((
        driveId: string,
        current: DriveStatus,
        decision: PifDecision,
        driveType?: DriveType | null,
      ) => Promise<void>)
    | undefined;
}) {
  const { toast } = useToast();
  const [record, setRecord] = useState<DriveRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSnapshot, setOpenSnapshot] = useState<string | null>(null);
  const [audienceTab, setAudienceTab] = useState<"applied" | "eligible" | "cannot_apply">(
    "applied",
  );
  const [audienceSearch, setAudienceSearch] = useState("");
  const [audiencePage, setAudiencePage] = useState(0);
  const [audiencePageSize, setAudiencePageSize] = useState(25);
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [category, setCategory] = useState<OfferCategory | null>(null);
  const [reason, setReason] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [savingDecision, setSavingDecision] = useState(false);
  const [decisionSuccess, setDecisionSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const found = await view.record(driveId);
      if (found === null) setError("This drive does not exist, or you cannot see it.");
      else {
        setRecord(found);
        setError(null);
      }
    } catch {
      setError("Could not load this drive. Please try again.");
    }
  }, [view, driveId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDecision = useCallback(
    (kind: "approve" | "reject") => {
      if (record === null) return;
      const type = asDriveType(record.driveType);
      setCategory(
        requiredOfferCategoryFor(type) ??
          suggestOfferCategory(record.ctcMaxLpa ?? record.ctcMinLpa),
      );
      setReason("");
      setDecisionError(null);
      setDeciding(kind);
    },
    [record],
  );

  async function confirmDecision() {
    if (deciding === null || decide === undefined || savingDecision || record === null) return;
    const type = asDriveType(record.driveType);
    const intent: PifDecision =
      deciding === "approve"
        ? { decision: "approve", offerCategory: category ?? (undefined as never) }
        : { decision: "reject", reason: reason.trim() };

    const check = decidePif("submitted", intent, type);
    if (!check.ok) {
      setDecisionError(check.error);
      return;
    }

    setSavingDecision(true);
    try {
      await decide(record.id, "submitted", intent, type);
      setDeciding(null);
      const message =
        deciding === "approve"
          ? `Drive approved${category ? ` as ${offerCategoryLabel(category)}` : ""}.`
          : "Drive rejected.";
      setDecisionSuccess(message);
      toast({
        tone: deciding === "approve" ? "success" : "danger",
        title: deciding === "approve" ? "Drive approved" : "Drive rejected",
        description: `${record.companyName} — ${record.roleTitle}: ${message}`,
      });
      void load();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Could not save the decision.";
      setDecisionError(msg);
      toast({
        tone: "danger",
        title: deciding === "approve" ? "Could not approve drive" : "Could not reject drive",
        description: msg,
      });
    } finally {
      setSavingDecision(false);
    }
  }

  if (error !== null) {
    return (
      <Card className="border border-danger-500/30 bg-danger-50 p-5">
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      </Card>
    );
  }

  if (record === null) {
    return <LottieLoader size="fullscreen" message="Loading the drive…" />;
  }

  const staff = role !== "student";
  const driveType = asDriveType(record.driveType);
  /**
   * Whether this drive's visit still admits one more role. The visit, not just
   * this row: a new role attaches to the company event, so it is refused only
   * when every role under it is closed — the same rule the AE portfolio reads.
   */
  const visitStatuses: readonly DriveStatus[] = [
    record.status,
    ...record.siblingRoles.map((sibling) => sibling.status),
  ];
  const refusalPerRole = visitStatuses.map((status) => describeDriveFreeze("roles", status));
  const rolesRefused =
    refusalPerRole.length > 0 && refusalPerRole.every((sentence) => sentence !== null)
      ? (refusalPerRole[0] ?? null)
      : null;

  /**
   * C8 (2026-08-21, answer 5b): the list behind a clicked funnel number.
   * `filterFunnelStage` is the SAME arithmetic the count used, so the number
   * and this list cannot disagree. Staff only — the counts are theirs.
   */
  const activeStage: FunnelStageKey | null =
    staff && (FUNNEL_STAGES as readonly string[]).includes(stage ?? "")
      ? (stage as FunnelStageKey)
      : null;
  const stageApplicants =
    activeStage === null ? null : filterFunnelStage(record.applicants, activeStage);

  return (
    <div className="pb-24">
      <PageHeader
        title={`${record.companyName} — ${record.roleTitle}`}
        subtitle={[
          record.roleCategory === null ? null : AREA_LABEL[record.roleCategory],
          record.additionalDesignations.length === 0
            ? null
            : `also hiring: ${record.additionalDesignations.join(", ")}`,
          record.applicationStart ? `Application start: ${when(record.applicationStart)}` : null,
        ]
          .filter((part) => part !== null)
          .join(" · ")}
        actions={
          headerAction !== undefined ? (
            headerAction
          ) : canApproveDrive(role) && record.status === "submitted" ? (
            decide !== undefined ? (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => openDecision("approve")}>
                  Approve
                </Button>
                <Button size="sm" variant="danger" onClick={() => openDecision("reject")}>
                  Reject
                </Button>
              </div>
            ) : (
              <ButtonLink size="sm" to="/delivery-head/approvals">
                Review in approval queue
              </ButtonLink>
            )
          ) : canApproveDrive(role) && record.status === "approved" ? (
            <Badge tone="success">Approved — Awaiting Publishing</Badge>
          ) : canPublishDrive(role) &&
            (record.status === "approved" || record.status === "draft") ? (
            <ButtonLink size="sm" to={`/central/publish?drive=${record.id}`}>
              Publish
            </ButtonLink>
          ) : canPublishDrive(role) && record.status === "submitted" ? (
            <Badge tone="neutral">Submitted — Pending Delivery Head Approval</Badge>
          ) : canShortlistFromPortfolio(role) &&
            (record.status === "live" || record.status === "applications_closed") ? (
            <ButtonLink
              size="sm"
              variant="secondary"
              to={`/central/shortlisting?drive=${record.id}`}
            >
              Shortlist
            </ButtonLink>
          ) : canShortlistFromPortfolio(role) && record.status === "in_rounds" ? (
            <div className="flex items-center gap-2">
              <ButtonLink
                size="sm"
                variant="secondary"
                to={`/central/shortlisting?drive=${record.id}`}
              >
                Shortlist
              </ButtonLink>
              <ButtonLink size="sm" to={`/central/results?drive=${record.id}`}>
                Rounds & results →
              </ButtonLink>
            </div>
          ) : canShortlistFromPortfolio(role) && record.status === "completed" ? (
            <div className="flex items-center gap-2">
              <ButtonLink size="sm" variant="secondary" to={`/central/results?drive=${record.id}`}>
                Rounds & results
              </ButtonLink>
              <ButtonLink size="sm" to={`/central/offers?drive=${record.id}`}>
                Final selection
              </ButtonLink>
            </div>
          ) : staff && canRaiseDrive(role) ? (
            record.status === "submitted" ? (
              <Badge tone="neutral">Submitted for Approval</Badge>
            ) : rolesRefused === null ? (
              <ButtonLink
                size="sm"
                variant="ghost"
                to={`/ae/pif?companyName=${encodeURIComponent(record.companyName)}${
                  record.companyDriveId
                    ? `&companyDriveId=${encodeURIComponent(record.companyDriveId)}`
                    : ""
                }&tentativeDate=${encodeURIComponent(record.tentativeDate ?? "")}`}
              >
                + Add another role
              </ButtonLink>
            ) : (
              // A closed visit cannot take a fifth role onto it. The offer is
              // replaced by the reason, not removed: a missing button reads
              // as a defect, a refused one that says why reads as a rule.
              <p className="max-w-full break-words text-xs text-ink-500">
                {rolesRefused} No further roles can be raised.
              </p>
            )
          ) : undefined
        }
      />

      {activeStage !== null && stageApplicants !== null && (
        <section aria-label="Applicants by stage" className="mb-4">
          <Card className="p-5">
            <div className="mb-3 flex flex-nowrap scroll-bare overflow-x-auto pb-1 gap-1.5 sm:flex-wrap">
              {FUNNEL_STAGES.map((key) => {
                const count = filterFunnelStage(record.applicants, key).length;
                return key === activeStage ? (
                  <span
                    key={key}
                    aria-current="true"
                    className="rounded-full border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700"
                  >
                    {STAGE_LABEL[key]} ({count})
                  </span>
                ) : (
                  <Link
                    key={key}
                    to={`/drives/${driveId}?stage=${key}`}
                    className="rounded-full border border-field bg-surface px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {STAGE_LABEL[key]} ({count})
                  </Link>
                );
              })}
            </div>

            {stageApplicants.length === 0 ? (
              <p className="text-sm text-ink-500">
                Nobody is at “{STAGE_LABEL[activeStage]}” on this drive.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {stageApplicants.map((applicant) => (
                  <li
                    key={applicant.applicationId}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      <Link
                        to={`/students/${applicant.studentId}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {applicant.fullName}
                      </Link>{" "}
                      <span className="text-sm text-ink-500">
                        Roll {applicant.rollNumber}
                        {applicant.campus !== "" && ` · ${applicant.campus}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(record.status)}>{driveStatusLabel(record.status)}</Badge>
        {record.roleCategory !== null && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              roleCategoryStyle(record.roleCategory).badgeClass
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${roleCategoryStyle(record.roleCategory).dot}`}
            />
            {roleCategoryLabel(record.roleCategory)}
          </span>
        )}
        {/* UAT 2026-08-27: an internship's category IS its type. Two badges
            reading "Internship" are one fact wearing two colours. */}
        {record.offerCategory !== null &&
          !offerCategoryRestatesType(driveType, record.offerCategory) && (
            <Badge tone={offerCategoryBadgeTone(record.offerCategory)}>
              {offerCategoryLabel(record.offerCategory)}
            </Badge>
          )}
        {/* The domain's words, not `replaceAll("_", " ")` — which is where
            the lower-case "internship" in the screenshot came from. */}
        {driveType !== null && (
          <Badge tone={driveTypeBadgeTone(driveType)}>{driveTypeLabel(driveType)}</Badge>
        )}
      </div>

      {/* Quick Highlights — one tile shape, one type scale */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Package / CTC" value={renderCtc(record.ctcLabel)} tone="emerald" />
        <Tile label="Location" value={formatLocation(record.locations)} tone="brand" />
        <Tile label="Drive Mode" value={formatDriveMode(record.driveMode)} tone="brand" />
        <Tile
          label="Apply Deadline"
          value={record.applicationEnd ? when(record.applicationEnd) : "Open"}
          tone="amber"
        />
      </div>

      {/* Every section on one page, in one column. The tab bar that used to sit
          above this hid five of the nine sections behind a click and left a
          third of the page empty on the tabs whose sections fitted one column. */}
      <div className="mt-4 space-y-4">
        {(record.jobDescription !== "" || record.jobDescriptionUrl !== null) && (
          <Section title="Job description">
            {record.jobDescription !== "" && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800 break-words [overflow-wrap:anywhere]">
                {record.jobDescription}
              </p>
            )}
            {record.jobDescriptionUrl !== null && (
              <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-surface-muted p-3.5">
                <FileText className="size-5 shrink-0 text-brand-600" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {/* One affordance, named by its document. The row used to carry a
                        link to the PDF AND a second "PDF" button for the same file. */}
                  <a
                    href={record.jobDescriptionUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-w-0 items-center gap-1.5 break-words font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700 [overflow-wrap:anywhere]"
                  >
                    {record.jobDescriptionName ?? "Job description (PDF)"}
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                  </a>
                  <p className="text-xs text-ink-500">
                    Official document provided by recruiter — opens in a new tab
                  </p>
                </div>
              </div>
            )}
          </Section>
        )}

        <Section title="Eligibility as published">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="CGPA cutoff" value={record.eligibility.cgpaLabel} />
            <Fact label="10th standard" value={record.eligibility.tenthLabel} />
            <Fact label="12th standard" value={record.eligibility.twelfthLabel} />
            <Fact label="Arrears" value={record.eligibility.arrearsLabel} />
            <Fact label="Passing years" value={record.eligibility.passingYears.join(", ")} />
            <Fact
              label="Must-have skills"
              value={record.eligibility.mandatorySkills}
              className="sm:col-span-2 lg:col-span-3"
            />
            <Fact
              label="Degrees"
              value={record.eligibility.degrees.join(", ")}
              className="sm:col-span-2 lg:col-span-3"
            />
            <Fact
              label="Branches"
              value={record.eligibility.branches.join(", ")}
              className="sm:col-span-2 lg:col-span-3"
            />
            {/* College targeting is staff-internal; students do not see which campuses are targeted */}
            {staff && (
              <Fact
                label="Campuses"
                value={
                  record.eligibility.campuses.length === 0
                    ? "Open to all campuses"
                    : `Open to: ${record.eligibility.campuses.join(", ")}`
                }
                className="sm:col-span-2 lg:col-span-3"
              />
            )}
          </dl>
        </Section>

        <Section title="Selection process">
          {record.rounds.length === 0 ? (
            <p className="text-sm text-ink-500">No rounds declared yet.</p>
          ) : (
            <ol className="space-y-2">
              {record.rounds.map((round) => {
                const content = (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-sm text-ink-800 transition-colors hover:border-brand-400 hover:bg-brand-50/30">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Badge tone="brand">{round.sequence}</Badge>
                      <span className="min-w-0 flex-1 break-words font-medium [overflow-wrap:anywhere]">
                        <span className="font-semibold text-ink-900">Round {round.sequence}</span> —{" "}
                        {round.name}
                      </span>
                    </div>
                    {staff && (
                      <span className="text-xs font-semibold text-brand-600 shrink-0">
                        View round →
                      </span>
                    )}
                  </div>
                );
                return (
                  <li key={round.sequence}>
                    {staff ? (
                      <Link
                        to={`/central/results?drive=${record.id}`}
                        className="block focus:outline-hidden"
                      >
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        {/* CTC is the Package tile above — the same figure in the same words, so
            it is not repeated here. */}
        <Section title="Compensation">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Breakup" value={record.ctcBreakup} />
            <Fact label="Bond / service agreement" value={record.bondDetails} />
            <Fact
              label="Openings"
              value={record.openings === null ? "" : String(record.openings)}
            />
          </dl>
        </Section>

        <Section title="Where and when">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Locations" value={record.locations} />
            <Fact label="Mode" value={record.driveMode.replaceAll("_", " ")} />
            {/* Where the work actually happens, which is not the same question as
                the drive mode above: an on-campus drive can hire into a hybrid
                role. 0138; nothing said when the AE said nothing. */}
            <Fact
              label="Work type"
              value={record.workType === null ? "" : workTypeLabel(record.workType)}
            />
            {/* UAT 2026-08-21 item 2: worded by the domain; null hides it. */}
            <Fact label="Venue" value={record.venue ?? ""} />
            <Fact label="Applications open" value={when(record.applicationStart)} />
            <Fact label="Applications close" value={when(record.applicationEnd)} />
            <Fact label="Tentative drive date" value={when(record.tentativeDate)} />
            <Fact label="Shift" value={record.shift} />
            <Fact label="Joining" value={record.joining} />
          </dl>
        </Section>

        {staff && (
          <Section title={`Applicants & Student Audience (${record.applicants.length})`}>
            {(() => {
              const eligibleNotApplied = record.eligibleNotApplied ?? [];
              const cannotApply = record.cannotApply ?? [];

              const query = audienceSearch.trim().toLowerCase();

              const filteredApplied = record.applicants.filter((a) => {
                if (!query) return true;
                return (
                  a.fullName.toLowerCase().includes(query) ||
                  a.rollNumber.toLowerCase().includes(query) ||
                  a.campus.toLowerCase().includes(query)
                );
              });

              const filteredEligible = eligibleNotApplied.filter((e) => {
                if (!query) return true;
                return (
                  e.fullName.toLowerCase().includes(query) ||
                  e.rollNumber.toLowerCase().includes(query) ||
                  e.campus.toLowerCase().includes(query) ||
                  e.degree.toLowerCase().includes(query) ||
                  e.branch.toLowerCase().includes(query)
                );
              });

              const filteredCannotApply = cannotApply.filter((c) => {
                if (!query) return true;
                return (
                  c.fullName.toLowerCase().includes(query) ||
                  c.rollNumber.toLowerCase().includes(query) ||
                  c.campus.toLowerCase().includes(query) ||
                  c.degree.toLowerCase().includes(query) ||
                  c.branch.toLowerCase().includes(query) ||
                  (c.reason ?? "").toLowerCase().includes(query)
                );
              });

              const currentList =
                audienceTab === "applied"
                  ? filteredApplied
                  : audienceTab === "eligible"
                    ? filteredEligible
                    : filteredCannotApply;

              const pagedItems = currentList.slice(
                audiencePage * audiencePageSize,
                (audiencePage + 1) * audiencePageSize,
              );

              return (
                <div className="flex flex-col gap-4">
                  {/* Audience Sub-Navigation Tabs and Search */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAudienceTab("applied");
                          setAudiencePage(0);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                          audienceTab === "applied"
                            ? "bg-brand-600 text-white shadow-2xs"
                            : "bg-surface-muted text-ink-700 hover:bg-surface hover:text-ink-900 border border-line"
                        }`}
                      >
                        Applied ({record.applicants.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setAudienceTab("eligible");
                          setAudiencePage(0);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                          audienceTab === "eligible"
                            ? "bg-brand-600 text-white shadow-2xs"
                            : "bg-surface-muted text-ink-700 hover:bg-surface hover:text-ink-900 border border-line"
                        }`}
                      >
                        Eligible — Not Applied ({eligibleNotApplied.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setAudienceTab("cannot_apply");
                          setAudiencePage(0);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                          audienceTab === "cannot_apply"
                            ? "bg-brand-600 text-white shadow-2xs"
                            : "bg-surface-muted text-ink-700 hover:bg-surface hover:text-ink-900 border border-line"
                        }`}
                      >
                        Cannot Apply ({cannotApply.length})
                      </button>
                    </div>

                    <div className="relative w-full sm:w-64">
                      <Search
                        className="absolute left-2.5 top-2.5 size-3.5 text-ink-400"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        placeholder="Search by name, roll, campus..."
                        value={audienceSearch}
                        onChange={(e) => {
                          setAudienceSearch(e.target.value);
                          setAudiencePage(0);
                        }}
                        className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-3 text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* View 1: Applied */}
                  {audienceTab === "applied" &&
                    (filteredApplied.length === 0 ? (
                      <p className="py-6 text-center text-sm text-ink-500">
                        {record.applicants.length === 0
                          ? "No students have applied to this drive yet."
                          : "No applied students match your search."}
                      </p>
                    ) : (
                      <div className="scroll-bare overflow-x-auto rounded-lg border border-line">
                        <Table>
                          <TableHeader className="text-xs uppercase tracking-wide text-ink-500">
                            <TableRow className="border-line">
                              <TableHead className="pl-4">Student</TableHead>
                              <TableHead>Roll number</TableHead>
                              <TableHead>Campus</TableHead>
                              <TableHead>Applied</TableHead>
                              <TableHead className="pr-4 text-right">
                                <span className="sr-only">Snapshot</span>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className="bg-surface">
                            {(pagedItems as typeof filteredApplied).map((applicant) => {
                              const isOpen = openSnapshot === applicant.applicationId;
                              return (
                                <Fragment key={applicant.applicationId}>
                                  <TableRow className="border-line">
                                    <TableCell className="max-w-[200px] pl-4 break-words font-medium text-ink-900 [overflow-wrap:anywhere]">
                                      <Link
                                        to={`/students/${applicant.studentId}`}
                                        className="text-brand-600 hover:underline"
                                      >
                                        {applicant.fullName}
                                      </Link>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">
                                      {applicant.rollNumber}
                                    </TableCell>
                                    <TableCell className="max-w-[180px] break-words [overflow-wrap:anywhere]">
                                      {applicant.campus}
                                    </TableCell>
                                    <TableCell className="text-ink-600">
                                      {when(applicant.appliedAt)}
                                    </TableCell>
                                    <TableCell className="pr-4 text-right">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        aria-expanded={isOpen}
                                        aria-controls={`snapshot-${applicant.applicationId}`}
                                        onClick={() =>
                                          setOpenSnapshot(isOpen ? null : applicant.applicationId)
                                        }
                                      >
                                        {isOpen ? "Hide snapshot" : "View snapshot"}
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                  {isOpen && (
                                    <TableRow className="border-line hover:bg-transparent">
                                      <TableCell colSpan={5} className="p-0 pt-1 pb-4">
                                        <section
                                          id={`snapshot-${applicant.applicationId}`}
                                          aria-label={`Snapshot of ${applicant.fullName}`}
                                          className="rounded-lg bg-surface-muted p-4"
                                        >
                                          <p className="mb-2 flex items-start gap-1.5 text-xs font-semibold text-gold-800">
                                            <TriangleAlert
                                              className="mt-px size-3.5 shrink-0"
                                              aria-hidden="true"
                                            />
                                            The profile as it was AT APPLY TIME — what the recruiter
                                            received, never the live profile.
                                          </p>
                                          <dl className="grid gap-3 sm:grid-cols-3">
                                            <Fact
                                              label="CGPA"
                                              value={fromSnapshot(
                                                applicant.snapshot,
                                                "overallCgpa",
                                              )}
                                            />
                                            <Fact
                                              label="10th %"
                                              value={fromSnapshot(
                                                applicant.snapshot,
                                                "tenthPercentage",
                                              )}
                                            />
                                            <Fact
                                              label="12th %"
                                              value={fromSnapshot(
                                                applicant.snapshot,
                                                "twelfthPercentage",
                                              )}
                                            />
                                            <Fact
                                              label="Current arrears"
                                              value={fromSnapshot(
                                                applicant.snapshot,
                                                "currentArrears",
                                              )}
                                            />
                                            <Fact
                                              label="Degree"
                                              value={fromSnapshot(applicant.snapshot, "degree")}
                                            />
                                            <Fact
                                              label="Branch"
                                              value={fromSnapshot(applicant.snapshot, "branch")}
                                            />
                                          </dl>
                                        </section>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </Fragment>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    ))}

                  {/* View 2: Eligible Not Applied */}
                  {audienceTab === "eligible" &&
                    (filteredEligible.length === 0 ? (
                      <p className="py-6 text-center text-sm text-ink-500">
                        {eligibleNotApplied.length === 0
                          ? "All eligible students on targeted campuses have applied."
                          : "No eligible students match your search."}
                      </p>
                    ) : (
                      <div className="scroll-bare overflow-x-auto rounded-lg border border-line">
                        <Table>
                          <TableHeader className="text-xs uppercase tracking-wide text-ink-500">
                            <TableRow className="border-line">
                              <TableHead className="pl-4">Student</TableHead>
                              <TableHead>Roll number</TableHead>
                              <TableHead>Campus</TableHead>
                              <TableHead>Degree & Branch</TableHead>
                              <TableHead>CGPA</TableHead>
                              <TableHead className="pr-4 text-right">Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className="bg-surface">
                            {(pagedItems as typeof filteredEligible).map((student) => (
                              <TableRow key={student.studentId} className="border-line">
                                <TableCell className="max-w-[200px] pl-4 break-words font-medium text-ink-900 [overflow-wrap:anywhere]">
                                  <Link
                                    to={`/students/${student.studentId}`}
                                    className="text-brand-600 hover:underline"
                                  >
                                    {student.fullName}
                                  </Link>
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {student.rollNumber}
                                </TableCell>
                                <TableCell className="max-w-[180px] break-words [overflow-wrap:anywhere]">
                                  {student.campus}
                                </TableCell>
                                <TableCell className="text-xs text-ink-700">
                                  {student.degree} {student.branch ? `— ${student.branch}` : ""}
                                </TableCell>
                                <TableCell className="font-medium text-xs text-ink-900">
                                  {student.cgpa}
                                </TableCell>
                                <TableCell className="pr-4 text-right">
                                  <Badge tone="neutral">Not applied</Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}

                  {/* View 3: Cannot Apply */}
                  {audienceTab === "cannot_apply" &&
                    (filteredCannotApply.length === 0 ? (
                      <p className="py-6 text-center text-sm text-ink-500">
                        {cannotApply.length === 0
                          ? "All students on targeted campuses meet the criteria."
                          : "No ineligible students match your search."}
                      </p>
                    ) : (
                      <div className="scroll-bare overflow-x-auto rounded-lg border border-line">
                        <Table>
                          <TableHeader className="text-xs uppercase tracking-wide text-ink-500">
                            <TableRow className="border-line">
                              <TableHead className="pl-4">Student</TableHead>
                              <TableHead>Roll number</TableHead>
                              <TableHead>Campus</TableHead>
                              <TableHead>Degree & Branch</TableHead>
                              <TableHead>CGPA</TableHead>
                              <TableHead className="pr-4 text-right">Reason Cannot Apply</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className="bg-surface">
                            {(pagedItems as typeof filteredCannotApply).map((student) => (
                              <TableRow key={student.studentId} className="border-line">
                                <TableCell className="max-w-[200px] pl-4 break-words font-medium text-ink-900 [overflow-wrap:anywhere]">
                                  <Link
                                    to={`/students/${student.studentId}`}
                                    className="text-brand-600 hover:underline"
                                  >
                                    {student.fullName}
                                  </Link>
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {student.rollNumber}
                                </TableCell>
                                <TableCell className="max-w-[180px] break-words [overflow-wrap:anywhere]">
                                  {student.campus}
                                </TableCell>
                                <TableCell className="text-xs text-ink-700">
                                  {student.degree} {student.branch ? `— ${student.branch}` : ""}
                                </TableCell>
                                <TableCell className="font-medium text-xs text-ink-900">
                                  {student.cgpa}
                                </TableCell>
                                <TableCell className="pr-4 text-right">
                                  <span className="inline-flex items-center rounded-full bg-danger-50 text-danger-700 border border-danger-200/80 px-2.5 py-0.5 text-[11px] font-medium">
                                    {student.reason}
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}

                  {/* Table Pager */}
                  {currentList.length > audiencePageSize && (
                    <TablePager
                      page={audiencePage}
                      pageSize={audiencePageSize}
                      total={currentList.length}
                      unit="students"
                      onPage={setAudiencePage}
                      onPageSize={setAudiencePageSize}
                    />
                  )}
                </div>
              );
            })()}
          </Section>
        )}

        {record.siblingRoles.length > 0 && (
          <Section title="Other Roles in This Drive">
            <p className="mb-3 text-sm text-ink-600">
              This company is hiring for {record.siblingRoles.length + 1} roles under the same
              recruitment drive.
            </p>
            <ul className="space-y-2">
              {record.siblingRoles.map((sibling) => (
                <li
                  key={sibling.driveId}
                  className="rounded-lg border border-line bg-surface-muted p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 max-w-full">
                      <Link
                        to={`/drives/${sibling.driveId}`}
                        className="font-semibold text-brand-600 hover:underline break-words"
                      >
                        {sibling.roleTitle || "Unnamed role"}
                      </Link>
                      {sibling.driveType !== null && (
                        <span className="ml-2">
                          <Badge tone={driveTypeTone(asDriveType(sibling.driveType))}>
                            {driveTypeLabel(asDriveType(sibling.driveType))}
                          </Badge>
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm shrink-0">
                      <Badge tone={driveStatusTone(sibling.status)}>
                        {driveStatusLabel(sibling.status)}
                      </Badge>
                      <span className="text-ink-600">
                        {sibling.ctcLabel === "" ? "Package not stated" : sibling.ctcLabel}
                      </span>
                      {sibling.stipendLabel !== null && (
                        <span className="text-ink-600">{sibling.stipendLabel}</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {/* AE-only: the tab used to hide this from other roles, which is the
            same as the section's own guard. */}
        {role === "account_executive" && (
          <Section title="Recruiter contacts — visible to you alone">
            {record.recruiters.length === 0 ? (
              // A5 (UAT 2026-08-19): an honest "none", with the routing stated.
              <p className="text-sm text-ink-700">
                No contact recorded for this company — communication goes through the{" "}
                <strong>Central Placement Coordinator</strong>.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {record.recruiters.map((contact) => (
                  <dl
                    // Contacts have no id of their own; the four fields together are the identity.
                    key={`${contact.name}|${contact.designation}|${contact.email}|${contact.phone}`}
                    className="grid gap-2.5 rounded-lg border border-line p-3"
                  >
                    <Fact label="Name" value={contact.name} />
                    <Fact label="Designation" value={contact.designation} />
                    <Fact label="Email" value={contact.email} className="break-all" />
                    <Fact label="Phone" value={contact.phone} />
                  </dl>
                ))}
              </div>
            )}
          </Section>
        )}

        {staff && (
          <Section title="Provenance">
            <p className="text-sm leading-relaxed text-ink-700 break-words [overflow-wrap:anywhere]">
              Raised by <strong>{record.provenance.raisedBy ?? "—"}</strong> ·{" "}
              {when(record.provenance.raisedAt)}
              {record.provenance.approvedBy !== null && (
                <>
                  <br />→ Approved by <strong>{record.provenance.approvedBy}</strong> ·{" "}
                  {when(record.provenance.approvedAt)}
                </>
              )}
              {record.provenance.publishedBy !== null && (
                <>
                  <br />→ Published by <strong>{record.provenance.publishedBy}</strong> ·{" "}
                  {when(record.provenance.publishedAt)}
                </>
              )}
            </p>
            <p className="mt-2 text-xs italic text-ink-500">
              This page edits nothing. Actions stay on their own screens.
            </p>
          </Section>
        )}
      </div>

      {canApproveDrive(role) && record.status === "submitted" && decide !== undefined && (
        <Bar>
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-500 sm:inline">
            Awaiting your approval
          </span>
          <Button size="sm" onClick={() => openDecision("approve")}>
            Approve…
          </Button>
          <Button size="sm" variant="danger" onClick={() => openDecision("reject")}>
            Reject…
          </Button>
        </Bar>
      )}

      {decisionSuccess !== null && (
        <Bar>
          <Badge tone="success">{decisionSuccess}</Badge>
        </Bar>
      )}

      {deciding !== null && (
        <AlertDialog open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deciding === "approve"
                  ? `Approve ${record.companyName} — ${record.roleTitle}`
                  : `Reject ${record.companyName} — ${record.roleTitle}`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deciding === "approve"
                  ? "Choose the offer category. It decides the student allowance (§3.3) and cannot be changed later."
                  : "State the reason for rejection. Rejection is permanent (§3.1); the PIF cannot be resubmitted."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {decisionError !== null && (
              <p role="alert" className="rounded-card bg-danger-50 p-3 text-sm text-danger-700">
                {decisionError}
              </p>
            )}

            {deciding === "approve" ? (
              <div>
                <label
                  htmlFor="record-offer-category"
                  className="mb-1 block text-sm font-medium text-ink-900"
                >
                  <span>Offer category</span>
                  <span className="ml-0.5 font-bold text-danger-500" aria-hidden="true">
                    *
                  </span>
                  <span className="sr-only"> (required)</span>
                </label>
                <select
                  id="record-offer-category"
                  value={category ?? ""}
                  onChange={(e) => setCategory(e.target.value as OfferCategory)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900"
                >
                  <option value="" disabled>
                    Choose a category…
                  </option>
                  {offerCategoriesFor(asDriveType(record.driveType)).map((c) => (
                    <option key={c} value={c}>
                      {offerCategoryLabel(c)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-amber-700">
                  {requiredOfferCategoryFor(asDriveType(record.driveType)) !== null
                    ? "This drive is an internship, so Internship is the only category it can carry. This cannot be changed later."
                    : category === null
                      ? "No CTC on this PIF, so nothing is suggested — choose the category. This cannot be changed later."
                      : "Suggested from the CTC. This cannot be changed later."}
                </p>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="record-rejection-reason"
                  className="mb-1 block text-sm font-medium text-ink-900"
                >
                  <span>Rejection reason</span>
                  <span className="ml-0.5 font-bold text-danger-500" aria-hidden="true">
                    *
                  </span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="record-rejection-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Compensation below organisation threshold"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900"
                />
                <p className="mt-1 text-xs text-ink-500">
                  Required. Rejection is final — the PIF cannot be edited or resubmitted.
                </p>
              </div>
            )}

            <AlertDialogFooter>
              <Button variant="secondary" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button
                variant={deciding === "approve" ? "primary" : "danger"}
                isLoading={savingDecision}
                onClick={() => void confirmDecision()}
              >
                {deciding === "approve" ? "Confirm — approve" : "Confirm — reject permanently"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
