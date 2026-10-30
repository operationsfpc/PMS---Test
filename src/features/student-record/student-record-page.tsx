import { DrilldownModal } from "@components/drilldown-modal";
import { Badge, Button, ButtonAnchor, ButtonLink, Card, PageHeader } from "@components/ui";
import { boardLabel, type SchoolBoard } from "@domain/boards";
import { HOLD_KIND_LABELS, holdStanding, holdWindowLine } from "@domain/holds";
import { describeMarks } from "@domain/marks";
import { type OfferCategory, offerCategoryLabel } from "@domain/offer-category";
import { SKILL_SCORE_MAX } from "@domain/skills";
import { extractOriginalFilename } from "@domain/storage-path";
import {
  DRIVE_TYPES,
  type DriveType,
  type OfferSource,
  type ParticipationStatus,
  ROLE_CATEGORIES,
  type RoleCategory,
  type SrfStatus,
} from "@domain/types";
import type { Hold, HoldsView } from "@lib/holds-view";
import { useAsyncAction } from "@lib/use-async-action";
import {
  ArrowLeft,
  Briefcase,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  Globe,
  GraduationCap,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

export interface StudentRecordSemester {
  readonly semesterNumber: number;
  readonly cgpa: number;
  readonly verified: boolean;
}

export interface StudentRecordSkill {
  readonly skill: string;
  readonly score: number;
}

export interface StudentRecordApplication {
  readonly applicationId: string;
  readonly driveId: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly appliedAt: string | null;
  readonly shortlisted: boolean;
  readonly hasOffer: boolean;
}

export interface StudentRecordOffer {
  readonly id: string;
  readonly driveId: string | null;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly driveType: DriveType;
  readonly offerCategory: OfferCategory | null;
  readonly ctcLpa: number | null;
  readonly stipendMonthly: number | null;
  readonly declaredAt: string;
  readonly source: OfferSource;
  readonly letterUrl: string | null;
  readonly letterFileName: string | null;
}

export interface StudentRecordResume {
  readonly id: string;
  readonly roleCategory: RoleCategory;
  readonly storagePath: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
  readonly downloadUrl: string | null;
}

export interface StudentRecordPlacement {
  readonly companyName: string;
  readonly roleTitle: string | null;
  /** Null when the offer records no annual figure (0070). */
  readonly ctcLpa: number | null;
  readonly offerCategory: OfferCategory | null;
  readonly source: OfferSource;
}

export interface StudentRecord {
  readonly studentId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly email: string;
  readonly mobile: string | null;
  readonly whatsapp?: string | null;
  readonly alternateContact?: string | null;
  readonly campusName: string;
  readonly degree: string;
  readonly branch: string;
  readonly passingYear: number;
  readonly srfStatus: SrfStatus;
  readonly participationStatus: ParticipationStatus;
  // Academics
  readonly tenthPercentage: number | null;
  readonly tenthInstitution?: string | null;
  readonly tenthBoard?: SchoolBoard | null;
  readonly twelfthPercentage: number | null;
  readonly twelfthInstitution?: string | null;
  readonly twelfthBoard?: SchoolBoard | null;
  readonly diplomaInstitution?: string | null;
  readonly diplomaMarks?: number | null;
  readonly overallCgpa?: number | null;
  readonly currentArrears?: number;
  readonly historyOfArrears?: number;
  readonly semesters: readonly StudentRecordSemester[];
  // Skills & Preferences
  readonly skills: readonly StudentRecordSkill[];
  readonly rolePreferences: readonly RoleCategory[];
  readonly driveTypePreferences?: readonly DriveType[];
  // Portfolio
  readonly technicalSkills?: string | null;
  readonly areasOfInterest?: string | null;
  readonly areasOfExpertise?: string | null;
  readonly projects?: string | null;
  readonly certifications?: string | null;
  readonly achievements?: string | null;
  // Professional Links
  readonly linkedinUrl?: string | null;
  readonly githubUrl?: string | null;
  readonly leetcodeUrl?: string | null;
  readonly hackerrankUrl?: string | null;
  // Resumes & Applications & Offers
  readonly resumes?: readonly StudentRecordResume[];
  readonly applications: readonly StudentRecordApplication[];
  readonly offers?: readonly StudentRecordOffer[];
  readonly placement: StudentRecordPlacement | null;
}

export interface StudentRecordView {
  /** Null when the row does not exist or RLS refuses it — indistinguishable BY DESIGN. */
  record(studentId: string): Promise<StudentRecord | null>;
  updatePreferences?(
    studentId: string,
    roleCategories: readonly RoleCategory[],
    driveTypePreferences: readonly DriveType[],
  ): Promise<void>;
  uploadResume?(studentId: string, roleCategory: RoleCategory, file: File): Promise<void>;
}

const SRF_LABEL: Record<SrfStatus, string> = {
  invited: "Not started",
  registered: "In progress",
  srf_submitted: "Submitted",
  srf_approved: "Verified",
  srf_rejected: "Returned",
};

export const AREA_LABEL: Record<string, string> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

export const RESUME_TRACK_LABEL: Record<RoleCategory, string> = {
  software_technical: "Software & Technical CV",
  technical_support_it_ops: "IT Operations & Support CV",
  digital_marketing: "Digital Marketing CV",
  sales: "Sales & Client Track CV",
  operations_business: "Operations & Business CV",
};

export const DRIVE_TYPE_LABEL: Record<DriveType, string> = {
  placement: "Placement (Full-time)",
  internship_convertible: "Internship (Convertible)",
  internship: "Internship only",
};

const onDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const dayAfter = (iso: string) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StudentRecordPage({
  studentId,
  view,
  holds,
  release,
  canManagePreferences = false,
}: {
  studentId: string;
  view: StudentRecordView;
  holds?: HoldsView;
  release?: (holdId: string, note: string | null) => Promise<void>;
  canManagePreferences?: boolean;
}) {
  const [record, setRecord] = useState<StudentRecord | null | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [pending, setPending] = useState<Hold | null>(null);
  const [evidence, setEvidence] = useState<{
    readonly offer: string | null;
    readonly declaration: string | null;
  }>({ offer: null, declaration: null });
  const [pastHolds, setPastHolds] = useState<readonly Hold[]>([]);
  const [holdProblem, setHoldProblem] = useState<string | null>(null);
  const [orderUrl, setOrderUrl] = useState<string | null>(null);
  const [lifting, setLifting] = useState(false);
  const [releaseNote, setReleaseNote] = useState("");
  const [extending, setExtending] = useState(false);
  const [extendDate, setExtendDate] = useState("");
  const [declining, setDeclining] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [reload, setReload] = useState(0);

  // Preference management modal state
  const [isPrefModalOpen, setIsPrefModalOpen] = useState(false);
  const [editRoleCats, setEditRoleCats] = useState<RoleCategory[]>([]);
  const [editDriveTypes, setEditDriveTypes] = useState<DriveType[]>([]);
  const [prefSaveError, setPrefSaveError] = useState<string | null>(null);

  // Resume upload state
  const [uploadCategory, setUploadCategory] = useState<RoleCategory | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const actions = useAsyncAction();
  const navigate = useNavigate();
  const location = useLocation();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-runs the pair on purpose
  useEffect(() => {
    let live = true;
    view.record(studentId).then(
      (next) => {
        if (live) {
          setRecord(next);
          setFailure(null);
        }
      },
      () => {
        if (live) setFailure("Could not load this student record. Please try again.");
      },
    );
    return () => {
      live = false;
    };
  }, [view, studentId, reload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-runs the read on purpose
  useEffect(() => {
    if (holds === undefined) return;
    let live = true;

    Promise.all([
      holds.live(studentId),
      holds.pendingFor(studentId),
      holds.history(studentId),
    ]).then(
      ([current, request, every]) => {
        if (!live) return;
        setHold(current);
        setPending(request);
        setPastHolds(every.filter((past) => past.releasedAt !== null));
        setHoldProblem(null);

        const path = current?.documentPath ?? null;
        setOrderUrl(null);
        if (path !== null) {
          void holds.orderUrl(path).then((url) => {
            if (live) setOrderUrl(url);
          });
        }

        setEvidence({ offer: null, declaration: null });
        if (request?.documentPath != null) {
          void holds.evidenceUrl("offer-letters", request.documentPath).then((url) => {
            if (live) setEvidence((seen) => ({ ...seen, offer: url }));
          });
        }
        if (request?.declarationPath != null) {
          void holds.evidenceUrl("declarations", request.declarationPath).then((url) => {
            if (live) setEvidence((seen) => ({ ...seen, declaration: url }));
          });
        }
      },
      (cause: unknown) => {
        if (!live) return;
        setHoldProblem(
          cause instanceof Error && cause.message !== ""
            ? cause.message
            : "Could not read whether this student is on a hold.",
        );
      },
    );

    return () => {
      live = false;
    };
  }, [holds, studentId, reload]);

  function openPreferencesModal() {
    if (!record) return;
    setEditRoleCats([...(record.rolePreferences ?? [])]);
    setEditDriveTypes([...(record.driveTypePreferences ?? [])]);
    setPrefSaveError(null);
    setIsPrefModalOpen(true);
  }

  async function savePreferences() {
    const update = view.updatePreferences;
    if (!record || !update) return;
    setPrefSaveError(null);
    try {
      await actions.run(() => update(record.studentId, editRoleCats, editDriveTypes));
      setIsPrefModalOpen(false);
      setReload((c) => c + 1);
    } catch (err) {
      setPrefSaveError(err instanceof Error ? err.message : "Failed to update student preferences");
    }
  }

  function triggerResumeUpload(category: RoleCategory) {
    setUploadCategory(category);
    setUploadError(null);
    setUploadSuccess(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const upload = view.uploadResume;
    if (!file || !uploadCategory || !record || !upload) return;

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setUploadError("Only PDF files are permitted for resumes.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Resume file size must be under 5 MB.");
      return;
    }

    try {
      setUploadError(null);
      await actions.run(() => upload(record.studentId, uploadCategory, file));
      setUploadSuccess(`Resume for ${AREA_LABEL[uploadCategory]} updated successfully!`);
      setReload((c) => c + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload resume");
    }
  }

  async function lift() {
    if (hold === null || release === undefined) return;
    const note = releaseNote.trim() === "" ? null : releaseNote.trim();
    if (await actions.run(() => release(hold.id, note))) {
      setLifting(false);
      setReleaseNote("");
      setReload((count) => count + 1);
    }
  }

  async function extendHold() {
    if (hold === null || holds === undefined) return;
    if (await actions.run(() => holds.extend(hold.id, extendDate))) {
      setExtending(false);
      setExtendDate("");
      setReload((count) => count + 1);
    }
  }

  async function confirmRequest() {
    if (pending === null || holds === undefined) return;
    if (await actions.run(() => holds.confirm(pending.id))) {
      setReload((count) => count + 1);
    }
  }

  async function declineRequest() {
    if (pending === null || release === undefined) return;
    const note = declineNote.trim() === "" ? null : declineNote.trim();
    if (await actions.run(() => release(pending.id, note))) {
      setDeclining(false);
      setDeclineNote("");
      setReload((count) => count + 1);
    }
  }

  const back =
    location.key === "default" ? (
      <ButtonLink variant="secondary" size="sm" to="/">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Overview
      </ButtonLink>
    ) : (
      <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back
      </Button>
    );

  if (record === undefined) {
    if (failure !== null) {
      return (
        <Card className="border border-danger-500/30 bg-danger-50 p-5">
          <p role="alert" className="text-sm text-danger-700">
            {failure}
          </p>
          <div className="mt-4">{back}</div>
        </Card>
      );
    }

    return (
      <p role="status" className="text-sm text-ink-500">
        Loading the student record…
      </p>
    );
  }

  if (record === null) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-700">
          This student record does not exist, or you cannot read it.
        </p>
        <div className="mt-4">{back}</div>
      </Card>
    );
  }

  // Safe variables with fallbacks
  const rolePreferences = record.rolePreferences ?? [];
  const driveTypePreferences = record.driveTypePreferences ?? [];
  const resumes = record.resumes ?? [];
  const offers = record.offers ?? [];
  const applications = record.applications ?? [];
  const semesters = record.semesters ?? [];
  const skills = record.skills ?? [];
  const currentArrears = record.currentArrears ?? 0;
  const historyOfArrears = record.historyOfArrears ?? 0;

  const today = new Date();
  const standing = hold === null ? null : holdStanding(hold, today);
  const badgeRepeatsHold = hold !== null && record.participationStatus === "on_hold";
  const hasStaffControls = canManagePreferences || view.updatePreferences !== undefined;

  return (
    <div className="space-y-6">
      {/* Hidden file input for staff resume upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelected}
        accept="application/pdf,.pdf"
        className="hidden"
      />

      {/* Header */}
      <div>
        <PageHeader
          title={record.fullName}
          subtitle={`Roll ${record.rollNumber} · ${record.campusName}`}
          actions={
            <div className="flex items-center gap-2">
              {hasStaffControls && (
                <Button variant="secondary" size="sm" onClick={openPreferencesModal}>
                  <Edit2 className="mr-1.5 size-3.5" />
                  Edit Preferences
                </Button>
              )}
              {back}
            </div>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={record.srfStatus === "srf_approved" ? "success" : "neutral"}>
            Registration: {SRF_LABEL[record.srfStatus]}
          </Badge>
          {record.participationStatus !== "active" && !badgeRepeatsHold && (
            <Badge tone="warning">{record.participationStatus.replaceAll("_", " ")}</Badge>
          )}
          {driveTypePreferences.length > 0 && (
            <span className="text-xs text-ink-500">
              Open to: {driveTypePreferences.map((t) => DRIVE_TYPE_LABEL[t] ?? t).join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* Feedback banners */}
      {uploadError && (
        <div
          role="alert"
          className="rounded-lg border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          {uploadError}
        </div>
      )}
      {uploadSuccess && (
        <div
          role="status"
          className="rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-sm text-success-700"
        >
          {uploadSuccess}
        </div>
      )}
      {holdProblem !== null && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          {holdProblem}
        </p>
      )}

      {/* Top Quick Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3.5 text-center">
          <span className="text-xs font-medium text-ink-500">Overall CGPA</span>
          <p className="mt-1 font-heading text-xl font-bold text-ink-900">
            {record.overallCgpa != null ? describeMarks(record.overallCgpa, "cgpa") : "—"}
          </p>
          <span className="text-[11px] text-ink-400">Scale of 10</span>
        </Card>
        <Card className="p-3.5 text-center">
          <span className="text-xs font-medium text-ink-500">Standing Arrears</span>
          <p
            className={`mt-1 font-heading text-xl font-bold ${
              currentArrears > 0 ? "text-amber-600" : "text-emerald-600"
            }`}
          >
            {currentArrears}
          </p>
          <span className="text-[11px] text-ink-400">
            {currentArrears > 0 ? "Action required" : "Zero active"}
          </span>
        </Card>
        <Card className="p-3.5 text-center">
          <span className="text-xs font-medium text-ink-500">History Arrears</span>
          <p className="mt-1 font-heading text-xl font-bold text-ink-900">{historyOfArrears}</p>
          <span className="text-[11px] text-ink-400">Total recorded</span>
        </Card>
        <Card className="p-3.5 text-center">
          <span className="text-xs font-medium text-ink-500">10th / 12th Marks</span>
          <p className="mt-1 font-heading text-sm font-bold text-ink-900">
            {record.tenthPercentage != null ? `${record.tenthPercentage}%` : "—"} /{" "}
            {record.twelfthPercentage != null ? `${record.twelfthPercentage}%` : "—"}
          </p>
          <span className="text-[11px] text-ink-400">Class X / XII</span>
        </Card>
        <Card className="p-3.5 text-center">
          <span className="text-xs font-medium text-ink-500">Offers & Internships</span>
          <p className="mt-1 font-heading text-xl font-bold text-brand-700">
            {offers.length > 0
              ? `${offers.length} Offer${offers.length > 1 ? "s" : ""}`
              : record.placement
                ? "1 Placed"
                : "0"}
          </p>
          <span className="text-[11px] text-ink-400">
            {offers.length > 0 || record.placement ? "Outcome secured" : "Unplaced"}
          </span>
        </Card>
        <Card className="p-3.5 text-center">
          <span className="text-xs font-medium text-ink-500">Applications</span>
          <p className="mt-1 font-heading text-xl font-bold text-ink-900">{applications.length}</p>
          <span className="text-[11px] text-ink-400">Campus drives</span>
        </Card>
      </div>

      {/* Holds Section — Exactly preserved for RLS & Hold Management rules */}
      {(hold !== null || pending !== null || pastHolds.length > 0) && (
        <section aria-label="Placement hold" className="mb-4 flex flex-col gap-3">
          {pending !== null && (
            <Card className="border-violet-300 bg-violet-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-heading text-lg font-bold text-ink-900">
                  Requested — {HOLD_KIND_LABELS[pending.kind]}
                </h2>
                <Badge tone="accent">Awaiting confirmation</Badge>
              </div>

              <p className="mt-2 break-words text-sm text-ink-900 [overflow-wrap:anywhere]">
                {pending.reason}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {holdWindowLine(pending, today)} · requested {onDate(pending.heldAt)}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                Their drives stay open until you confirm this. Confirming closes them.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {pending.documentPath !== null &&
                  (evidence.offer === null ? (
                    <span className="min-w-0 break-words text-sm text-ink-500 [overflow-wrap:anywhere]">
                      Offer letter on file: {extractOriginalFilename(pending.documentPath)}
                    </span>
                  ) : (
                    <ButtonAnchor
                      href={evidence.offer}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Open the offer letter — ${extractOriginalFilename(pending.documentPath)}`}
                    >
                      Offer letter
                    </ButtonAnchor>
                  ))}
                {pending.declarationPath !== null &&
                  (evidence.declaration === null ? (
                    <span className="min-w-0 break-words text-sm text-ink-500 [overflow-wrap:anywhere]">
                      Declaration on file: {extractOriginalFilename(pending.declarationPath)}
                    </span>
                  ) : (
                    <ButtonAnchor
                      href={evidence.declaration}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Open the signed declaration — ${extractOriginalFilename(pending.declarationPath)}`}
                    >
                      Signed declaration
                    </ButtonAnchor>
                  ))}
              </div>

              {release !== undefined && (
                <div className="mt-4">
                  {declining ? (
                    <div className="flex flex-col gap-2">
                      <label htmlFor="decline-note" className="text-sm font-medium text-ink-700">
                        Why are you declining?{" "}
                        <span className="font-normal text-ink-500">(optional)</span>
                      </label>
                      <textarea
                        id="decline-note"
                        rows={2}
                        value={declineNote}
                        onChange={(e) => setDeclineNote(e.target.value)}
                        placeholder="The letter names a different student. Ask for a signed copy."
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="danger"
                          isLoading={actions.isPending()}
                          onClick={() => void declineRequest()}
                        >
                          Decline request
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={actions.busy}
                          onClick={() => setDeclining(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button isLoading={actions.isPending()} onClick={() => void confirmRequest()}>
                        Confirm hold
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setDeclining(true)}>
                        Decline request
                      </Button>
                    </div>
                  )}

                  {actions.error !== null && (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700"
                    >
                      {actions.error}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {hold !== null && (
            <Card className="border-gold-300 bg-gold-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-heading text-lg font-bold text-ink-900">
                  On hold — {HOLD_KIND_LABELS[hold.kind]}
                </h2>
                <Badge tone={standing === "overdue" ? "danger" : "warning"}>
                  {standing === "overdue" ? "Review overdue" : "In force"}
                </Badge>
              </div>

              <p className="mt-2 break-words text-sm text-ink-900 [overflow-wrap:anywhere]">
                {hold.reason}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {holdWindowLine(hold, today)}
                {hold.heldBy !== null && ` · placed by ${hold.heldBy}`} · placed{" "}
                {onDate(hold.heldAt)}
              </p>

              {hold.documentPath !== null && (
                <p className="mt-3 flex flex-wrap items-center gap-2">
                  {orderUrl === null ? (
                    <span className="min-w-0 break-words text-sm text-ink-500 [overflow-wrap:anywhere]">
                      Order on file: {extractOriginalFilename(hold.documentPath)}
                    </span>
                  ) : (
                    <ButtonAnchor
                      href={orderUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Open the hold order — ${extractOriginalFilename(hold.documentPath)}`}
                    >
                      Hold order
                    </ButtonAnchor>
                  )}
                  <span className="text-xs text-ink-500">The student cannot open this file.</span>
                </p>
              )}

              {release !== undefined && (
                <div className="mt-4">
                  {lifting ? (
                    <div className="flex flex-col gap-2">
                      <label htmlFor="release-note" className="text-sm font-medium text-ink-700">
                        What cleared it?{" "}
                        <span className="font-normal text-ink-500">(optional)</span>
                      </label>
                      <textarea
                        id="release-note"
                        rows={2}
                        value={releaseNote}
                        onChange={(e) => setReleaseNote(e.target.value)}
                        placeholder="Cleared with accounts on 3 Nov — receipt filed."
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="danger"
                          isLoading={actions.isPending()}
                          onClick={() => void lift()}
                        >
                          Release hold
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={actions.busy}
                          onClick={() => setLifting(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : extending ? (
                    <div className="flex flex-col gap-2">
                      <label htmlFor="extend-date" className="text-sm font-medium text-ink-700">
                        Extend the review to
                      </label>
                      <input
                        id="extend-date"
                        type="date"
                        min={dayAfter(hold.endsAt)}
                        value={extendDate}
                        onChange={(e) => setExtendDate(e.target.value)}
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900"
                      />
                      <p className="text-xs text-ink-500">
                        Only forward — pulling a review earlier is what Release is for. The old date
                        stays in the audit log.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          isLoading={actions.isPending()}
                          disabled={extendDate === "" || extendDate <= hold.endsAt}
                          onClick={() => void extendHold()}
                        >
                          Extend review date
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={actions.busy}
                          onClick={() => setExtending(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="danger" size="sm" onClick={() => setLifting(true)}>
                        Release hold
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setExtending(true)}>
                        Extend review date
                      </Button>
                    </div>
                  )}

                  {actions.error !== null && (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700"
                    >
                      {actions.error}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {pastHolds.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-2 font-heading text-lg font-bold text-ink-900">Earlier holds</h2>
              <ul className="divide-y divide-line text-sm">
                {pastHolds.map((past) => (
                  <li key={past.id} className="py-2">
                    <p className="font-medium text-ink-900">{HOLD_KIND_LABELS[past.kind]}</p>
                    <p className="break-words text-xs text-ink-500 [overflow-wrap:anywhere]">
                      {past.reason} · {holdWindowLine(past, today)}
                      {past.releasedBy !== null && ` by ${past.releasedBy}`}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Columns: Core History & Records */}
        <div className="space-y-6 lg:col-span-2">
          {/* Offers & Placement Card */}
          <section aria-label="Placement">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Briefcase className="size-5 text-brand-600" />
                  <h2 className="font-heading text-lg font-bold text-ink-900">
                    Offers & Internships
                  </h2>
                </div>
                {record.placement !== null && (
                  <Badge tone="success">Primary Placement Active</Badge>
                )}
              </div>

              {offers.length === 0 && record.placement === null ? (
                <p className="text-sm text-ink-500">Not placed.</p>
              ) : (
                <div className="space-y-3">
                  {offers.length > 0 ? (
                    <div className="divide-y divide-line rounded-lg border border-line">
                      {offers.map((offer) => (
                        <div
                          key={offer.id}
                          className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-heading text-base font-bold text-ink-900">
                                {offer.companyName}
                              </h3>
                              <Badge
                                tone={
                                  offer.driveType === "placement"
                                    ? "success"
                                    : offer.driveType === "internship_convertible"
                                      ? "accent"
                                      : "brand"
                                }
                              >
                                {DRIVE_TYPE_LABEL[offer.driveType] ?? offer.driveType}
                              </Badge>
                              {offer.source === "self_placed" && (
                                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                                  Self-placed
                                </span>
                              )}
                              {offer.offerCategory && (
                                <Badge tone="brand">
                                  {offerCategoryLabel(offer.offerCategory)}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-ink-700">
                              {offer.roleTitle ?? "Role title not recorded"}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                              {offer.ctcLpa != null && offer.ctcLpa > 0 && (
                                <span className="font-semibold text-brand-700">
                                  ₹{offer.ctcLpa} LPA
                                </span>
                              )}
                              {offer.stipendMonthly != null && offer.stipendMonthly > 0 && (
                                <span className="font-semibold text-emerald-700">
                                  ₹{offer.stipendMonthly.toLocaleString("en-IN")} / month
                                </span>
                              )}
                              <span>Declared on {onDate(offer.declaredAt)}</span>
                            </div>
                          </div>

                          {offer.letterUrl && (
                            <ButtonAnchor
                              href={offer.letterUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              size="sm"
                              className="shrink-0"
                            >
                              <Download className="mr-1.5 size-3.5" />
                              Offer Letter
                            </ButtonAnchor>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    record.placement && (
                      <div className="text-sm">
                        <p className="break-words font-medium text-ink-900 [overflow-wrap:anywhere]">
                          {record.placement.companyName}
                          {record.placement.source === "self_placed" && (
                            <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                              Self-placed
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-500">
                          {record.placement.roleTitle ?? "Role not recorded"} · ₹
                          {record.placement.ctcLpa} LPA
                          {record.placement.offerCategory !== null &&
                            ` · ${offerCategoryLabel(record.placement.offerCategory)}`}
                        </p>
                      </div>
                    )
                  )}
                </div>
              )}
            </Card>
          </section>

          {/* Academics Record Card */}
          <section aria-label="Academics">
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <GraduationCap className="size-5 text-brand-600" />
                <h2 className="font-heading text-lg font-bold text-ink-900">Academics</h2>
              </div>

              {/* Schooling & Diploma Grid */}
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">10th %</dt>
                  <dd className="text-ink-900">
                    {record.tenthPercentage ?? "Not recorded"}
                    {record.tenthInstitution && (
                      <span className="ml-2 text-xs text-ink-500">
                        ({record.tenthInstitution}
                        {record.tenthBoard ? ` · ${boardLabel(record.tenthBoard, "tenth")}` : ""})
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">12th %</dt>
                  <dd className="text-ink-900">
                    {record.twelfthPercentage ?? "Not recorded"}
                    {record.twelfthInstitution && (
                      <span className="ml-2 text-xs text-ink-500">
                        ({record.twelfthInstitution}
                        {record.twelfthBoard
                          ? ` · ${boardLabel(record.twelfthBoard, "twelfth")}`
                          : ""}
                        )
                      </span>
                    )}
                  </dd>
                </div>
                {record.diplomaInstitution && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-500">Diploma</dt>
                    <dd className="text-ink-900">
                      {record.diplomaMarks != null ? `${record.diplomaMarks}%` : "Recorded"}
                      <span className="ml-2 text-xs text-ink-500">
                        ({record.diplomaInstitution})
                      </span>
                    </dd>
                  </div>
                )}
              </dl>

              {/* Semester by Semester Breakdown */}
              {semesters.length > 0 && (
                <ul className="mt-3 divide-y divide-line border-t border-line pt-1">
                  {semesters.map((semester) => (
                    <li
                      key={semester.semesterNumber}
                      className="flex items-center justify-between gap-4 py-2 text-sm"
                    >
                      <span className="text-ink-700">Semester {semester.semesterNumber}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-ink-900">
                          {describeMarks(semester.cgpa, "cgpa")}
                        </span>
                        <Badge tone={semester.verified ? "success" : "warning"}>
                          {semester.verified ? "Verified" : "Pending"}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          {/* Applications History Card */}
          <section aria-label="Applications">
            <Card className="p-5">
              <h2 className="mb-3 font-heading text-lg font-bold text-ink-900">Applications</h2>
              {applications.length === 0 ? (
                <p className="text-sm text-ink-700">No applications yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {applications.map((application) => (
                    <li
                      key={application.applicationId}
                      className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-900">
                          <Link to={`/drives/${application.driveId}`} className="hover:underline">
                            {application.companyName}
                          </Link>
                        </p>
                        <p className="text-xs text-ink-500">
                          {application.roleTitle ?? "Role not recorded"}
                          {application.appliedAt !== null &&
                            ` · applied ${onDate(application.appliedAt)}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {application.shortlisted && <Badge tone="brand">Shortlisted</Badge>}
                        {application.hasOffer && <Badge tone="success">Offer</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          {/* Portfolio & SRF Details Card */}
          <section aria-label="Portfolio">
            <Card className="p-5">
              <h2 className="mb-3 font-heading text-lg font-bold text-ink-900">
                Portfolio & Technical Profile
              </h2>
              <div className="space-y-4 text-sm">
                {record.technicalSkills && (
                  <div>
                    <h3 className="text-xs font-semibold text-ink-500">Technical Skills</h3>
                    <p className="mt-1 whitespace-pre-wrap text-ink-800">
                      {record.technicalSkills}
                    </p>
                  </div>
                )}

                {record.areasOfInterest && (
                  <div>
                    <h3 className="text-xs font-semibold text-ink-500">Areas of Interest</h3>
                    <p className="mt-1 whitespace-pre-wrap text-ink-800">
                      {record.areasOfInterest}
                    </p>
                  </div>
                )}

                {record.areasOfExpertise && (
                  <div>
                    <h3 className="text-xs font-semibold text-ink-500">Areas of Expertise</h3>
                    <p className="mt-1 whitespace-pre-wrap text-ink-800">
                      {record.areasOfExpertise}
                    </p>
                  </div>
                )}

                {record.projects && (
                  <div>
                    <h3 className="text-xs font-semibold text-ink-500">Key Projects</h3>
                    <p className="mt-1 whitespace-pre-wrap text-ink-800">{record.projects}</p>
                  </div>
                )}

                {record.certifications && (
                  <div>
                    <h3 className="text-xs font-semibold text-ink-500">Certifications</h3>
                    <p className="mt-1 whitespace-pre-wrap text-ink-800">{record.certifications}</p>
                  </div>
                )}

                {record.achievements && (
                  <div>
                    <h3 className="text-xs font-semibold text-ink-500">Achievements & Honors</h3>
                    <p className="mt-1 whitespace-pre-wrap text-ink-800">{record.achievements}</p>
                  </div>
                )}

                {!record.technicalSkills &&
                  !record.areasOfInterest &&
                  !record.projects &&
                  !record.certifications &&
                  !record.achievements && (
                    <p className="text-xs text-ink-500">
                      No additional project or portfolio details filed in SRF.
                    </p>
                  )}
              </div>
            </Card>
          </section>
        </div>

        {/* Right 1 Column: Preferences, Resumes, Assessed Skills, Contacts & Profiles */}
        <div className="space-y-6 lg:col-span-1">
          {/* Identity Card */}
          <section aria-label="Identity">
            <Card className="p-5">
              <h2 className="mb-3 font-heading text-lg font-bold text-ink-900">Identity</h2>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-ink-500">Programme</dt>
                  <dd className="min-w-0 break-words text-right text-ink-900 [overflow-wrap:anywhere]">
                    {record.degree}
                    {record.branch !== "" && ` — ${record.branch}`} · {record.passingYear}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-ink-500">Email</dt>
                  <dd className="min-w-0 break-all text-right text-ink-900">{record.email}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-ink-500">Mobile</dt>
                  <dd className="min-w-0 break-all text-right text-ink-900">
                    {record.mobile ?? "Not recorded"}
                  </dd>
                </div>
                {record.whatsapp && (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-ink-500">WhatsApp</dt>
                    <dd className="min-w-0 break-all text-right font-medium text-emerald-700">
                      {record.whatsapp}
                    </dd>
                  </div>
                )}
                {record.alternateContact && (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-ink-500">Alt Phone</dt>
                    <dd className="min-w-0 break-all text-right text-ink-900">
                      {record.alternateContact}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          </section>

          {/* Resumes on File Card (with Staff Upload/Replace) */}
          <section aria-label="Resumes">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="size-5 text-brand-600" />
                  <h2 className="font-heading text-base font-bold text-ink-900">
                    Category Resumes
                  </h2>
                </div>
              </div>

              <div className="space-y-3">
                {ROLE_CATEGORIES.map((cat) => {
                  const isPreferred = rolePreferences.includes(cat);
                  const doc = resumes.find((r) => r.roleCategory === cat);

                  return (
                    <div
                      key={cat}
                      className={`rounded-lg border p-3 ${
                        isPreferred
                          ? "border-line bg-surface"
                          : "border-line/60 bg-surface-muted/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-ink-900">
                              {RESUME_TRACK_LABEL[cat]}
                            </span>
                            {isPreferred && <Badge tone="brand">Active</Badge>}
                          </div>
                          {doc ? (
                            <div className="mt-1 text-xs text-ink-500">
                              <p className="truncate font-medium text-ink-700" title={doc.fileName}>
                                {doc.fileName}
                              </p>
                              <p className="text-[11px]">
                                {formatFileSize(doc.sizeBytes)} · {onDate(doc.uploadedAt)}
                              </p>
                            </div>
                          ) : (
                            <p className="mt-1 text-[11px] text-ink-400">No resume uploaded</p>
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-1.5">
                          {doc?.downloadUrl && (
                            <ButtonAnchor
                              href={doc.downloadUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              size="sm"
                              className="text-xs"
                            >
                              <ExternalLink className="mr-1 size-3" />
                              View PDF
                            </ButtonAnchor>
                          )}
                          {hasStaffControls && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => triggerResumeUpload(cat)}
                              isLoading={actions.isPending() && uploadCategory === cat}
                              className="text-xs"
                            >
                              <Upload className="mr-1 size-3" />
                              {doc ? "Replace" : "Upload"}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>

          {/* Role & Drive Preferences Card */}
          <section aria-label="Skills and preferences">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-lg font-bold text-ink-900">
                  Skills and preferences
                </h2>
                {hasStaffControls && (
                  <Button variant="ghost" size="sm" onClick={openPreferencesModal}>
                    <Edit2 className="mr-1 size-3" />
                    Edit
                  </Button>
                )}
              </div>

              {/* Assessed skill scores */}
              {skills.length === 0 ? (
                <p className="text-sm text-ink-500">No skill scores recorded.</p>
              ) : (
                <p className="flex flex-wrap gap-1.5 text-xs">
                  {skills.map(({ skill, score }) => (
                    <span
                      key={skill}
                      className="max-w-full break-words rounded-full border border-line bg-surface-muted px-2 py-0.5 font-medium text-ink-700 [overflow-wrap:anywhere]"
                    >
                      {skill} {score}/{SKILL_SCORE_MAX}
                    </span>
                  ))}
                </p>
              )}

              {/* Preferred role categories */}
              {rolePreferences.length > 0 && (
                <p className="mt-3 text-sm text-ink-700">
                  <span className="text-ink-500">Preferred areas: </span>
                  {rolePreferences.map((area) => AREA_LABEL[area] ?? area).join(" · ")}
                </p>
              )}

              {/* Drive type preferences */}
              <div className="mt-3 border-t border-line pt-3">
                <span className="text-xs font-semibold text-ink-500">Drive Type Preferences:</span>
                {driveTypePreferences.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-500">
                    Open to all drive types (no restrictions)
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {driveTypePreferences.map((dt) => (
                      <Badge key={dt} tone="accent">
                        {DRIVE_TYPE_LABEL[dt] ?? dt}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </section>

          {/* Online & Coding Profiles Card */}
          <section aria-label="Online profiles">
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Globe className="size-4 text-brand-600" />
                <h2 className="font-heading text-base font-bold text-ink-900">
                  Online & Coding Profiles
                </h2>
              </div>
              <div className="space-y-2 text-sm">
                {record.linkedinUrl && (
                  <a
                    href={record.linkedinUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center justify-between rounded-lg border border-line p-2 hover:bg-surface-muted"
                  >
                    <span className="flex items-center gap-2 text-ink-900">
                      <Globe className="size-4 text-brand-600" /> LinkedIn
                    </span>
                    <ExternalLink className="size-3.5 text-ink-400" />
                  </a>
                )}
                {record.githubUrl && (
                  <a
                    href={record.githubUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center justify-between rounded-lg border border-line p-2 hover:bg-surface-muted"
                  >
                    <span className="flex items-center gap-2 text-ink-900">
                      <Globe className="size-4 text-ink-900" /> GitHub
                    </span>
                    <ExternalLink className="size-3.5 text-ink-400" />
                  </a>
                )}
                {record.leetcodeUrl && (
                  <a
                    href={record.leetcodeUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center justify-between rounded-lg border border-line p-2 hover:bg-surface-muted"
                  >
                    <span className="flex items-center gap-2 text-ink-900">
                      <span className="font-mono font-bold text-gold-600">LC</span> LeetCode
                    </span>
                    <ExternalLink className="size-3.5 text-ink-400" />
                  </a>
                )}
                {record.hackerrankUrl && (
                  <a
                    href={record.hackerrankUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center justify-between rounded-lg border border-line p-2 hover:bg-surface-muted"
                  >
                    <span className="flex items-center gap-2 text-ink-900">
                      <span className="font-mono font-bold text-success-600">HR</span> HackerRank
                    </span>
                    <ExternalLink className="size-3.5 text-ink-400" />
                  </a>
                )}
                {!record.linkedinUrl &&
                  !record.githubUrl &&
                  !record.leetcodeUrl &&
                  !record.hackerrankUrl && (
                    <p className="text-xs text-ink-500">No profile links recorded.</p>
                  )}
              </div>
            </Card>
          </section>
        </div>
      </div>

      {/* Staff Preferences Management Modal */}
      {isPrefModalOpen && (
        <DrilldownModal
          eyebrow="Staff Management"
          title={`Edit Preferences — ${record.fullName}`}
          subtitle="Manage role category eligibility and drive type permissions for this student"
          onClose={() => setIsPrefModalOpen(false)}
        >
          <div className="space-y-6 p-6">
            {prefSaveError && (
              <div
                role="alert"
                className="rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-700"
              >
                {prefSaveError}
              </div>
            )}

            <div>
              <h3 className="font-heading text-sm font-bold text-ink-900">
                1. Role Category Preferences
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Determines which role-scoped drives this student is eligible to see and apply for.
              </p>
              <div className="mt-3 space-y-2">
                {ROLE_CATEGORIES.map((cat) => {
                  const checked = editRoleCats.includes(cat);
                  return (
                    <label
                      key={cat}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-2.5 hover:bg-surface-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditRoleCats((prev) => [...prev, cat]);
                          } else {
                            setEditRoleCats((prev) => prev.filter((c) => c !== cat));
                          }
                        }}
                        className="size-4 rounded text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-sm font-medium text-ink-900">
                        {AREA_LABEL[cat] ?? cat}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-line pt-4">
              <h3 className="font-heading text-sm font-bold text-ink-900">
                2. Drive Type Preferences
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">
                If none are selected, the student is open to all drive types. Check specific types
                to restrict participation.
              </p>
              <div className="mt-3 space-y-2">
                {DRIVE_TYPES.map((dt) => {
                  const checked = editDriveTypes.includes(dt);
                  return (
                    <label
                      key={dt}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-2.5 hover:bg-surface-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditDriveTypes((prev) => [...prev, dt]);
                          } else {
                            setEditDriveTypes((prev) => prev.filter((d) => d !== dt));
                          }
                        }}
                        className="size-4 rounded text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-sm font-medium text-ink-900">
                        {DRIVE_TYPE_LABEL[dt] ?? dt}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-line pt-4">
              <Button
                variant="secondary"
                disabled={actions.busy}
                onClick={() => setIsPrefModalOpen(false)}
              >
                Cancel
              </Button>
              <Button isLoading={actions.isPending()} onClick={() => void savePreferences()}>
                Save Preferences
              </Button>
            </div>
          </div>
        </DrilldownModal>
      )}
    </div>
  );
}
