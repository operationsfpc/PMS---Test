import { DrilldownModal } from "@components/drilldown-modal";
import { StatusChangeDialog, type StatusChangePlan } from "@components/status-change-dialog";
import { StatusHistory } from "@components/status-history";
import {
  Badge,
  Button,
  ButtonAnchor,
  ButtonLink,
  Card,
  PageHeader,
  StatCard,
} from "@components/ui";
import { boardLabel, type SchoolBoard } from "@domain/boards";
import { groupByCompanyVisit } from "@domain/company-drive";
import { HOLD_KIND_LABELS, holdStanding, holdWindowLine } from "@domain/holds";
import { describeMarks } from "@domain/marks";
import { type OfferCategory, offerCategoryLabel } from "@domain/offer-category";
import { participationStatusLabel, participationStatusTone } from "@domain/participation-status";
import { SKILL_SCORE_MAX } from "@domain/skills";
import {
  canRestoreParticipation,
  canWithdrawOffer,
  restoreReasonProblem,
  type StatusEvent,
  withdrawalReasonProblem,
} from "@domain/status-changes";
import { extractOriginalFilename } from "@domain/storage-path";
import {
  type AppRole,
  DRIVE_TYPES,
  type DriveType,
  type OfferSource,
  type ParticipationStatus,
  ROLE_CATEGORIES,
  type RoleCategory,
  type SrfStatus,
} from "@domain/types";
import type { Hold, HoldsView } from "@lib/holds-view";
import type { StatusChangesView } from "@lib/status-changes-view";
import { useAsyncAction } from "@lib/use-async-action";
import {
  ArrowLeft,
  Award,
  BookOpen,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  Globe,
  GraduationCap,
  RotateCcw,
  Search,
  Sparkles,
  Trophy,
  Upload,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Skeleton } from "@/components/shadcn/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";

export interface StudentRecordSemester {
  readonly semesterNumber: number;
  readonly cgpa: number;
  readonly verified: boolean;
  readonly currentArrears?: number | undefined;
  readonly historyOfArrears?: number | undefined;
  readonly marksheetUrl?: string | null;
}

