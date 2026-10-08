import {
  CheckboxField,
  controlClass,
  Field,
  FileField,
  FormSection as Section,
  getControlClass,
  TextField,
} from "@components/form";
import { MAX_SEMESTERS } from "@domain/academics";
import { boardLabel, INDIAN_STATES, SCHOOL_BOARDS, type SchoolLevel } from "@domain/boards";
import { marksScaleQuestion, UG_COLLEGE_MARKS_SCALE_QUESTION } from "@domain/marks";
import { missingMarksheets, requiredMarksheets } from "@domain/marksheets";
import { MAX_OTHER_PROFILES } from "@domain/profile-links";
import { programmeKey, programmeLabel, splitProgrammeKey } from "@domain/programmes";
import { srfAccess } from "@domain/srf-access";
import { mergeSrfDraft, srfValuesFromSubmitted } from "@domain/srf-draft";
import { srfCompletion, srfSectionProgress } from "@domain/srf-progress";
import { filenameToCertificateName } from "@domain/storage-path";
import type { SrfStatus } from "@domain/types";
import { ROLE_CATEGORIES, type RoleCategory } from "@domain/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuthActions } from "@lib/auth-context";
import { forwardRef, type SelectHTMLAttributes, useEffect, useId, useRef, useState } from "react";
import { Controller, type FieldErrors, useFieldArray, useForm } from "react-hook-form";
import { Link } from "react-router";
import type { AddSemesterView } from "./add-semester";
import { SrfSubmitError, saveSrfDraft, submitSrf } from "./srf-api";
import type { SrfProfile } from "./srf-profile";
import { SRF_DEFAULTS, type SrfFormValues, type SrfSubmission, srfSchema } from "./srf-schema";
import { SrfSummary } from "./srf-summary";

/** Student Registration Form — PRD §4.1. */

/**
 * Six, not seven. "Do not keep marksheet upload as a separate section 3.
 * upload near relevant fields in section 2 itself" (2026-08-06) - a student
 * had to enter a mark in one section and find its document in another,
 * matching them up from memory.
 */
export const SRF_SECTIONS = [
  { id: "personal", title: "Personal details", step: 1 },
  { id: "academic", title: "Academic record", step: 2 },
  { id: "preferences", title: "Placement preferences", step: 3 },
  { id: "profiles", title: "Professional profiles", step: 4 },
  { id: "additional", title: "Skills and achievements", step: 5 },
  { id: "consent", title: "Consent and submission", step: 6 },
] as const;

export const ROLE_CATEGORY_LABELS: Readonly<Record<RoleCategory, string>> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

/**
 * Which scale a college reports on. Asked for 2026-08-06: "some colleges have
 * CGPA and some have % in college marks. have an option for students to select
 * relevant field and enter that."
 *
 * Its own control rather than a guess from the magnitude of the number: 8 is a
 * plausible CGPA and an implausible percentage, but 65 is ambiguous the other
 * way round, and guessing wrong changes who is eligible for a drive.
 */
const ScaleSelect = forwardRef<
  HTMLSelectElement,
  { label: string; error?: string | undefined } & SelectHTMLAttributes<HTMLSelectElement>
>(function ScaleSelect({ label, error, ...props }, ref) {
  const id = useId();
  const hasError = error !== undefined && error.trim() !== "";
  return (
    <div>
      <label
        htmlFor={id}
        className={`mb-1.5 block text-sm transition-colors ${hasError ? "font-semibold text-danger-700" : "font-medium text-ink-700"
          }`}
      >
        <span>{label}</span>
        {hasError && (
          <span
            aria-hidden="true"
            className="ml-2 inline-flex items-center rounded bg-danger-100 px-1.5 py-0.5 text-[11px] font-bold text-danger-800"
          >
            Invalid
          </span>
        )}
      </label>
      <select
        id={id}
        ref={ref}
        aria-invalid={hasError ? true : undefined}
        className={getControlClass(hasError, "w-full rounded-lg px-3 py-2.5 text-sm")}
        {...props}
      >
        <option value="cgpa">CGPA (out of 10)</option>
        <option value="percentage">Cumulative percentage (%)</option>
      </select>
      {hasError && (
        <p role="alert" className="mt-1 text-xs font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
});

/**
 * Which board issued a school mark (2026-08-18).
 *
 * A select, because free text gives `cbse`, `C.B.S.E.` and `Central Board` -
 * four boards to Postgres, one to a human, and no report can group them. The
 * labels come from the domain, so class 10 reads ICSE and class 12 reads ISC
 * from the one stored value.
 */
const BoardSelect = forwardRef<
  HTMLSelectElement,
  {
    label: string;
    level: SchoolLevel;
    error?: string | undefined;
    required?: boolean | undefined;
  } & SelectHTMLAttributes<HTMLSelectElement>
>(function BoardSelect({ label, level, error, required = true, ...props }, ref) {
  const id = useId();
  const hasError = error !== undefined && error.trim() !== "";
  return (
    <div>
      <label
        htmlFor={id}
        className={`mb-1.5 block text-sm transition-colors ${hasError ? "font-semibold text-danger-700" : "font-medium text-ink-700"
          }`}
      >
        <span>{label}</span>
        {required && (
          <>
            <span className="ml-0.5 text-danger-500" aria-hidden="true">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
        {hasError && (
          <span
            aria-hidden="true"
            className="ml-2 inline-flex items-center rounded bg-danger-100 px-1.5 py-0.5 text-[11px] font-bold text-danger-800"
          >
            Invalid
          </span>
        )}
      </label>
      <select
        id={id}
        ref={ref}
        aria-required={required ? true : undefined}
        aria-invalid={hasError ? true : undefined}
        className={getControlClass(hasError)}
        {...props}
      >
        <option value="">Select…</option>
        {SCHOOL_BOARDS.map((board) => (
          <option key={board} value={board}>
            {boardLabel(board, level)}
          </option>
        ))}
      </select>
      {hasError && (
        <p role="alert" className="mt-1 text-xs font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
});

function ErrorText({ children }: { children?: string | undefined }) {
  if (children === undefined) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-danger-700">
      {children}
    </p>
  );
}

const grid = "grid gap-4 sm:grid-cols-2";

/**
 * An unanswered control, as the domain expects to hear about it.
 *
 * A `<select>` says "" and a defaulted field can be `undefined`; both mean the
 * same thing to every rule that reads them, and collapsing them here keeps that
 * translation in one place rather than at six call sites.
 */
const unanswered = (value: string | undefined): string | null =>
  value === undefined || value.trim() === "" ? null : value;

/**
 * `profile` is the student's roster record. Name, roll number and email are
 * not theirs to type - those fields are disabled - so without it the form
 * cannot be completed at all.
 */
export function SrfPage({
  profile,
  /** The student's unsent form, if they have one. */
  draft,
  /**
   * Where the form is in its life. Decides whether this is a form at all:
   * once submitted it is evidence a coordinator is checking, and after
   * approval §7.2 has already judged eligibility against it.
   */
  status = "registered",
  /** Why a coordinator sent it back, so the student knows what to correct. */
  rejectionReason,
  /** Injected so the page can be tested without a database. */
  saveDraft = (values: unknown) => saveSrfDraft(values),
  /** F13: adding a semester that finished after the form was approved. */
  addSemester,
  /**
   * F6: what this student's college runs for their passing year. One entry per
   * choice, because degree+branch IS one choice.
   */
  programmes = [],
}: {
  profile?: SrfProfile | null;
  draft?: unknown;
  status?: SrfStatus;
  rejectionReason?: string | null;
  saveDraft?: (values: unknown) => Promise<boolean>;
  addSemester?: AddSemesterView;
  programmes?: readonly { readonly degree: string; readonly branch: string }[];
}) {
  const { signOut } = useAuthActions();
  /**
   * What this student may do with this form right now. The rule is the
   * domain's; this screen only obeys it.
   */
  const access = srfAccess(status);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    getValues,
    trigger,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SrfFormValues>({
    resolver: zodResolver(srfSchema),
    /**
     * Roster beats draft beats defaults - the order is a domain rule, because
     * a draft can be weeks older than a roster correction and must never
     * quietly restore a stale roll number for verification to fail on.
     */
    /**
     * Roster beats draft beats WHAT WAS SUBMITTED beats defaults.
     *
     * The last of those is new (2026-08-18). `submit_srf` clears the draft, so a
     * form sent back for changes used to open BLANK - the student retyped every
     * mark, school and phone number to correct one line, and a figure retyped
     * from memory is a figure that can be mistyped. A real draft still wins:
     * it was saved AFTER the rejection, so it is the newer correction.
     *
     * ONLY on a rejected form. A first-time student has submitted nothing, and
     * restoring "nothing" over the defaults would blank the form they are
     * filling in.
     */
    defaultValues: mergeSrfDraft(
      SRF_DEFAULTS as unknown as Record<string, unknown>,
      profile === null || profile === undefined ? null : { ...profile },
      draft ??
      (status === "srf_rejected" && profile != null ? srfValuesFromSubmitted(profile) : null),
    ) as unknown as SrfFormValues,
    mode: "onTouched",
  });

  const selectedCategories = watch("roleCategories");
  /**
   * The resume FILES, keyed by role category (P10). The form used to keep a
   * list of categories whose box had been touched and throw the files away.
   */
  const resumes = watch("resumes");
  const resumeCategories = Object.keys(resumes ?? {}) as RoleCategory[];
  const programmeLevel = watch("programmeLevel");
  const semesters = watch("semesters");
  const diplomaMarks = watch("diplomaMarks");
  // F6: one control, two stored fields. Students still carry a degree and a
  // branch - every eligibility rule and every drive targeting table reads
  // them - so the single choice is split back apart on selection.
  const degreeValue = watch("degree") ?? "";
  const branchValue = watch("branch") ?? "";
  /**
   * Stable row identity, so removing the second profile does not leave React
   * carrying its input state over to the third. An array index as a key does
   * exactly that.
   */
  const collegeMarksScale = watch("collegeMarksScale");
  /**
   * The second half of a board answer is only asked when the board needs one:
   * "which state" for a State Board, "name it" for Other. Asking either of the
   * other five invites an answer that is not true, and `0048` refuses that pair
   * - so the student would be blocked by a field the form told them to fill in.
   */
  const tenthBoard = watch("tenthBoard");
  const twelfthBoard = watch("twelfthBoard");

  const handleTenthBoardChange = (newBoard: string) => {
    setValue("tenthBoard", newBoard, { shouldValidate: true, shouldDirty: true });
    if (newBoard !== "state_board") {
      setValue("tenthBoardState", "", { shouldValidate: true, shouldDirty: true });
    }
    if (newBoard !== "other") {
      setValue("tenthBoardOther", "", { shouldValidate: true, shouldDirty: true });
    }
    if (newBoard !== "cambridge" && newBoard !== "other") {
      setValue("tenthGrade", "", { shouldValidate: true, shouldDirty: true });
    }
    void trigger([
      "tenthBoard",
      "tenthBoardState",
      "tenthBoardOther",
      "tenthGrade",
      "tenthPercentage",
    ]);
  };

  const handleTwelfthBoardChange = (newBoard: string) => {
    setValue("twelfthBoard", newBoard, { shouldValidate: true, shouldDirty: true });
    if (newBoard !== "state_board") {
      setValue("twelfthBoardState", "", { shouldValidate: true, shouldDirty: true });
    }
    if (newBoard !== "other") {
      setValue("twelfthBoardOther", "", { shouldValidate: true, shouldDirty: true });
    }
    if (newBoard !== "cambridge" && newBoard !== "other") {
      setValue("twelfthGrade", "", { shouldValidate: true, shouldDirty: true });
    }
    void trigger([
      "twelfthBoard",
      "twelfthBoardState",
      "twelfthBoardOther",
      "twelfthGrade",
      "twelfthPercentage",
    ]);
  };

  const handleProgrammeLevelChange = (value: "ug" | "pg") => {
    setValue("programmeLevel", value, { shouldValidate: true, shouldDirty: true });
    if (value === "ug") {
      setValue("ugDegree", "", { shouldValidate: true, shouldDirty: true });
      setValue("ugCollege", "", { shouldValidate: true, shouldDirty: true });
      setValue("ugBranch", "", { shouldValidate: true, shouldDirty: true });
      setValue("ugAggregate", null, { shouldValidate: true, shouldDirty: true });
      setValue("ugAggregateScale", "cgpa", { shouldValidate: true, shouldDirty: true });
      const currentSheets = (getValues("marksheets") as Record<string, File> | undefined) ?? {};
      const nextSheets = { ...currentSheets };
      delete nextSheets.ug_consolidated;
      setValue("marksheets", nextSheets, { shouldValidate: true, shouldDirty: true });
      setValue("semesters", semesters.slice(0, MAX_SEMESTERS.ug), {
        shouldValidate: true,
        shouldDirty: true,
      });
    } else {
      const sliced = semesters.slice(0, MAX_SEMESTERS.pg);
      setValue("semesters", sliced, { shouldValidate: true, shouldDirty: true });
      const currentSheets = (getValues("marksheets") as Record<string, File> | undefined) ?? {};
      const nextSheets = { ...currentSheets };
      for (let i = MAX_SEMESTERS.pg + 1; i <= 10; i++) {
        delete nextSheets[`semester-${i}`];
      }
      setValue("marksheets", nextSheets, { shouldValidate: true, shouldDirty: true });
    }
    void trigger([
      "programmeLevel",
      "ugDegree",
      "ugCollege",
      "ugBranch",
      "ugAggregate",
      "semesters",
      "marksheets",
    ]);
  };

  const handleCollegeMarksScaleChange = async (newScale: string) => {
    setValue("collegeMarksScale", newScale as "cgpa" | "percentage", {
      shouldValidate: true,
      shouldDirty: true,
    });
    const currentSemesters = getValues("semesters") ?? [];
    const marksFields = currentSemesters.map((_, i) => `semesters.${i}.marks` as const);
    await trigger([...marksFields, "semesters"]);
  };

  const handleDiplomaMarksScaleChange = (newScale: string) => {
    setValue("diplomaMarksScale", newScale as "cgpa" | "percentage", {
      shouldValidate: true,
      shouldDirty: true,
    });
    void trigger("diplomaMarks");
  };

  const handleUgAggregateScaleChange = (newScale: string) => {
    setValue("ugAggregateScale", newScale as "cgpa" | "percentage", {
      shouldValidate: true,
      shouldDirty: true,
    });
    void trigger("ugAggregate");
  };

  const handleRemoveSemester = (index: number) => {
    const currentSheets = (getValues("marksheets") as Record<string, File> | undefined) ?? {};
    const updatedSemesters = semesters
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, semesterNumber: i + 1 }));
    setValue("semesters", updatedSemesters, { shouldValidate: true, shouldDirty: true });

    const nextSheets = { ...currentSheets };
    delete nextSheets[`semester-${semesters.length}`];
    for (let i = index; i < updatedSemesters.length; i++) {
      const oldKey = `semester-${i + 2}`;
      const newKey = `semester-${i + 1}`;
      const oldVal = currentSheets[oldKey];
      if (oldVal !== undefined) {
        nextSheets[newKey] = oldVal;
      } else {
        delete nextSheets[newKey];
      }
    }
    delete nextSheets[`semester-${semesters.length}`];
    setValue("marksheets", nextSheets, { shouldValidate: true, shouldDirty: true });
    void trigger(["semesters", "marksheets"]);
  };
  const otherProfiles = useFieldArray({ control, name: "otherProfiles" });
  /**
   * F17: a certificate is a NAME and a FILE. The free-text "Certifications"
   * box it replaces was both failures at once - nothing in it could be
   * verified, and nothing in it was unique, which is what F9 reported.
   */
  const certificates = useFieldArray({ control, name: "certificates" });
  const maxSemesters = MAX_SEMESTERS[programmeLevel];
  const hasDiplomaMarks = diplomaMarks !== null && !Number.isNaN(diplomaMarks);

  /**
   * The marksheets the student has chosen, held in FORM state.
   *
   * They used to be a bag of booleans beside the form, because the files were
   * not part of the submission at all - the student picked them and they were
   * discarded. Nothing was stored, so the coordinator's queue had nothing to
   * check the declared CGPA against, which is the entire point of
   * verification. They are now submitted, uploaded and linked to the semester
   * row they evidence.
   */
  const marksheets = watch("marksheets");

  /**
   * Which documents are required is derived from what the student declared -
   * one per semester line, plus the two school marksheets, plus a completed
   * UG degree for a postgraduate.
   *
   * This list used to be driven by its OWN counter with its own "add another
   * semester" button, so the form opened asking for two semester marksheets
   * while the academic record had one semester line, and nothing kept the two
   * in step.
   */
  const requiredSheets = requiredMarksheets({
    programmeLevel,
    semesters: semesters ?? [],
    hasDiplomaMarks,
  });

  /**
   * Each upload now sits beside the figure it evidences (2026-08-06): "do not
   * keep marksheet upload as a separate section 3. upload near relevant fields
   * in section 2 itself."
   *
   * A student used to enter a mark in one section and hunt for its document in
   * another, matching them up from memory - which is also how a marksheet ends
   * up filed against the wrong semester.
   */
  const slotFor = (key: string) => requiredSheets.find((s) => s.key === key);

  const marksheetError = (key: string) => {
    const slotErr = (
      errors.marksheets as Record<string, { message?: string } | undefined> | undefined
    )?.[key];
    if (slotErr?.message) return slotErr.message;
    if (errors.marksheets !== undefined && marksheets[key] === undefined) {
      return `${slotFor(key)?.label ?? "This marksheet"} is required.`;
    }
    return undefined;
  };

  const chooseMarksheet = (key: string, file: File | undefined) => {
    const next = { ...marksheets };
    if (file === undefined) {
      delete next[key];
    } else {
      next[key] = file;
    }
    setValue("marksheets", next, { shouldValidate: true, shouldDirty: true });
  };

  const rawTenth = watch("tenthPercentage");
  const rawTwelfth = watch("twelfthPercentage");
  const tenthPercentage: number | null =
    typeof rawTenth === "number" && !Number.isNaN(rawTenth) ? rawTenth : null;
  const twelfthPercentage: number | null =
    typeof rawTwelfth === "number" && !Number.isNaN(rawTwelfth) ? rawTwelfth : null;

  const progressInput = {
    mobile: watch("mobile") ?? "",
    alternateContact: watch("alternateContact") ?? "",
    tenthPercentage,
    tenthGrade: watch("tenthGrade") ?? "",
    twelfthPercentage,
    twelfthGrade: watch("twelfthGrade") ?? "",
    degree: degreeValue,
    programmeLevel,
    // The field is optional in the form's input type, but "not yet entered"
    // and "deliberately none" are the same thing to the tracker.
    tenthInstitution: watch("tenthInstitution") ?? "",
    twelfthInstitution: watch("twelfthInstitution") ?? "",
    // Mandatory since 2026-08-18, so the tracker must not read 100% without it.
    tenthBoard: unanswered(tenthBoard),
    tenthBoardState: unanswered(watch("tenthBoardState")),
    tenthBoardOther: unanswered(watch("tenthBoardOther")),
    twelfthBoard: unanswered(twelfthBoard),
    twelfthBoardState: unanswered(watch("twelfthBoardState")),
    twelfthBoardOther: unanswered(watch("twelfthBoardOther")),
    hasDiplomaMarks,
    ugAggregateCgpa: watch("ugAggregate") ?? null,
    semesters: (semesters ?? []).map((s) => ({
      semesterNumber: s.semesterNumber,
      cgpa: s.marks,
    })),
    marksheets: Object.keys(marksheets ?? {}),
    roleCategories: selectedCategories,
    resumeCategories,
    consent: watch("consent") === true,
  };

  const hasProfiles = Boolean(
    (watch("linkedin") ?? "").trim() !== "" ||
    (watch("github") ?? "").trim() !== "" ||
    (watch("leetcode") ?? "").trim() !== "" ||
    (watch("hackerrank") ?? "").trim() !== "" ||
    ((watch("otherProfiles") ?? []).some((p) => (p.label ?? "").trim() !== "" || (p.value ?? "").trim() !== ""))
  );

  const hasAdditional = Boolean(
    (watch("technicalSkills") ?? "").trim() !== "" ||
    (watch("areasOfInterest") ?? "").trim() !== "" ||
    (watch("areasOfExpertise") ?? "").trim() !== "" ||
    (watch("projects") ?? "").trim() !== "" ||
    (watch("achievements") ?? "").trim() !== "" ||
    ((watch("certificates") ?? []).some((c) => (c.name ?? "").trim() !== "" || c.file !== null))
  );

  /**
   * Auto-save (UAT 2026-08-05).
   *
   * Debounced, because saving on every keystroke would be a request per
   * character. It deliberately does nothing until the student has actually
   * changed something: an untouched form has nothing worth storing, and
   * writing one would tell them their entries were saved when there are none.
   */
  const savingRef = useRef(false);

  /**
   * The auto-save callback, held by reference rather than by identity.
   *
   * `saveDraft` is a DEFAULT PARAMETER, so when the page is used for real -
   * which is to say, whenever it is not a test passing its own stub in - it is
   * a brand-new function on every render. With it in the effect's dependency
   * array, a save re-rendered the page, the re-render made a new callback, the
   * new callback re-ran the effect, and the effect saved again a second later.
   *
   * That ran for as long as the tab was open. One student on this form wrote
   * ~50 rows a minute to `students` for 35 minutes (audit log, 2026-08-05),
   * and because auditing is append-only every one of those is permanent.
   *
   * The effect wants the LATEST callback, never the identity of one, so keep
   * it in a ref and depend on the form contents alone.
   */
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;

  /**
   * The dependency is the SERIALISED form, not the object.
   *
   * `watch()` returns a fresh object every render, so depending on it would
   * restart the debounce for ever and never save. Serialising also makes what
   * is stored exactly what survives the round trip into a jsonb column, rather
   * than something that looks right in memory and comes back different.
   */
  /**
   * The dependency is the SERIALISED form, minus the files.
   *
   * A File does not survive JSON - it stringifies to `{}` - so leaving them in
   * would store `{"tenth": {}}` in the draft and the next visit would restore
   * a marksheet that is not there, count it as provided, and let the student
   * submit unevidenced marks. The uploads are deliberately re-picked.
   */
  const serialised = JSON.stringify({
    ...watch(),
    marksheets: {},
    resumes: {},
    certificates: (watch("certificates") ?? []).map((c) => ({
      name: c?.name ?? "",
      file: null,
    })),
  });

  useEffect(() => {
    if (!isDirty) return;

    const timer = setTimeout(() => {
      if (savingRef.current) return;
      savingRef.current = true;
      setDraftState("saving");

      void saveDraftRef
        .current(JSON.parse(serialised))
        .then((ok) => {
          setDraftState(ok ? "saved" : "failed");
          if (ok) setDraftSavedAt(new Date());
        })
        .finally(() => {
          savingRef.current = false;
        });
    }, 1000);

    return () => clearTimeout(timer);
  }, [serialised, isDirty]);

  const saveNow = async () => {
    setDraftState("saving");
    const ok = await saveDraft(JSON.parse(serialised));
    setDraftState(ok ? "saved" : "failed");
    if (ok) setDraftSavedAt(new Date());
  };

  const progress = srfSectionProgress(progressInput);
  const completion = srfCompletion(progressInput);

  const [submitAttempted, setSubmitAttempted] = useState(false);

  const onInvalid = (fieldErrors: FieldErrors<SrfFormValues>) => {
    setSubmitAttempted(true);
    const firstKey = Object.keys(fieldErrors)[0];
    if (firstKey) {
      const el =
        document.querySelector(`[name="${firstKey}"]`) ||
        document.getElementById(firstKey) ||
        document.querySelector(`#${firstKey}`);
      if (el) {
        el.scrollIntoView?.({ behavior: "smooth", block: "center" });
        (el as HTMLElement).focus?.();
      }
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitAttempted(false);
    setServerError(null);
    try {
      await submitSrf(values as SrfSubmission);
      setSubmitted(true);
    } catch (error) {
      setServerError(
        error instanceof SrfSubmitError ? error.message : "Something went wrong. Please try again.",
      );
    }
  }, onInvalid);

  const num = (name: Parameters<typeof register>[0]) =>
    register(name, { setValueAs: (v) => (v === "" ? Number.NaN : Number(v)) });

  /**
   * For the two figures a student may legitimately not have: an empty box is
   * NULL, not NaN. "They have no diploma" and "they typed something
   * unreadable" are different answers and must not collapse into one.
   */
  const nullableNum = (name: Parameters<typeof register>[0]) =>
    register(name, { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) });

  if (submitted) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
        <div className="w-full rounded-card border border-line bg-surface p-8 text-center shadow-sm">
          <p className="font-heading text-2xl font-bold text-ink-900">Submitted for verification</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            Your Campus Placement Coordinator will check your entries against your uploaded
            marksheets. You will be notified once approved — you can apply to drives from that point
            on.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="fpc-gradient h-1" aria-hidden="true" />
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <img
            src="/brand/faceprep-campus-dark.png"
            alt="FACE Prep Campus"
            className="h-7 w-auto"
          />
          <div className="flex items-center gap-2">
            {/* A student filling this in had no way back to their own
                dashboard, or to anything else. */}
            <Link
              to="/student"
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-muted"
            >
              My dashboard
            </Link>
            {/* This screen has its own chrome, so it needs its own way out.
                For a student it is the first screen they ever see. */}
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-muted"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl text-ink-900 sm:text-3xl">Student Registration Form</h1>
          {access.mode === "edit" && (
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Complete every section carefully. Your entries will be{" "}
              <strong className="font-semibold text-ink-700">
                verified by your Campus Placement Coordinator
              </strong>{" "}
              against your uploaded marksheets. You can only receive and apply to drives once your
              form is approved.
            </p>
          )}
        </div>

        {/*
         * A submitted form is not a form. The coordinator is comparing it to a
         * marksheet line by line, and after approval §7.2 has already judged
         * eligibility against it - so it is shown back as text, with no way to
         * change it from here.
         */}
        {access.mode === "view" && profile != null && (
          <SrfSummary
            profile={profile}
            access={access}
            {...(addSemester === undefined ? {} : { addSemester })}
          />
        )}

        {/*
         * Sent back. The reason is shown at the top of the form, because it is
         * the only thing that tells the student what to actually change.
         */}
        {access.mode === "edit" && rejectionReason != null && rejectionReason.trim() !== "" && (
          <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="font-semibold text-sm text-destructive">{access.headline}</p>
            <p className="mt-1 text-sm text-ink-700">{rejectionReason}</p>
          </div>
        )}

        {/*
         * The one thing that does NOT survive being sent back, said plainly.
         *
         * Everything the student typed is prefilled; a File cannot be handed
         * back to a browser, and `submit_srf` rewrites the semester lines, so
         * the old marksheet links go with them. A student who assumes their
         * scans are still attached meets a validation error they cannot explain.
         */}
        {access.mode === "edit" && status === "srf_rejected" && (
          <div className="mb-6 rounded-xl border border-line bg-surface p-4">
            <p className="text-sm text-ink-700">
              <strong className="font-semibold text-ink-900">
                Everything you typed is already filled in below.
              </strong>{" "}
              Only your marksheet uploads need attaching again — your marks are checked against the
              documents you attach, so they have to come with this submission.
            </p>
          </div>
        )}

        {access.mode === "edit" && (
          <>
            {/* Was hardcoded: step 1 lit on load, the other six never. It now
            reads the domain rule, and every pill is a link back to its
            section - the student had no way to review what they had entered. */}
            <nav aria-label="Form progress" className="mb-6">
              <ol className="flex flex-wrap gap-1.5">
                {progress.map((s) => {
                  const isComplete =
                    s.optional
                      ? (s.id === "profiles" && hasProfiles) ||
                      (s.id === "additional" && hasAdditional)
                      : s.complete;

                  return (
                    <li key={s.id} className="min-w-9 flex-1">
                      <a
                        href={`#${s.id}`}
                        aria-current={isComplete ? "step" : undefined}
                        aria-label={`${s.title}${isComplete ? " — done" : ""}`}
                        title={s.title}
                        className={`block rounded-full py-1 text-center text-[10px] font-semibold transition-colors ${isComplete
                            ? "bg-brand-500 text-white"
                            : "bg-line text-ink-500 hover:bg-brand-50 hover:text-brand-600"
                          }`}
                      >
                        {isComplete ? "\u2713" : s.step}
                      </a>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-500">
                  <span className="font-semibold text-ink-700">{completion}% complete</span> — your
                  entries are saved as you go.
                </p>

                {/* Said out loud, because "saved as you go" is a promise, and a
                student who has just typed for ten minutes deserves to see it
                kept - or to be told plainly that it was not. */}
                <span role="status" className="text-xs text-ink-500">
                  {draftState === "saving" && "Saving…"}
                  {draftState === "saved" &&
                    draftSavedAt !== null &&
                    `Draft saved at ${draftSavedAt.toLocaleTimeString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`}
                  {draftState === "failed" && (
                    <span className="text-danger-700">
                      Your draft could not be saved. Check your connection.
                    </span>
                  )}
                </span>
              </div>
            </nav>

            <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
              <Section
                id="personal"
                title="Personal details"
                step={1}
                description="How we and recruiters reach you."
              >
                <div className={grid}>
                  <div>
                    <TextField
                      label="Full name"
                      required
                      error={errors.fullName?.message}
                      {...register("fullName")}
                    />
                  </div>
                  <div>
                    <TextField label="Roll number" required disabled {...register("rollNumber")} />
                  </div>
                  <div>
                    <TextField
                      label="Email ID"
                      type="email"
                      required
                      error={errors.email?.message}
                      {...register("email")}
                    />
                  </div>
                  <div>
                    <TextField
                      label="Mobile number"
                      type="tel"
                      required
                      error={errors.mobile?.message}
                      placeholder="10-digit mobile"
                      {...register("mobile")}
                    />
                  </div>
                  <div>
                    <TextField
                      label="WhatsApp number"
                      type="tel"
                      error={errors.whatsapp?.message}
                      placeholder="If different"
                      {...register("whatsapp")}
                    />
                  </div>
                  <div>
                    <TextField
                      label="Alternate contact number"
                      type="tel"
                      required
                      error={errors.alternateContact?.message}
                      hint="A number that reaches you if your main one does not."
                      {...register("alternateContact")}
                    />
                  </div>
                </div>
              </Section>

              <Section
                id="academic"
                title="Academic record"
                step={2}
                description="Every figure here is verified against the document beside it, so upload each one as you go."
              >
                {/* SCHOOL. The institution comes before the marks it issued, and
                the marksheet sits with them - not in a separate section the
                student had to match up from memory. */}
                <fieldset className="rounded-lg border border-line p-4">
                  <legend className="px-1 text-sm font-semibold text-ink-700">Class 10</legend>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <TextField
                        label="10th school name"
                        required
                        error={errors.tenthInstitution?.message}
                        placeholder="School you did your 10th at"
                        {...register("tenthInstitution")}
                      />
                    </div>
                    {/* The board comes with the school that issued the marks
                    (2026-08-18), because a coordinator verifies both against
                    the one document. */}
                    <div>
                      <BoardSelect
                        label="10th board"
                        level="tenth"
                        error={errors.tenthBoard?.message}
                        {...register("tenthBoard", {
                          onChange: (e) => handleTenthBoardChange(e.target.value),
                        })}
                      />
                    </div>
                    {tenthBoard === "state_board" && (
                      <div>
                        <Field
                          label="Which state's board?"
                          required
                          error={errors.tenthBoardState?.message}
                        >
                          {(id) => (
                            <select
                              id={id}
                              className={getControlClass(Boolean(errors.tenthBoardState))}
                              {...register("tenthBoardState", {
                                onChange: () => void trigger("tenthBoardState"),
                              })}
                            >
                              <option value="">Select…</option>
                              {INDIAN_STATES.map((state) => (
                                <option key={state} value={state}>
                                  {state}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                      </div>
                    )}
                    {tenthBoard === "other" && (
                      <div>
                        <TextField
                          label="Name the 10th board"
                          required
                          error={errors.tenthBoardOther?.message}
                          placeholder="As it appears on the marksheet"
                          {...register("tenthBoardOther")}
                        />
                      </div>
                    )}
                    {(tenthBoard === "cambridge" || tenthBoard === "other") && (
                      <div>
                        <TextField
                          label="10th grade"
                          required
                          error={errors.tenthGrade?.message}
                          placeholder="e.g. A*, A, B"
                          {...register("tenthGrade")}
                        />
                      </div>
                    )}
                    <div>
                      <TextField
                        label={
                          tenthBoard === "cambridge" || tenthBoard === "other"
                            ? "10th marks (%) (optional)"
                            : "10th marks (%)"
                        }
                        type="number"
                        step="0.01"
                        required={tenthBoard !== "cambridge" && tenthBoard !== "other"}
                        error={errors.tenthPercentage?.message}
                        placeholder="e.g. 91.4"
                        {...nullableNum("tenthPercentage")}
                      />
                    </div>
                    <FileField
                      label="10th marksheet"
                      required
                      error={marksheetError("tenth")}
                      onChange={(e) => chooseMarksheet("tenth", e.target.files?.[0])}
                    />
                  </div>
                </fieldset>

                <fieldset className="mt-4 rounded-lg border border-line p-4">
                  <legend className="px-1 text-sm font-semibold text-ink-700">Class 12</legend>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <TextField
                        label="12th school name"
                        required
                        error={errors.twelfthInstitution?.message}
                        placeholder="School you did your 12th at"
                        {...register("twelfthInstitution")}
                      />
                    </div>
                    <div>
                      <BoardSelect
                        label="12th board"
                        level="twelfth"
                        error={errors.twelfthBoard?.message}
                        {...register("twelfthBoard", {
                          onChange: (e) => handleTwelfthBoardChange(e.target.value),
                        })}
                      />
                    </div>
                    {twelfthBoard === "state_board" && (
                      <div>
                        <Field
                          label="Which state's board?"
                          required
                          error={errors.twelfthBoardState?.message}
                        >
                          {(id) => (
                            <select
                              id={id}
                              className={getControlClass(Boolean(errors.twelfthBoardState))}
                              {...register("twelfthBoardState", {
                                onChange: () => void trigger("twelfthBoardState"),
                              })}
                            >
                              <option value="">Select…</option>
                              {INDIAN_STATES.map((state) => (
                                <option key={state} value={state}>
                                  {state}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                      </div>
                    )}
                    {twelfthBoard === "other" && (
                      <div>
                        <TextField
                          label="Name the 12th board"
                          required
                          error={errors.twelfthBoardOther?.message}
                          placeholder="As it appears on the marksheet"
                          {...register("twelfthBoardOther")}
                        />
                      </div>
                    )}
                    {(twelfthBoard === "cambridge" || twelfthBoard === "other") && (
                      <div>
                        <TextField
                          label="12th grade"
                          required
                          error={errors.twelfthGrade?.message}
                          placeholder="e.g. A*, A, B"
                          {...register("twelfthGrade")}
                        />
                      </div>
                    )}
                    <div>
                      <TextField
                        label={
                          twelfthBoard === "cambridge" || twelfthBoard === "other"
                            ? "12th marks (%) (optional)"
                            : "12th marks (%)"
                        }
                        type="number"
                        step="0.01"
                        required={twelfthBoard !== "cambridge" && twelfthBoard !== "other"}
                        error={errors.twelfthPercentage?.message}
                        placeholder="e.g. 88.0"
                        {...nullableNum("twelfthPercentage")}
                      />
                    </div>
                    <FileField
                      label="12th marksheet"
                      required
                      error={marksheetError("twelfth")}
                      onChange={(e) => chooseMarksheet("twelfth", e.target.files?.[0])}
                    />
                  </div>
                </fieldset>

                {/* DIPLOMA. Optional to declare - many students have none - but
                all-or-nothing once begun: a figure with no college and no
                marksheet is a mark nobody can verify. */}
                <fieldset className="mt-4 rounded-lg border border-dashed border-line p-4">
                  <legend className="px-1 text-sm font-semibold text-ink-700">
                    Diploma <span className="font-normal text-ink-500">(optional)</span>
                  </legend>
                  <p className="mb-3 text-xs text-ink-500">
                    Leave blank if you did not do one. If you did, we need the college, who awarded
                    it, the result and the marksheet.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <TextField
                        label="Diploma college"
                        error={errors.diplomaInstitution?.message}
                        placeholder="College that issued it"
                        {...register("diplomaInstitution")}
                      />
                    </div>
                    {/* Who AWARDED it (2026-08-18). "University / Board" rather
                    than "University": many diplomas come from a state
                    technical-education board, and a field called University
                    invites that student to leave it blank. */}
                    <div>
                      <TextField
                        label="University / Board"
                        error={errors.diplomaUniversity?.message}
                        placeholder="Who awarded it — e.g. Anna University, or DOTE"
                        {...register("diplomaUniversity")}
                      />
                    </div>
                    {/* Scale before marks: the scale tells the student what the
                    box below expects, so asking for the figure first invites
                    them to type it on the wrong one. */}
                    <div className="grid grid-cols-2 gap-2">
                      <ScaleSelect
                        label="Diploma scale"
                        error={errors.diplomaMarksScale?.message}
                        {...register("diplomaMarksScale", {
                          onChange: (e) => handleDiplomaMarksScaleChange(e.target.value),
                        })}
                      />
                      <TextField
                        label="Diploma marks"
                        type="number"
                        step="0.01"
                        error={errors.diplomaMarks?.message}
                        {...nullableNum("diplomaMarks")}
                      />
                    </div>
                    {/* Offered, not demanded (2026-08-06). No diploma figure feeds
                    an eligibility cutoff. */}
                    <FileField
                      label="Diploma marksheet"
                      hint="Optional."
                      error={marksheetError("diploma")}
                      onChange={(e) => chooseMarksheet("diploma", e.target.files?.[0])}
                    />
                  </div>
                </fieldset>

                {/* THE FORK. Asked for 2026-08-06: this question comes immediately
                after school and diploma, because everything below it means
                something different depending on the answer. */}
                <fieldset className="mt-6">
                  <legend
                    className={`mb-2 text-sm transition-colors ${errors.programmeLevel
                        ? "font-semibold text-danger-700"
                        : "font-medium text-ink-700"
                      }`}
                  >
                    <span>Which are you pursuing?</span>
                    <span className="ml-0.5 text-danger-500" aria-hidden="true">
                      *
                    </span>
                    <span className="sr-only"> (required)</span>
                    {errors.programmeLevel && (
                      <span
                        aria-hidden="true"
                        className="ml-2 inline-flex items-center rounded bg-danger-100 px-1.5 py-0.5 text-[11px] font-bold text-danger-800"
                      >
                        Invalid
                      </span>
                    )}
                  </legend>
                  <div className="flex flex-wrap gap-4">
                    {(
                      [
                        ["ug", "Undergraduate (UG)"],
                        ["pg", "Postgraduate (PG)"],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2 text-sm text-ink-700">
                        <input
                          type="radio"
                          value={value}
                          checked={programmeLevel === value}
                          onChange={() => handleProgrammeLevelChange(value)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <ErrorText>{errors.programmeLevel?.message}</ErrorText>

                  {/* ONE selection for the whole degree (2026-08-06): "the metric
                  will not change semester to semester. It will be the same
                  throughout the UG/PG." Asking per semester invited eight
                  chances to answer inconsistently, and left eligibility
                  comparing figures that were never on the same scale. */}
                  {/* WHICH college, said out loud (2026-08-18). A postgraduate
                  has two - the PG they are on, whose semesters are below, and
                  the finished UG degree, which has its own figure and its own
                  scale. The old label said neither. */}
                  <div className="mt-4 max-w-sm">
                    <ScaleSelect
                      label={marksScaleQuestion(programmeLevel)}
                      error={errors.collegeMarksScale?.message}
                      {...register("collegeMarksScale", {
                        onChange: (e) => handleCollegeMarksScaleChange(e.target.value),
                      })}
                    />
                    <p className="mt-1 text-xs text-ink-500">
                      Applies to every semester below
                      {programmeLevel === "pg" ? " — those are your PG semesters." : "."}
                    </p>
                  </div>
                </fieldset>

                {/* A postgraduate has a whole finished degree behind them. The form
                used to ask only for its CGPA, which tells a recruiter nothing
                about where it was earned or in what. */}
                {programmeLevel === "pg" && (
                  <fieldset className="mt-4 rounded-lg border border-line bg-surface-muted p-4">
                    <legend className="px-1 text-sm font-semibold text-ink-700">
                      Your completed undergraduate degree
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <TextField
                          label="UG degree"
                          required
                          error={errors.ugDegree?.message}
                          placeholder="e.g. B.Sc Computer Science"
                          {...register("ugDegree")}
                        />
                      </div>
                      <div>
                        <TextField
                          label="UG college"
                          required
                          error={errors.ugCollege?.message}
                          placeholder="College you graduated from"
                          {...register("ugCollege")}
                        />
                      </div>
                      <div>
                        <TextField
                          label="UG branch"
                          required
                          error={errors.ugBranch?.message}
                          placeholder="e.g. Computer Science"
                          {...register("ugBranch")}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <ScaleSelect
                          label={UG_COLLEGE_MARKS_SCALE_QUESTION}
                          error={errors.ugAggregateScale?.message}
                          {...register("ugAggregateScale", {
                            onChange: (e) => handleUgAggregateScaleChange(e.target.value),
                          })}
                        />
                        <TextField
                          label="UG marks"
                          type="number"
                          step="0.01"
                          required
                          error={errors.ugAggregate?.message}
                          {...nullableNum("ugAggregate")}
                        />
                      </div>
                      <FileField
                        label="Consolidated UG marksheet"
                        hint="Optional."
                        error={marksheetError("ug_consolidated")}
                        onChange={(e) => chooseMarksheet("ug_consolidated", e.target.files?.[0])}
                      />
                    </div>
                  </fieldset>
                )}

                {/* THE PROGRAMME THEY ARE ON NOW. Below the fork, because for a PG
                student this is their PG and not the degree above. */}
                <div className="mt-6">
                  <p className="mb-3 text-sm font-semibold text-ink-700">
                    The {programmeLevel === "pg" ? "postgraduate" : "undergraduate"} degree you are
                    studying now
                  </p>
                  <div className={grid}>
                    {/*
                     * F6: ONE field. It used to be two hardcoded lists - eight
                     * degrees and seven branches - so a student could pair any
                     * degree with any branch, including pairs their college has
                     * never run. Every eligibility rule then reads that pair.
                     */}
                    <div>
                      <Field
                        label="Degree and branch"
                        required
                        error={errors.degree?.message ?? errors.branch?.message}
                      >
                        {(id) => {
                          const hasError = Boolean(errors.degree || errors.branch);
                          const hasCustomCurrent =
                            degreeValue !== "" &&
                            !programmes.some(
                              (p) => p.degree === degreeValue && p.branch === branchValue,
                            );
                          return (
                            <select
                              id={id}
                              className={getControlClass(hasError)}
                              value={programmeKey(degreeValue, branchValue)}
                              onChange={(e) => {
                                const chosen = splitProgrammeKey(e.target.value);
                                setValue("degree", chosen.degree, {
                                  shouldValidate: true,
                                  shouldDirty: true,
                                });
                                setValue("branch", chosen.branch, {
                                  shouldValidate: true,
                                  shouldDirty: true,
                                });
                                void trigger(["degree", "branch"]);
                              }}
                            >
                              <option value={programmeKey("", "")} disabled>
                                Select…
                              </option>
                              {hasCustomCurrent && (
                                <option value={programmeKey(degreeValue, branchValue)}>
                                  {programmeLabel(degreeValue, branchValue)}
                                </option>
                              )}
                              {programmes.map((p) => (
                                <option
                                  key={programmeKey(p.degree, p.branch)}
                                  value={programmeKey(p.degree, p.branch)}
                                >
                                  {programmeLabel(p.degree, p.branch)}
                                </option>
                              ))}
                            </select>
                          );
                        }}
                      </Field>
                      {programmes.length === 0 && (
                        <p className="mt-1 text-xs text-destructive">
                          No programmes have been mapped to your college yet. Ask your placement
                          coordinator — you cannot complete this section until they are.
                        </p>
                      )}
                    </div>
                    <div>
                      <TextField
                        label="Passing year"
                        type="number"
                        required
                        error={errors.passingYear?.message}
                        placeholder="e.g. 2026"
                        {...num("passingYear")}
                      />
                    </div>
                  </div>
                </div>

                {/* SEMESTER-WISE. Eligibility reads the latest VERIFIED line, so
                each one is entered, evidenced and checked separately. */}
                <div className="mt-6">
                  <p
                    className={`mb-2 text-sm transition-colors ${errors.semesters
                        ? "font-semibold text-danger-700"
                        : "font-medium text-ink-700"
                      }`}
                  >
                    <span>Semester results</span>
                    <span className="ml-0.5 text-danger-500" aria-hidden="true">
                      *
                    </span>
                    <span className="sr-only"> (required)</span>
                    {errors.semesters && (
                      <span
                        aria-hidden="true"
                        className="ml-2 inline-flex items-center rounded bg-danger-100 px-1.5 py-0.5 text-[11px] font-bold text-danger-800"
                      >
                        Invalid
                      </span>
                    )}
                  </p>
                  <p className="mb-3 text-xs text-ink-500">
                    Cumulative to the end of each semester. Choose the scale your college reports on
                    — CGPA out of 10, or a percentage. At most {maxSemesters} for a{" "}
                    {programmeLevel === "pg" ? "postgraduate" : "undergraduate"}.
                  </p>

                  <div className="flex flex-col gap-3">
                    {semesters.map((semester, index) => (
                      <div
                        key={semester.semesterNumber}
                        className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2"
                      >
                        <TextField
                          label={`Semester ${semester.semesterNumber} result`}
                          type="number"
                          step="0.01"
                          required
                          error={errors.semesters?.[index]?.marks?.message}
                          hint={
                            collegeMarksScale === "percentage" ? "Cumulative %" : "CGPA out of 10"
                          }
                          {...num(`semesters.${index}.marks`)}
                        />
                        <FileField
                          label={`Semester ${semester.semesterNumber} marksheet`}
                          required
                          error={marksheetError(`semester-${semester.semesterNumber}`)}
                          onChange={(e) =>
                            chooseMarksheet(
                              `semester-${semester.semesterNumber}`,
                              e.target.files?.[0],
                            )
                          }
                        />
                        <TextField
                          label={`Semester ${semester.semesterNumber} standing arrears`}
                          type="number"
                          required
                          error={errors.semesters?.[index]?.currentArrears?.message}
                          {...num(`semesters.${index}.currentArrears`)}
                        />
                        <TextField
                          label={`Semester ${semester.semesterNumber} arrear history`}
                          type="number"
                          required
                          error={errors.semesters?.[index]?.historyOfArrears?.message}
                          hint="Total arrears in your degree up to this semester (including cleared ones)."
                          {...num(`semesters.${index}.historyOfArrears`)}
                        />
                        {semesters.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Remove semester ${semester.semesterNumber}`}
                            onClick={() => handleRemoveSemester(index)}
                            className="self-end rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-danger-700 hover:bg-danger-50"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <ErrorText>
                    {errors.semesters?.message ?? errors.semesters?.root?.message}
                  </ErrorText>

                  {semesters.length < maxSemesters && (
                    <button
                      type="button"
                      onClick={() =>
                        setValue("semesters", [
                          ...semesters,
                          {
                            semesterNumber: semesters.length + 1,
                            marks: Number.NaN,
                            currentArrears: 0,
                            historyOfArrears: 0,
                          },
                        ])
                      }
                      className="mt-3 rounded-lg border border-dashed border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-500 transition-colors hover:bg-brand-50"
                    >
                      Add semester
                    </button>
                  )}
                </div>

                <ErrorText>
                  {errors.marksheets === undefined
                    ? undefined
                    : `Upload your ${missingMarksheets(
                      { programmeLevel, semesters: semesters ?? [], hasDiplomaMarks },
                      Object.keys(marksheets),
                    )
                      .map((s) => s.label)
                      .join(", ")}.`}
                </ErrorText>
              </Section>

              <Section
                id="preferences"
                title="Placement preferences"
                step={3}
                description="Choose every role type you want to be considered for, then upload a tailored resume for each."
              >
                <Controller
                  control={control}
                  name="roleCategories"
                  render={({ field }) => (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {ROLE_CATEGORIES.map((category) => (
                        <CheckboxField
                          key={category}
                          label={ROLE_CATEGORY_LABELS[category]}
                          checked={field.value.includes(category)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...field.value, category]
                              : field.value.filter((c) => c !== category);
                            field.onChange(next);
                            // Dropping a category must drop its resume too, or the
                            // cross-field rule would silently pass on stale data.
                            // Dropping a category drops its resume with it, or
                            // the submission would carry a file for an area the
                            // student is no longer asking to be considered for.
                            setValue(
                              "resumes",
                              Object.fromEntries(
                                Object.entries(resumes ?? {}).filter(([c]) =>
                                  next.includes(c as RoleCategory),
                                ),
                              ),
                              { shouldValidate: true },
                            );
                          }}
                        />
                      ))}
                    </div>
                  )}
                />
                <ErrorText>{errors.roleCategories?.message}</ErrorText>

                {selectedCategories.length > 0 && (
                  <div className="mt-5 rounded-lg bg-surface-muted p-4">
                    <p className="mb-3 text-sm font-semibold text-ink-700">
                      Resume per selected category
                    </p>
                    <div className={grid}>
                      {selectedCategories.map((category) => (
                        <FileField
                          key={category}
                          label={`${ROLE_CATEGORY_LABELS[category]} resume`}
                          required
                          // The group message cannot say WHICH upload is missing
                          // when several are on screen, so the reason goes on the
                          // field that is actually empty.
                          error={
                            (
                              errors.resumes as
                              | Record<string, { message?: string } | undefined>
                              | undefined
                            )?.[category]?.message ??
                            (errors.resumes !== undefined && !resumeCategories.includes(category)
                              ? `A ${ROLE_CATEGORY_LABELS[category]} resume is required.`
                              : undefined)
                          }
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            const next = { ...(resumes ?? {}) };
                            if (file === undefined) delete next[category];
                            else next[category] = file;
                            setValue("resumes", next, { shouldValidate: true });
                          }}
                        />
                      ))}
                    </div>
                    {/* A record's error lands on `.root`, not `.message` - the
                        same shape the marksheets and the semester list need. */}
                    <ErrorText>
                      {errors.resumes?.root?.message ??
                        (typeof errors.resumes?.message === "string"
                          ? errors.resumes.message
                          : undefined)}
                    </ErrorText>
                  </div>
                )}
              </Section>

              <Section
                id="profiles"
                title="Professional profiles"
                step={4}
                description="Optional, but they matter."
              >
                <div className={grid}>
                  {(
                    [
                      ["linkedin", "LinkedIn", "linkedin.com/in/…"],
                      ["github", "GitHub", "github.com/…"],
                      ["leetcode", "LeetCode", ""],
                      ["hackerrank", "HackerRank", ""],
                    ] as const
                  ).map(([name, label, placeholder]) => (
                    <div key={name}>
                      <TextField
                        label={label}
                        type="url"
                        placeholder={placeholder}
                        error={errors[name]?.message}
                        {...register(name)}
                      />
                    </div>
                  ))}
                </div>

                {/* Anything the four above do not cover (2026-08-06). A student
                with a Kaggle profile, a Behance portfolio, a Codeforces handle
                or their own site had nowhere to put it - and for many students
                that is the strongest evidence they have.

                The value is a plain text field, not a url input: the request
                was "the url/user name", and a Codeforces handle is not a URL.
                Demanding one would refuse the very entries this is for. */}
                <div className="mt-6">
                  <p className="mb-1 text-sm font-medium text-ink-700">Other profiles</p>
                  <p className="mb-3 text-xs text-ink-500">
                    Anything else worth showing a recruiter — Kaggle, Codeforces, Behance, your own
                    site. Give it a name, then paste the link or your username.
                  </p>

                  {otherProfiles.fields.length > 0 && (
                    <div className="flex flex-col gap-3">
                      {otherProfiles.fields.map((field, index) => (
                        <div
                          key={field.id}
                          className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1.5fr_auto]"
                        >
                          <TextField
                            label={`Profile ${index + 1} name`}
                            placeholder="e.g. Kaggle"
                            error={errors.otherProfiles?.[index]?.label?.message}
                            {...register(`otherProfiles.${index}.label`)}
                          />
                          <TextField
                            label={`Profile ${index + 1} link or username`}
                            placeholder="kaggle.com/asha  — or just asha_r"
                            error={errors.otherProfiles?.[index]?.value?.message}
                            {...register(`otherProfiles.${index}.value`)}
                          />
                          <button
                            type="button"
                            aria-label={`Remove profile ${index + 1}`}
                            onClick={() => otherProfiles.remove(index)}
                            className="self-end rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-danger-700 hover:bg-danger-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* An issue raised against an ARRAY lands on `.root`, not on
                  `.message` - the same shape the semester list needs. */}
                  <ErrorText>
                    {errors.otherProfiles?.message ?? errors.otherProfiles?.root?.message}
                  </ErrorText>

                  {otherProfiles.fields.length < MAX_OTHER_PROFILES && (
                    <button
                      type="button"
                      onClick={() => otherProfiles.append({ label: "", value: "" })}
                      className="mt-3 rounded-lg border border-dashed border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-500 transition-colors hover:bg-brand-50"
                    >
                      Add another profile
                    </button>
                  )}
                </div>
              </Section>

              <Section
                id="additional"
                title="Skills and achievements"
                step={5}
                description="Be specific — this feeds shortlisting."
              >
                <div className="flex flex-col gap-4">
                  <TextField
                    label="Technical skills"
                    placeholder="React, Python, SQL…"
                    error={errors.technicalSkills?.message}
                    {...register("technicalSkills")}
                  />
                  <TextField
                    label="Areas of interest"
                    placeholder="Backend engineering, data…"
                    error={errors.areasOfInterest?.message}
                    {...register("areasOfInterest")}
                  />
                  <TextField
                    label="Areas of expertise"
                    placeholder="Where you are genuinely strong"
                    error={errors.areasOfExpertise?.message}
                    {...register("areasOfExpertise")}
                  />
                  <TextField
                    label="Projects"
                    placeholder="Title, stack, and what you built"
                    error={errors.projects?.message}
                    {...register("projects")}
                  />
                  <TextField
                    label="Achievements"
                    error={errors.achievements?.message}
                    {...register("achievements")}
                  />
                </div>

                <div className="mt-6">
                  <p className="mb-1 text-sm font-medium text-ink-700">Certificates</p>
                  <p className="mb-3 text-xs text-ink-500">
                    Name each certificate and upload it. Each one is uploaded <strong>once</strong>{" "}
                    — to replace one, remove it and add it again. A name with no document cannot be
                    verified by your coordinator.
                  </p>

                  {certificates.fields.length > 0 && (
                    <div className="flex flex-col gap-3">
                      {certificates.fields.map((field, index) => (
                        <div
                          key={field.id}
                          className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1.5fr_auto]"
                        >
                          <TextField
                            label={`Certificate ${index + 1} name`}
                            placeholder="e.g. AWS Cloud Practitioner"
                            error={errors.certificates?.[index]?.name?.message}
                            {...register(`certificates.${index}.name`)}
                          />
                          <Controller
                            control={control}
                            name={`certificates.${index}.file`}
                            render={({ field: file }) => (
                              <div>
                                <label
                                  htmlFor={`certificate-file-${index}`}
                                  className="mb-1 block text-sm font-medium text-ink-700"
                                >
                                  Upload certificate {index + 1}
                                </label>
                                <input
                                  id={`certificate-file-${index}`}
                                  type="file"
                                  accept="application/pdf,image/*"
                                  onChange={(e) => {
                                    const fileSelected = e.target.files?.[0] ?? null;
                                    file.onChange(fileSelected);
                                    if (fileSelected !== null) {
                                      const currentName = getValues(`certificates.${index}.name`);
                                      if (
                                        !currentName ||
                                        currentName.trim() === "" ||
                                        currentName.trim().toLowerCase() ===
                                        "e.g. aws cloud practitioner"
                                      ) {
                                        setValue(
                                          `certificates.${index}.name`,
                                          filenameToCertificateName(fileSelected.name),
                                          { shouldValidate: true, shouldDirty: true },
                                        );
                                      }
                                    }
                                  }}
                                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                                />
                                <ErrorText>
                                  {(errors.certificates?.[index]?.file as { message?: string } | undefined)?.message}
                                </ErrorText>
                              </div>
                            )}
                          />
                          <button
                            type="button"
                            aria-label={`Remove certificate ${index + 1}`}
                            onClick={() => certificates.remove(index)}
                            className="self-end rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-danger-700 hover:bg-danger-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* An issue raised against an ARRAY lands on `.root`. */}
                  <ErrorText>
                    {errors.certificates?.message ?? errors.certificates?.root?.message}
                  </ErrorText>

                  <button
                    type="button"
                    onClick={() => certificates.append({ name: "", file: null })}
                    className="mt-3 rounded-lg border border-dashed border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-500 transition-colors hover:bg-brand-50"
                  >
                    Add a certificate
                  </button>
                </div>
              </Section>

              <Section id="consent" title="Consent and submission" step={6}>
                <CheckboxField
                  required
                  label={
                    <span className={errors.consent ? "font-semibold text-danger-700" : ""}>
                      I consent to sharing my profile and resumes with recruiting companies
                      {errors.consent && (
                        <span
                          aria-hidden="true"
                          className="ml-2 inline-flex items-center rounded bg-danger-100 px-1.5 py-0.5 text-[11px] font-bold text-danger-800"
                        >
                          Invalid
                        </span>
                      )}
                    </span>
                  }
                  description="Your profile, academic record and the relevant resume are shared with companies whose drives you apply to. Every share is logged."
                  {...register("consent")}
                />
                <ErrorText>{errors.consent?.message}</ErrorText>

                {serverError !== null && (
                  <p
                    role="alert"
                    className="mt-4 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700"
                  >
                    {serverError}
                  </p>
                )}

                {submitAttempted && Object.keys(errors).length > 0 && (
                  <div
                    role="alert"
                    className="mt-4 rounded-lg border border-danger-500/40 bg-danger-50 p-4 text-sm text-danger-900"
                  >
                    <p className="font-semibold text-danger-900">
                      Cannot submit yet. Please fix the highlighted errors in the form above.
                    </p>
                    <p className="mt-1 text-xs text-danger-800">
                      Check your personal details, academic record, marksheet uploads, or required consent.
                    </p>
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-3 sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded-lg bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 disabled:opacity-60 sm:px-6"
                  >
                    {isSubmitting ? "Submitting…" : "Submit for verification"}
                  </button>
                  {/* This button existed and did NOTHING - the form advertised
                  draft saving it had never implemented. */}
                  <button
                    type="button"
                    onClick={() => void saveNow()}
                    disabled={draftState === "saving"}
                    className="rounded-lg border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink-700 transition-colors hover:border-brand-300 disabled:opacity-60"
                  >
                    {draftState === "saving" ? "Saving…" : "Save draft"}
                  </button>
                </div>
              </Section>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