export interface StudentRecordCertificate {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly documentUrl?: string | null;
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
  /** The company visit this role belongs to; null for a legacy standalone drive. */
  readonly companyDriveId?: string | null;
  /** The visit's day, so the same company on two days stays two blocks. */
  readonly tentativeDate?: string | null;
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
  readonly tenthBoardState?: string | null;
  readonly tenthGrade?: string | null;
  readonly tenthMarksheetUrl?: string | null;
  readonly twelfthPercentage: number | null;
  readonly twelfthInstitution?: string | null;
  readonly twelfthBoard?: SchoolBoard | null;
  readonly twelfthBoardState?: string | null;
  readonly twelfthGrade?: string | null;
  readonly twelfthMarksheetUrl?: string | null;
  readonly diplomaInstitution?: string | null;
  readonly diplomaUniversity?: string | null;
  readonly diplomaMarks?: number | null;
  readonly diplomaMarksScale?: string | null;
  readonly diplomaMarksheetUrl?: string | null;
  readonly programmeLevel?: string | null;
  readonly ugDegree?: string | null;
  readonly ugCollege?: string | null;
  readonly ugBranch?: string | null;
  readonly ugAggregateDeclared?: number | null;
  readonly ugAggregateScale?: string | null;
  readonly ugMarksheetUrl?: string | null;
  readonly overallCgpa?: number | null;
  readonly currentArrears?: number | undefined;
  readonly historyOfArrears?: number | undefined;
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
  readonly certificatesList?: readonly StudentRecordCertificate[];
  readonly achievements?: string | null;
  // Professional Links
  readonly linkedinUrl?: string | null;
  readonly githubUrl?: string | null;
  readonly leetcodeUrl?: string | null;
  readonly hackerrankUrl?: string | null;
  readonly otherProfiles?: readonly { label: string; value: string }[];
  // Registration & Audit
  readonly consentGivenAt?: string | null;
  readonly srfSubmittedAt?: string | null;
  readonly srfDecidedAt?: string | null;
  readonly srfRejectionReason?: string | null;
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

/** The placeholder tiles and panel columns, shaped like the real page so the read does not reflow. */
const LOADING_STATS = ["cgpa", "arrears", "history", "school", "outcomes", "applications"];
const LOADING_PANELS = ["placement", "marks", "proofs", "applications"];
const LOADING_SIDEBAR = ["profile", "resume"];

/**
 * A declared figure with the scale the student chose, spelled out.
 *
 * `diploma_marks_scale` and `ug_aggregate_scale` are stored as enum strings, so
 * the raw value used to print as "9.5 (cgpa)" — a column value, not something a
 * coordinator reads. An unrecognised scale is still shown rather than silently
 * re-labelled, because guessing a scale changes which cutoff the figure is
 * compared against.
 */
function declaredMarks(value: number, scale: string | null | undefined): string {
  if (scale === "percentage") return `${value}%`;
  if (scale === "cgpa" || scale == null) return `${value} CGPA`;
  return `${value} (${scale})`;
}

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

/**
 * The two moves, each as the box that asks for its reason (0133, 0134).
 *
 * Written here rather than at the call site because what they promise has to be
 * what the RPCs do: the restore touches no application, shortlist or offer, and
 * the withdrawal removes exactly one offer and leaves the rest of the record
 * standing. The reason always comes from a domain validator, so the screen and
 * the database refuse the same box in the same words.
 */
function restorePlanOf(record: StudentRecord, changes: StatusChangesView): StatusChangePlan {
  return {
    eyebrow: "Status change",
    title: `Return ${record.fullName} to the pipeline`,
    effect:
      "They are opted out, so no drive reaches them. Returning them reopens every drive they are eligible for; their applications, shortlists and offers stay exactly as they are.",
    reasonLabel: "Why are they coming back?",
    placeholder: "Opted out at counselling by mistake — confirmed with the student on 3 Nov.",
    note: "The student is shown this on their own record with your name and the date. Nothing is mailed to them.",
    submitLabel: "Return to the pipeline",
    reasonProblem: restoreReasonProblem,
    submit: (reason) => changes.restore(record.studentId, reason),
  };
}

function withdrawalPlanOf(offer: StudentRecordOffer, changes: StatusChangesView): StatusChangePlan {
  return {
    eyebrow: "Offer withdrawal",
    title: `Withdraw the ${offer.companyName} offer`,
    effect:
      "The offer comes off their record and they are back in the funnel for future drives. Their applications and their other offers are untouched, and the letter stays on file.",
    reasonLabel: "Why is the offer being withdrawn?",
    placeholder: "Company retracted the joining — confirmed in writing on 3 Nov.",
    note: "The student is shown this on their own record with your name and the date. Nothing is mailed to them.",
    submitLabel: "Withdraw offer",
    reasonProblem: withdrawalReasonProblem,
    submit: (reason) => changes.withdraw(offer.id, reason),
  };
}

export function StudentRecordPage({
  studentId,
  view,
  role,
  holds,
  release,
  statusChanges,
  canManagePreferences = false,
}: {
  studentId: string;
  view: StudentRecordView;
  /** Whose record this is being read as — decides which status moves are offered. */
  role: AppRole;
  holds?: HoldsView;
  release?: (holdId: string, note: string | null) => Promise<void>;
  /** The two status ledgers, present only for a role RLS lets read them. */
  statusChanges?: StatusChangesView;
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

  // Status ledger state — the merged history and which move is being written
  const [history, setHistory] = useState<readonly StatusEvent[]>([]);
  const [historyProblem, setHistoryProblem] = useState<string | null>(null);
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<StudentRecordOffer | null>(null);

  // Resume upload state
  const [uploadCategory, setUploadCategory] = useState<RoleCategory | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Filter states
  const [activeSection, setActiveSection] = useState<
    "overview" | "all" | "academics" | "placements" | "preferences" | "portfolio"
  >("overview");
  const [appSearch, setAppSearch] = useState("");
  const [appStatusFilter, setAppStatusFilter] = useState<"all" | "shortlisted" | "offered">("all");
  const [offerTypeFilter, setOfferTypeFilter] = useState<"all" | "placement" | "internship">("all");
  const [semFilter, setSemFilter] = useState<"all" | "verified" | "pending">("all");

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-runs the read on purpose
  useEffect(() => {
    if (statusChanges === undefined) return;
    let live = true;

    statusChanges.historyFor(studentId).then(
      (events) => {
        if (live) {
          setHistory(events);
          setHistoryProblem(null);
        }
      },
      (cause: unknown) => {
        if (!live) return;
        setHistoryProblem(
          cause instanceof Error && cause.message !== ""
            ? cause.message
            : "Could not read this student's status history.",
        );
      },
    );

    return () => {
      live = false;
    };
  }, [statusChanges, studentId, reload]);

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
      <div role="status" aria-busy="true" className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {LOADING_STATS.map((key) => (
            <Skeleton key={key} className="h-[88px]" />
          ))}
        </div>
        <Skeleton className="h-9 w-full" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {LOADING_PANELS.map((key) => (
              <Skeleton key={key} className="h-44" />
            ))}
          </div>
          <div className="space-y-6">
            {LOADING_SIDEBAR.map((key) => (
              <Skeleton key={key} className="h-36" />
            ))}
          </div>
        </div>
        <p className="text-sm text-ink-500">Loading the student record…</p>
      </div>
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
  const certificatesList = record.certificatesList ?? [];
  const currentArrears = record.currentArrears ?? 0;
  const historyOfArrears = record.historyOfArrears ?? 0;

  const filteredOffers = offers.filter((o) => {
    if (offerTypeFilter === "placement") return o.driveType === "placement";
    if (offerTypeFilter === "internship") return o.driveType !== "placement";
    return true;
  });

  const filteredSemesters = semesters.filter((s) => {
    if (semFilter === "verified") return s.verified;
    if (semFilter === "pending") return !s.verified;
    return true;
  });

  const filteredApplications = applications.filter((app) => {
    if (appStatusFilter === "shortlisted" && !app.shortlisted) return false;
    if (appStatusFilter === "offered" && !app.hasOffer) return false;
    if (appSearch.trim()) {
      const q = appSearch.toLowerCase().trim();
      const matchCompany = app.companyName.toLowerCase().includes(q);
      const matchRole = app.roleTitle?.toLowerCase().includes(q) ?? false;
      if (!matchCompany && !matchRole) return false;
    }
    return true;
  });

  /* One block per company visit, like every other drive list (2026-10-31:
     the same company raised twice is one visit, not two rows). */
  const applicationVisits = [
    ...groupByCompanyVisit(filteredApplications, (app) => ({
      ownId: app.applicationId,
      companyDriveId: app.companyDriveId,
      companyName: app.companyName,
      tentativeDate: app.tentativeDate,
    })).values(),
  ];

  const today = new Date();
  const standing = hold === null ? null : holdStanding(hold, today);
  const badgeRepeatsHold = hold !== null && record.participationStatus === "on_hold";
  const hasStaffControls = canManagePreferences || view.updatePreferences !== undefined;

  /*
   * The two status moves, gated on this side exactly as `restore_participation`
   * (0133) and `withdraw_offer` (0134) gate them, so nobody is left typing a
   * reason into a box the database was always going to refuse. A student whose
   * standing has a different way back — a hold, a disbarment — is told which.
   */
  const restore = canRestoreParticipation(role, record.participationStatus);
  const mayWithdrawOffer = canWithdrawOffer(role).allowed && statusChanges !== undefined;
  // The student already reads their own sentence on the opt-out screen; this
  // one tells a manager which of the three ways back actually applies.
  const restoreRefusal =
    restore.allowed || role === "student" || record.participationStatus === "active"
      ? null
      : restore.reason;

  const restorePlan =
    restore.allowed && statusChanges !== undefined ? restorePlanOf(record, statusChanges) : null;

  /** One write, one refresh: the ledger row and the new badge both come from the re-read. */
  function statusMoveDone() {
    setIsRestoreOpen(false);
    setWithdrawTarget(null);
    setReload((count) => count + 1);
  }

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
              {restorePlan !== null && (
                <Button variant="secondary" size="sm" onClick={() => setIsRestoreOpen(true)}>
                  <RotateCcw aria-hidden="true" className="mr-1.5 size-3.5" />
                  Change status
                </Button>
              )}
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
            <Badge tone={participationStatusTone(record.participationStatus)}>
              {participationStatusLabel(record.participationStatus)}
            </Badge>
          )}
          {restoreRefusal !== null && (
            <p className="w-full text-xs text-ink-500 sm:w-auto">{restoreRefusal}</p>
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

      {/* Top Quick Stats Strip — one palette; colour only where the figure is a signal */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Overall CGPA"
          value={record.overallCgpa != null ? describeMarks(record.overallCgpa, "cgpa") : "—"}
          hint="Normalised out of 10"
          tone="brand"
        />
        <StatCard
          label="Standing Arrears"
          value={currentArrears}
          hint={currentArrears > 0 ? "Action required" : "Zero active"}
          tone={currentArrears > 0 ? "danger" : "success"}
        />
        <StatCard label="History Arrears" value={historyOfArrears} hint="Total recorded" />
        <StatCard
          label="10th / 12th Marks"
          value={`${record.tenthPercentage != null ? `${record.tenthPercentage}%` : "—"} / ${
            record.twelfthPercentage != null ? `${record.twelfthPercentage}%` : "—"
          }`}
          hint="Class X / XII"
        />
        <StatCard
          label="Offers & Internships"
          value={
            offers.length > 0
              ? `${offers.length} Offer${offers.length > 1 ? "s" : ""}`
              : record.placement
                ? "1 Placed"
                : "0"
          }
          hint={offers.length > 0 || record.placement ? "Outcome secured" : "Unplaced"}
          tone={offers.length > 0 || record.placement ? "success" : "neutral"}
        />
        <StatCard
          label="Applications"
          value={applications.length}
          hint="Campus drives"
          tone="brand"
        />
      </div>

      {/* Section filter — real Tabs: arrow keys, roving focus, one panel the sections live in */}
      <Tabs
        value={activeSection}
        onValueChange={(next) => setActiveSection(next as typeof activeSection)}
      >
        <TabsList className="mb-4 h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto rounded-xl border border-line bg-surface-muted p-1 [scrollbar-width:none] sm:flex-wrap">
          {[
            { id: "overview", label: "Overview" },
            { id: "all", label: "All sections" },
            { id: "academics", label: `Academics (${semesters.length})` },
            {
              id: "placements",
              label: `Placements (${offers.length || (record.placement ? 1 : 0)})`,
            },
            { id: "preferences", label: "Preferences" },
            { id: "portfolio", label: "Portfolio" },
          ].map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              id={`student-record-tab-${tab.id}`}
              aria-controls="student-record-panels"
              className="w-auto flex-none rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-500 data-[state=active]:bg-surface data-[state=active]:text-brand-700 data-[state=active]:shadow-sm"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* The panel every section tab points at. Overview, the default, is the
          profile: the live hold, the identity facts and the status history. */}
      <div
        id="student-record-panels"
        role="tabpanel"
        aria-labelledby={`student-record-tab-${activeSection}`}
        tabIndex={-1}
        className="space-y-6 outline-none"
      >
        {(activeSection === "overview" || activeSection === "all") && (
          <section aria-label="Identity">
            <Card className="p-5 shadow-xs transition-shadow hover:shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <div className="rounded-lg bg-brand-50 p-1.5 text-brand-600">
                  <User className="size-4" />
                </div>
                <h2 className="font-heading text-lg font-bold text-ink-900">Identity</h2>
              </div>
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
                    <dd className="min-w-0 break-all text-right font-medium text-success-700">
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
                {/* Registration audit timestamps */}
                <div className="mt-2 border-t border-line pt-2 text-xs">
                  <div className="flex justify-between text-ink-500">
                    <span>Submitted:</span>
                    <span>{record.srfSubmittedAt ? onDate(record.srfSubmittedAt) : "—"}</span>
                  </div>
                  {record.srfDecidedAt && (
                    <div className="mt-1 flex justify-between text-ink-500">
                      <span>Approved:</span>
                      <span>{onDate(record.srfDecidedAt)}</span>
                    </div>
                  )}
                  {record.consentGivenAt && (
                    <div className="mt-1 flex justify-between text-ink-500">
                      <span>Consent Recorded:</span>
                      <span>{onDate(record.consentGivenAt)}</span>
                    </div>
                  )}
                  {record.srfRejectionReason && (
                    <div className="mt-2 rounded bg-danger-50 p-2 text-danger-700">
                      Rejection reason: {record.srfRejectionReason}
                    </div>
                  )}
                </div>
              </dl>
            </Card>
          </section>
        )}

        {/* Holds Section — Exactly preserved for RLS & Hold Management rules */}
        {(activeSection === "overview" || activeSection === "all") &&
          (hold !== null || pending !== null || pastHolds.length > 0) && (
            <section aria-label="Placement hold" className="flex flex-col gap-3">
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
                          <label
                            htmlFor="decline-note"
                            className="text-sm font-medium text-ink-700"
                          >
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
                          <Button
                            isLoading={actions.isPending()}
                            onClick={() => void confirmRequest()}
                          >
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
                      <span className="text-xs text-ink-500">
                        The student cannot open this file.
                      </span>
                    </p>
                  )}

                  {release !== undefined && (
                    <div className="mt-4">
                      {lifting ? (
                        <div className="flex flex-col gap-2">
                          <label
                            htmlFor="release-note"
                            className="text-sm font-medium text-ink-700"
                          >
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
                            Only forward — pulling a review earlier is what Release is for. The old
                            date stays in the audit log.
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
                  <h2 className="mb-2 font-heading text-lg font-bold text-ink-900">
                    Earlier holds
                  </h2>
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

        {/* Status history — every move a person made on this standing, and why */}
        {(activeSection === "overview" || activeSection === "all") && (
          <StatusHistory events={history} problem={historyProblem} subject={record.fullName} />
        )}

        {/* Main Layout Grid — the sections of every tab but Overview */}
        <div id="student-record-grid" className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left 2 Columns: Core History & Records */}
          <div className="space-y-6 lg:col-span-2">
            {/* Offers & Placement Card */}
            {(activeSection === "placements" || activeSection === "all") && (
              <section aria-label="Placement">
                <Card className="p-5 shadow-xs transition-shadow hover:shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-success-50 p-2 text-success-600">
                        <Trophy className="size-5" />
                      </div>
                      <div>
                        <h2 className="font-heading text-lg font-bold text-ink-900">
                          Offers & Internships
                        </h2>
                        <p className="text-xs text-ink-500">
                          Total {offers.length} recorded outcome{offers.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {record.placement !== null && (
                        <Badge tone="success">Primary Placement Active</Badge>
                      )}
                      {offers.length > 0 && (
                        <Tabs
                          value={offerTypeFilter}
                          onValueChange={(next) =>
                            setOfferTypeFilter(next as typeof offerTypeFilter)
                          }
                        >
                          <TabsList className="h-7 w-fit p-0.5">
                            <TabsTrigger value="all" className="px-2 py-0.5 text-xs">
                              All ({offers.length})
                            </TabsTrigger>
                            <TabsTrigger value="placement" className="px-2 py-0.5 text-xs">
                              Placements ({offers.filter((o) => o.driveType === "placement").length}
                              )
                            </TabsTrigger>
                            <TabsTrigger value="internship" className="px-2 py-0.5 text-xs">
                              Internships (
                              {offers.filter((o) => o.driveType !== "placement").length})
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      )}
                    </div>
                  </div>

                  {offers.length === 0 && record.placement === null ? (
                    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-muted/50 p-3 text-sm text-ink-600">
                      <Badge tone="neutral">Not placed</Badge>
                      <span>Currently eligible and active for upcoming placement drives.</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {offers.length > 0 ? (
                        <div className="divide-y divide-line rounded-lg border border-line">
                          {filteredOffers.map((offer) => (
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
                                  {offer.ctcLpa != null && offer.ctcLpa > 0 ? (
                                    <span className="font-semibold text-brand-700">
                                      ₹{offer.ctcLpa} LPA
                                    </span>
                                  ) : (
                                    <span>CTC not recorded</span>
                                  )}
                                  {offer.stipendMonthly != null && offer.stipendMonthly > 0 && (
                                    <span className="font-semibold text-success-700">
                                      ₹{offer.stipendMonthly.toLocaleString("en-IN")} / month
                                    </span>
                                  )}
                                  <span>Declared on {onDate(offer.declaredAt)}</span>
                                </div>
                              </div>

                              {(offer.letterUrl !== null || mayWithdrawOffer) && (
                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                  {offer.letterUrl !== null && (
                                    <ButtonAnchor
                                      href={offer.letterUrl}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      size="sm"
                                    >
                                      <Download className="mr-1.5 size-3.5" />
                                      Offer Letter
                                    </ButtonAnchor>
                                  )}
                                  {mayWithdrawOffer && (
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      aria-label={`Withdraw the ${offer.companyName} offer`}
                                      onClick={() => setWithdrawTarget(offer)}
                                    >
                                      Withdraw offer
                                    </Button>
                                  )}
                                </div>
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
                              {record.placement.roleTitle ?? "Role not recorded"}
                              {" · "}
                              {record.placement.ctcLpa != null && record.placement.ctcLpa > 0
                                ? `₹${record.placement.ctcLpa} LPA`
                                : "CTC not recorded"}
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
            )}

            {/* Academics Record Card & Semester Progression */}
            {(activeSection === "academics" || activeSection === "all") && (
              <section aria-label="Academics" className="space-y-6">
                {/* Semester by Semester Progression Table */}
                <Card className="p-5 shadow-xs transition-shadow hover:shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                        <GraduationCap className="size-5" />
                      </div>
                      <div>
                        <h2 className="font-heading text-lg font-bold text-ink-900">
                          Academic Progression
                        </h2>
                        <p className="text-xs text-ink-500">
                          Semester-wise marks, backlogs, and official marksheets
                        </p>
                      </div>
                    </div>
                    {semesters.length > 0 && (
                      <Tabs
                        value={semFilter}
                        onValueChange={(next) => setSemFilter(next as typeof semFilter)}
                      >
                        <TabsList className="h-7 w-fit p-0.5">
                          <TabsTrigger value="all" className="px-2 py-0.5 text-xs">
                            All ({semesters.length})
                          </TabsTrigger>
                          <TabsTrigger value="verified" className="px-2 py-0.5 text-xs">
                            Cleared ({semesters.filter((s) => s.verified).length})
                          </TabsTrigger>
                          <TabsTrigger value="pending" className="px-2 py-0.5 text-xs">
                            Awaiting ({semesters.filter((s) => !s.verified).length})
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                    )}
                  </div>

                  {semesters.length === 0 ? (
                    <p className="text-sm text-ink-500">No semester records filed.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-line">
                      <Table>
                        <TableHeader className="bg-surface-muted text-xs font-semibold text-ink-700">
                          <TableRow>
                            <TableHead className="pl-4">Semester</TableHead>
                            <TableHead>CGPA / Score</TableHead>
                            <TableHead>Arrears</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="pr-4 text-right">Marksheet</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody className="divide-line bg-surface">
                          {filteredSemesters.map((semester) => (
                            <TableRow key={semester.semesterNumber} className="border-line">
                              <TableCell className="pl-4 font-medium text-ink-900">
                                Semester {semester.semesterNumber}
                              </TableCell>
                              <TableCell className="text-ink-900 tabular-nums">
                                {describeMarks(semester.cgpa, "cgpa")}
                              </TableCell>
                              <TableCell className="text-xs">
                                <span
                                  className={
                                    semester.currentArrears && semester.currentArrears > 0
                                      ? "font-semibold text-danger-600"
                                      : "text-ink-600"
                                  }
                                >
                                  Standing: {semester.currentArrears ?? 0}
                                </span>
                                <p className="text-ink-400">
                                  History: {semester.historyOfArrears ?? 0}
                                </p>
                              </TableCell>
                              <TableCell>
                                <Badge tone={semester.verified ? "success" : "warning"}>
                                  {semester.verified ? "Verified" : "Pending"}
                                </Badge>
                              </TableCell>
                              <TableCell className="pr-4 text-right">
                                {semester.marksheetUrl ? (
                                  <ButtonAnchor
                                    href={semester.marksheetUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    size="sm"
                                    variant="ghost"
                                    className="text-xs text-brand-600 hover:text-brand-700"
                                  >
                                    <FileText className="mr-1 size-3.5" />
                                    View PDF
                                  </ButtonAnchor>
                                ) : (
                                  <span className="text-xs text-ink-400">Not filed</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>

                {/* Schooling & Higher Education Details */}
                <Card className="p-5 shadow-xs transition-shadow hover:shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="rounded-lg bg-cyan-50 p-2 text-brand-600">
                      <BookOpen className="size-5" />
                    </div>
                    <div>
                      <h2 className="font-heading text-lg font-bold text-ink-900">
                        School & Higher Education
                      </h2>
                      <p className="text-xs text-ink-500">
                        Secondary boards, diploma qualifications, and prior degrees
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* Class 10 */}
                    <div className="rounded-lg border border-line bg-surface p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-xs font-semibold text-brand-700">
                            10th Standard
                          </span>
                          <p className="mt-1 text-base font-bold text-ink-900">
                            {record.tenthPercentage != null ? `${record.tenthPercentage}%` : "—"}
                            {record.tenthGrade && (
                              <span className="ml-1.5 text-xs font-medium text-ink-500">
                                (Grade {record.tenthGrade})
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-xs text-ink-600">
                            {record.tenthInstitution ?? "School not recorded"}
                          </p>
                          {record.tenthBoard && (
                            <p className="text-[11px] text-ink-400">
                              Board: {boardLabel(record.tenthBoard, "tenth")}
                              {record.tenthBoardState ? ` · ${record.tenthBoardState}` : ""}
                            </p>
                          )}
                        </div>
                        {record.tenthMarksheetUrl && (
                          <ButtonAnchor
                            href={record.tenthMarksheetUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            size="sm"
                            variant="secondary"
                            className="shrink-0 text-xs"
                          >
                            <FileText className="mr-1 size-3" />
                            Marksheet
                          </ButtonAnchor>
                        )}
                      </div>
                    </div>

                    {/* Class 12 */}
                    <div className="rounded-lg border border-line bg-surface p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-xs font-semibold text-brand-700">
                            12th Standard / HSE
                          </span>
                          <p className="mt-1 text-base font-bold text-ink-900">
                            {record.twelfthPercentage != null
                              ? `${record.twelfthPercentage}%`
                              : "—"}
                            {record.twelfthGrade && (
                              <span className="ml-1.5 text-xs font-medium text-ink-500">
                                (Grade {record.twelfthGrade})
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-xs text-ink-600">
                            {record.twelfthInstitution ?? "School not recorded"}
                          </p>
                          {record.twelfthBoard && (
                            <p className="text-[11px] text-ink-400">
                              Board: {boardLabel(record.twelfthBoard, "twelfth")}
                              {record.twelfthBoardState ? ` · ${record.twelfthBoardState}` : ""}
                            </p>
                          )}
                        </div>
                        {record.twelfthMarksheetUrl && (
                          <ButtonAnchor
                            href={record.twelfthMarksheetUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            size="sm"
                            variant="secondary"
                            className="shrink-0 text-xs"
                          >
                            <FileText className="mr-1 size-3" />
                            Marksheet
                          </ButtonAnchor>
                        )}
                      </div>
                    </div>

                    {/* Diploma (if present) */}
                    {record.diplomaInstitution && (
                      <div className="rounded-lg border border-line bg-surface p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-xs font-semibold text-brand-700">
                              Diploma Qualification
                            </span>
                            <p className="mt-1 text-base font-bold text-ink-900">
                              {record.diplomaMarks != null
                                ? declaredMarks(record.diplomaMarks, record.diplomaMarksScale)
                                : "Marks not recorded"}
                            </p>
                            <p className="mt-1 text-xs text-ink-600">{record.diplomaInstitution}</p>
                            {record.diplomaUniversity && (
                              <p className="text-[11px] text-ink-400">
                                University: {record.diplomaUniversity}
                              </p>
                            )}
                          </div>
                          {record.diplomaMarksheetUrl && (
                            <ButtonAnchor
                              href={record.diplomaMarksheetUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              size="sm"
                              variant="secondary"
                              className="shrink-0 text-xs"
                            >
                              <FileText className="mr-1 size-3" />
                              Marksheet
                            </ButtonAnchor>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Prior UG Degree (for PG students) */}
                    {(record.ugDegree || record.programmeLevel === "pg") && (
                      <div className="rounded-lg border border-line bg-surface p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-xs font-semibold text-brand-700">
                              Undergraduate Degree (Prior)
                            </span>
                            <p className="mt-1 text-base font-bold text-ink-900">
                              {record.ugAggregateDeclared != null
                                ? declaredMarks(record.ugAggregateDeclared, record.ugAggregateScale)
                                : "Aggregate not recorded"}
                            </p>
                            <p className="mt-1 text-xs text-ink-600">
                              {record.ugDegree}
                              {record.ugBranch ? ` · ${record.ugBranch}` : ""}
                            </p>
                            {record.ugCollege && (
                              <p className="text-[11px] text-ink-400">{record.ugCollege}</p>
                            )}
                          </div>
                          {record.ugMarksheetUrl && (
                            <ButtonAnchor
                              href={record.ugMarksheetUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              size="sm"
                              variant="secondary"
                              className="shrink-0 text-xs"
                            >
                              <FileText className="mr-1 size-3" />
                              Marksheet
                            </ButtonAnchor>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </section>
            )}

            {/* Applications History Card */}
            {(activeSection === "placements" || activeSection === "all") && (
              <section aria-label="Applications">
                <Card className="p-5 shadow-xs transition-shadow hover:shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                        <FileText className="size-5" />
                      </div>
                      <div>
                        <h2 className="font-heading text-lg font-bold text-ink-900">
                          Applications
                        </h2>
                        <p className="text-xs text-ink-500">
                          Drive participation and recruiter shortlist status
                        </p>
                      </div>
                    </div>
                    {applications.length > 0 && (
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                        <div className="relative w-full sm:w-auto">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
                          <input
                            type="text"
                            value={appSearch}
                            onChange={(e) => setAppSearch(e.target.value)}
                            placeholder="Search company or role…"
                            className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-3 text-xs placeholder:text-ink-400 focus:outline-hidden sm:w-52"
                          />
                        </div>
                        <Tabs
                          value={appStatusFilter}
                          onValueChange={(next) =>
                            setAppStatusFilter(next as typeof appStatusFilter)
                          }
                        >
                          <TabsList className="h-7 w-fit p-0.5">
                            <TabsTrigger value="all" className="px-2 py-0.5 text-xs">
                              All ({applications.length})
                            </TabsTrigger>
                            <TabsTrigger value="shortlisted" className="px-2 py-0.5 text-xs">
                              Shortlists ({applications.filter((a) => a.shortlisted).length})
                            </TabsTrigger>
                            <TabsTrigger value="offered" className="px-2 py-0.5 text-xs">
                              Offers ({applications.filter((a) => a.hasOffer).length})
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>
                    )}
                  </div>

                  {applications.length === 0 ? (
                    <p className="text-sm text-ink-700">No applications yet.</p>
                  ) : filteredApplications.length === 0 ? (
                    <p className="py-4 text-center text-xs text-ink-500">
                      No applications matching current search/filter.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {applicationVisits.map((roles) => {
                        const head = roles[0];
                        if (head === undefined) return null;

                        // A single-role visit keeps the plain row it always had.
                        if (roles.length === 1) {
                          return (
                            <li
                              key={head.applicationId}
                              className="flex flex-wrap items-center justify-between gap-3 py-3"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-ink-900">
                                  <Link to={`/drives/${head.driveId}`} className="hover:underline">
                                    {head.companyName}
                                  </Link>
                                </p>
                                <p className="text-xs text-ink-500">
                                  {head.roleTitle ?? "Role not recorded"}
                                  {head.appliedAt !== null &&
                                    ` · applied ${onDate(head.appliedAt)}`}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {head.shortlisted && <Badge tone="brand">Shortlisted</Badge>}
                                {head.hasOffer && <Badge tone="success">Offer</Badge>}
                              </div>
                            </li>
                          );
                        }

                        /* Roles of one visit sit together, the company named once;
                         each role keeps its own link, its own date and its own
                         badges, because those are never summed. */
                        return (
                          <li key={head.applicationId} className="py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-ink-900">{head.companyName}</p>
                              <Badge tone="brand">{roles.length} roles</Badge>
                            </div>
                            <ul className="mt-2 space-y-1.5">
                              {roles.map((application) => (
                                <li
                                  key={application.applicationId}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2"
                                >
                                  <p className="min-w-0 text-sm text-ink-800">
                                    <Link
                                      to={`/drives/${application.driveId}`}
                                      className="font-medium hover:underline"
                                    >
                                      {application.roleTitle ?? "Role not recorded"}
                                    </Link>
                                    {application.appliedAt !== null && (
                                      <span className="text-xs text-ink-500">
                                        {" "}
                                        · applied {onDate(application.appliedAt)}
                                      </span>
                                    )}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {application.shortlisted && (
                                      <Badge tone="brand">Shortlisted</Badge>
                                    )}
                                    {application.hasOffer && <Badge tone="success">Offer</Badge>}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </section>
            )}

            {/* Portfolio & SRF Details Card */}
            {(activeSection === "portfolio" || activeSection === "all") && (
              <section aria-label="Portfolio">
                <Card className="p-5 shadow-xs transition-shadow hover:shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="rounded-lg bg-gold-50 p-2 text-gold-600">
                      <Award className="size-5" />
                    </div>
                    <div>
                      <h2 className="font-heading text-lg font-bold text-ink-900">
                        Portfolio & Technical Profile
                      </h2>
                      <p className="text-xs text-ink-500">
                        Skills, projects, verified certificates, and achievements
                      </p>
                    </div>
                  </div>

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

                    {/* Verified Certificates */}
                    {certificatesList.length > 0 && (
                      <div className="border-t border-line pt-3">
                        <h3 className="text-xs font-semibold text-ink-500">
                          Declared Certificates
                        </h3>
                        <div className="mt-2 divide-y divide-line rounded-lg border border-line">
                          {certificatesList.map((cert) => (
                            <div
                              key={cert.id}
                              className="flex items-center justify-between gap-3 p-3 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-ink-900">{cert.name}</span>
                                <Badge
                                  tone={
                                    cert.status === "verified"
                                      ? "success"
                                      : cert.status === "rejected"
                                        ? "danger"
                                        : "warning"
                                  }
                                >
                                  {cert.status}
                                </Badge>
                              </div>
                              {cert.documentUrl && (
                                <ButtonAnchor
                                  href={cert.documentUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  size="sm"
                                  variant="ghost"
                                  className="text-xs text-brand-600 hover:text-brand-700"
                                >
                                  <ExternalLink className="mr-1 size-3" />
                                  View Certificate
                                </ButtonAnchor>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {record.certifications && certificatesList.length === 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-ink-500">Certifications</h3>
                        <p className="mt-1 whitespace-pre-wrap text-ink-800">
                          {record.certifications}
                        </p>
                      </div>
                    )}

                    {record.achievements && (
                      <div>
                        <h3 className="text-xs font-semibold text-ink-500">
                          Achievements & Honors
                        </h3>
                        <p className="mt-1 whitespace-pre-wrap text-ink-800">
                          {record.achievements}
                        </p>
                      </div>
                    )}

                    {!record.technicalSkills &&
                      !record.areasOfInterest &&
                      !record.projects &&
                      !record.certifications &&
                      certificatesList.length === 0 &&
                      !record.achievements && (
                        <p className="text-xs text-ink-500">
                          No additional project or portfolio details filed in SRF.
                        </p>
                      )}
                  </div>
                </Card>
              </section>
            )}
          </div>

          {/* Right 1 Column: Preferences, Resumes, Assessed Skills, Contacts & Profiles */}
          <div className="space-y-6 lg:col-span-1">
            {/* Resumes on File Card (with Staff Upload/Replace) */}
            {(activeSection === "preferences" || activeSection === "all") && (
              <section aria-label="Resumes">
                <Card className="p-5 shadow-xs transition-shadow hover:shadow-sm">
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
                                  <p
                                    className="truncate font-medium text-ink-700"
                                    title={doc.fileName}
                                  >
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
            )}

            {/* Role & Drive Preferences Card */}
            {(activeSection === "preferences" || activeSection === "all") && (
              <section aria-label="Skills and preferences">
                <Card className="p-5 shadow-xs transition-shadow hover:shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-violet-50 p-1.5 text-violet-700">
                        <Sparkles className="size-4" />
                      </div>
                      <h2 className="font-heading text-lg font-bold text-ink-900">
                        Skills and preferences
                      </h2>
                    </div>
                    {hasStaffControls && (
                      <Button variant="ghost" size="sm" onClick={openPreferencesModal}>
                        <Edit2 className="mr-1 size-3" />
                        Edit
                      </Button>
                    )}
                  </div>

                  {/* Assessed skill scores — one row per skill, the bar shows what the fraction means */}
                  {skills.length === 0 ? (
                    <p className="text-sm text-ink-500">No skill scores recorded.</p>
                  ) : (
                    <ul className="divide-y divide-line text-sm">
                      {skills.map(({ skill, score }) => (
                        <li key={skill} className="flex items-center gap-3 py-2 first:pt-0">
                          <span className="min-w-0 flex-1 break-words font-medium text-ink-900 [overflow-wrap:anywhere]">
                            {skill} {score}/{SKILL_SCORE_MAX}
                          </span>
                          <span
                            aria-hidden="true"
                            className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-line"
                          >
                            <span
                              className={`block h-full rounded-full ${
                                score >= 4
                                  ? "bg-success-500"
                                  : score >= 3
                                    ? "bg-brand-500"
                                    : "bg-gold-500"
                              }`}
                              style={{
                                width: `${Math.round((score / SKILL_SCORE_MAX) * 100)}%`,
                              }}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Preferred role categories */}
                  {rolePreferences.length > 0 && (
                    <div className="mt-3 border-t border-line pt-3">
                      <span className="text-xs font-semibold text-ink-500">Preferred areas</span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {rolePreferences.map((area) => (
                          <Badge key={area} tone="brand">
                            {AREA_LABEL[area] ?? area}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Drive type preferences */}
                  <div className="mt-3 border-t border-line pt-3">
                    <span className="text-xs font-semibold text-ink-500">
                      Drive Type Preferences:
                    </span>
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
            )}

            {/* Online & Coding Profiles Card */}
            {(activeSection === "portfolio" || activeSection === "all") && (
              <section aria-label="Online profiles">
                <Card className="p-5 shadow-xs transition-shadow hover:shadow-sm">
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
                          <span className="font-mono font-bold text-success-600">HR</span>{" "}
                          HackerRank
                        </span>
                        <ExternalLink className="size-3.5 text-ink-400" />
                      </a>
                    )}
                    {/* Custom other profiles */}
                    {record.otherProfiles?.map((p) => (
                      <a
                        key={`${p.label}-${p.value}`}
                        href={p.value.startsWith("http") ? p.value : `https://${p.value}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center justify-between rounded-lg border border-line p-2 hover:bg-surface-muted"
                      >
                        <span className="flex items-center gap-2 text-ink-900">
                          <Globe className="size-4 text-violet-500" /> {p.label}
                        </span>
                        <ExternalLink className="size-3.5 text-ink-400" />
                      </a>
                    ))}
                    {!record.linkedinUrl &&
                      !record.githubUrl &&
                      !record.leetcodeUrl &&
                      !record.hackerrankUrl &&
                      (!record.otherProfiles || record.otherProfiles.length === 0) && (
                        <p className="text-xs text-ink-500">No profile links recorded.</p>
                      )}
                  </div>
                </Card>
              </section>
            )}
          </div>
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

      {/* Status moves — 0133's restore and 0134's withdrawal, each on a mandatory reason */}
      {isRestoreOpen && restorePlan !== null && (
        <StatusChangeDialog
          plan={restorePlan}
          onClose={() => setIsRestoreOpen(false)}
          onDone={statusMoveDone}
        />
      )}

      {withdrawTarget !== null && statusChanges !== undefined && (
        <StatusChangeDialog
          plan={withdrawalPlanOf(withdrawTarget, statusChanges)}
          onClose={() => setWithdrawTarget(null)}
          onDone={statusMoveDone}
        />
      )}
    </div>
  );
}
