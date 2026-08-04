import { CheckboxField, FileField, SelectField, TextField } from "@components/form";
import { MAX_SEMESTERS } from "@domain/academics";
import { missingMarksheets, requiredMarksheets } from "@domain/marksheets";
import { mergeSrfDraft } from "@domain/srf-draft";
import { srfCompletion, srfSectionProgress } from "@domain/srf-progress";
import { ROLE_CATEGORIES, type RoleCategory } from "@domain/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuthActions } from "@lib/auth-context";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link } from "react-router";
import { SrfSubmitError, saveSrfDraft, submitSrf } from "./srf-api";
import type { SrfProfile } from "./srf-profile";
import { SRF_DEFAULTS, type SrfFormValues, type SrfSubmission, srfSchema } from "./srf-schema";

/** Student Registration Form — PRD §4.1. */

export const SRF_SECTIONS = [
  { id: "personal", title: "Personal details", step: 1 },
  { id: "academic", title: "Academic record", step: 2 },
  { id: "marksheets", title: "Marksheet uploads", step: 3 },
  { id: "preferences", title: "Placement preferences", step: 4 },
  { id: "profiles", title: "Professional profiles", step: 5 },
  { id: "additional", title: "Skills and achievements", step: 6 },
  { id: "consent", title: "Consent and submission", step: 7 },
] as const;

export const ROLE_CATEGORY_LABELS: Readonly<Record<RoleCategory, string>> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

function Section({
  id,
  title,
  step,
  description,
  children,
}: {
  /** Anchor target, so the progress tracker can jump back to it. */
  id: string;
  title: string;
  step: number;
  description?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      // Without this the sticky header covers the heading being jumped to.
      className="scroll-mt-24 rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6"
      aria-labelledby={headingId}
    >
      <div className="mb-5 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white"
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg text-ink-900">
            {title}
          </h2>
          {description !== undefined && (
            <p className="mt-0.5 text-sm text-ink-500">{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

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
 * `profile` is the student's roster record. Name, roll number and email are
 * not theirs to type - those fields are disabled - so without it the form
 * cannot be completed at all.
 */
export function SrfPage({
  profile,
  /** The student's unsent form, if they have one. */
  draft,
  /** Injected so the page can be tested without a database. */
  saveDraft = (values: unknown) => saveSrfDraft(values),
}: {
  profile?: SrfProfile | null;
  draft?: unknown;
  saveDraft?: (values: unknown) => Promise<boolean>;
}) {
  const { signOut } = useAuthActions();
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
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SrfFormValues>({
    resolver: zodResolver(srfSchema),
    /**
     * Roster beats draft beats defaults - the order is a domain rule, because
     * a draft can be weeks older than a roster correction and must never
     * quietly restore a stale roll number for verification to fail on.
     */
    defaultValues: mergeSrfDraft(
      SRF_DEFAULTS as unknown as Record<string, unknown>,
      profile === null || profile === undefined ? null : { ...profile },
      draft,
    ) as unknown as SrfFormValues,
    mode: "onTouched",
  });

  const selectedCategories = watch("roleCategories");
  const resumeCategories = watch("resumeCategories");
  const programmeLevel = watch("programmeLevel");
  const semesters = watch("semesters");
  const maxSemesters = MAX_SEMESTERS[programmeLevel];

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
  });

  const chooseMarksheet = (key: string, file: File | undefined) => {
    const next = { ...marksheets };
    if (file === undefined) {
      delete next[key];
    } else {
      next[key] = file;
    }
    setValue("marksheets", next, { shouldValidate: true, shouldDirty: true });
  };

  const progressInput = {
    mobile: watch("mobile"),
    alternateContact: watch("alternateContact"),
    tenthPercentage: watch("tenthPercentage"),
    twelfthPercentage: watch("twelfthPercentage"),
    programmeLevel,
    // The field is optional in the form's input type, but "not yet entered"
    // and "deliberately none" are the same thing to the tracker.
    ugAggregateCgpa: watch("ugAggregateCgpa") ?? null,
    semesters: (semesters ?? []).map((s) => ({
      semesterNumber: s.semesterNumber,
      cgpa: s.cgpa,
    })),
    marksheets: Object.keys(marksheets),
    roleCategories: selectedCategories,
    resumeCategories,
    consent: watch("consent") === true,
  };

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
  const serialised = JSON.stringify({ ...watch(), marksheets: {} });

  useEffect(() => {
    if (!isDirty) return;

    const timer = setTimeout(() => {
      if (savingRef.current) return;
      savingRef.current = true;
      setDraftState("saving");

      void saveDraft(JSON.parse(serialised))
        .then((ok) => {
          setDraftState(ok ? "saved" : "failed");
          if (ok) setDraftSavedAt(new Date());
        })
        .finally(() => {
          savingRef.current = false;
        });
    }, 1000);

    return () => clearTimeout(timer);
  }, [serialised, isDirty, saveDraft]);

  const saveNow = async () => {
    setDraftState("saving");
    const ok = await saveDraft(JSON.parse(serialised));
    setDraftState(ok ? "saved" : "failed");
    if (ok) setDraftSavedAt(new Date());
  };

  const progress = srfSectionProgress(progressInput);
  const completion = srfCompletion(progressInput);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await submitSrf(values as SrfSubmission);
      setSubmitted(true);
    } catch (error) {
      setServerError(
        error instanceof SrfSubmitError ? error.message : "Something went wrong. Please try again.",
      );
    }
  });

  const num = (name: Parameters<typeof register>[0]) =>
    register(name, { setValueAs: (v) => (v === "" ? Number.NaN : Number(v)) });

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
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            Complete every section carefully. Your entries will be{" "}
            <strong className="font-semibold text-ink-700">
              verified by your Campus Placement Coordinator
            </strong>{" "}
            against your uploaded marksheets. You can only receive and apply to drives once your
            form is approved.
          </p>
        </div>

        {/* Was hardcoded: step 1 lit on load, the other six never. It now
            reads the domain rule, and every pill is a link back to its
            section - the student had no way to review what they had entered. */}
        <nav aria-label="Form progress" className="mb-6">
          <ol className="flex flex-wrap gap-1.5">
            {progress.map((s) => (
              <li key={s.id} className="min-w-9 flex-1">
                <a
                  href={`#${s.id}`}
                  aria-current={s.complete && !s.optional ? "step" : undefined}
                  aria-label={`${s.title}${s.complete && !s.optional ? " — done" : ""}`}
                  title={s.title}
                  className={`block rounded-full py-1 text-center text-[10px] font-semibold transition-colors ${
                    s.complete && !s.optional
                      ? "bg-brand-500 text-white"
                      : "bg-line text-ink-500 hover:bg-brand-50 hover:text-brand-600"
                  }`}
                >
                  {s.complete && !s.optional ? "\u2713" : s.step}
                </a>
              </li>
            ))}
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
                <TextField label="Full name" required {...register("fullName")} />
                <ErrorText>{errors.fullName?.message}</ErrorText>
              </div>
              <div>
                <TextField label="Roll number" required disabled {...register("rollNumber")} />
              </div>
              <div>
                <TextField label="Email ID" type="email" required {...register("email")} />
                <ErrorText>{errors.email?.message}</ErrorText>
              </div>
              <div>
                <TextField
                  label="Mobile number"
                  type="tel"
                  required
                  placeholder="10-digit mobile"
                  {...register("mobile")}
                />
                <ErrorText>{errors.mobile?.message}</ErrorText>
              </div>
              <div>
                <TextField
                  label="WhatsApp number"
                  type="tel"
                  placeholder="If different"
                  {...register("whatsapp")}
                />
                <ErrorText>{errors.whatsapp?.message}</ErrorText>
              </div>
              <div>
                <TextField
                  label="Alternate contact number"
                  type="tel"
                  required
                  hint="A number that reaches you if your main one does not."
                  {...register("alternateContact")}
                />
                <ErrorText>{errors.alternateContact?.message}</ErrorText>
              </div>
            </div>
          </Section>

          <Section
            id="academic"
            title="Academic record"
            step={2}
            description="Eligibility is checked against these figures once verified."
          >
            <div className={grid}>
              <div>
                <TextField
                  label="10th marks (%)"
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 91.4"
                  {...num("tenthPercentage")}
                />
                <ErrorText>{errors.tenthPercentage?.message}</ErrorText>
              </div>
              <div>
                <TextField
                  label="12th marks (%)"
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 88.0"
                  {...num("twelfthPercentage")}
                />
                <ErrorText>{errors.twelfthPercentage?.message}</ErrorText>
              </div>
              <div>
                <SelectField
                  label="Degree"
                  required
                  options={["B.E", "B.Tech", "BCA", "B.Sc CS", "MCA", "M.Sc CS", "B.Com", "BBA"]}
                  {...register("degree")}
                />
                <ErrorText>{errors.degree?.message}</ErrorText>
              </div>
              <div>
                <SelectField
                  label="Branch / specialisation"
                  required
                  options={["CSE", "IT", "ECE", "EEE", "Mechanical", "Civil", "Not applicable"]}
                  {...register("branch")}
                />
                <ErrorText>{errors.branch?.message}</ErrorText>
              </div>
              <div>
                <TextField
                  label="Passing year"
                  type="number"
                  required
                  placeholder="e.g. 2026"
                  {...num("passingYear")}
                />
                <ErrorText>{errors.passingYear?.message}</ErrorText>
              </div>
            </div>

            {/* Semester-wise since 2026-08-04. Eligibility reads the latest
                VERIFIED line, so each one is entered and checked separately. */}
            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-medium text-ink-700">
                Which are you pursuing?
                <span className="ml-0.5 text-danger-500" aria-hidden="true">
                  *
                </span>
                <span className="sr-only"> (required)</span>
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
                      onChange={() => {
                        setValue("programmeLevel", value, { shouldValidate: true });
                        // Coming back from PG to UG must not leave a 5th line
                        // behind that the cap would then reject on submit.
                        setValue("semesters", semesters.slice(0, MAX_SEMESTERS[value]));
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <ErrorText>{errors.programmeLevel?.message}</ErrorText>
            </fieldset>

            {programmeLevel === "pg" && (
              <div className="mt-4 max-w-xs">
                <TextField
                  label="Undergraduate CGPA"
                  type="number"
                  step="0.01"
                  required
                  hint="One figure for the degree you have already completed."
                  error={errors.ugAggregateCgpa?.message}
                  {...num("ugAggregateCgpa")}
                />
              </div>
            )}

            <div className="mt-6">
              <p className="mb-2 text-sm font-medium text-ink-700">
                Semester results
                <span className="ml-0.5 text-danger-500" aria-hidden="true">
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </p>
              <p className="mb-3 text-xs text-ink-500">
                CGPA, not GPA: cumulative to the end of each semester, on a 10-point scale. At most{" "}
                {maxSemesters} for a {programmeLevel === "pg" ? "postgraduate" : "undergraduate"}.
              </p>

              <div className="flex flex-col gap-3">
                {semesters.map((semester, index) => (
                  <div
                    key={semester.semesterNumber}
                    className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                  >
                    <TextField
                      label={`Semester ${semester.semesterNumber} CGPA`}
                      type="number"
                      step="0.01"
                      required
                      {...num(`semesters.${index}.cgpa`)}
                    />
                    <TextField
                      label={`Semester ${semester.semesterNumber} standing arrears`}
                      type="number"
                      required
                      {...num(`semesters.${index}.currentArrears`)}
                    />
                    <TextField
                      label={`Semester ${semester.semesterNumber} arrear history`}
                      type="number"
                      required
                      hint="Including cleared ones."
                      {...num(`semesters.${index}.historyOfArrears`)}
                    />
                    {semesters.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove semester ${semester.semesterNumber}`}
                        onClick={() =>
                          setValue(
                            "semesters",
                            semesters
                              .filter((_, i) => i !== index)
                              // Numbers are positional, so close the gap.
                              .map((s, i) => ({ ...s, semesterNumber: i + 1 })),
                            { shouldValidate: true },
                          )
                        }
                        className="self-end rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-danger-700 hover:bg-danger-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <ErrorText>{errors.semesters?.message ?? errors.semesters?.root?.message}</ErrorText>

              {semesters.length < maxSemesters && (
                <button
                  type="button"
                  onClick={() =>
                    setValue("semesters", [
                      ...semesters,
                      {
                        semesterNumber: semesters.length + 1,
                        cgpa: Number.NaN,
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
          </Section>

          <Section
            id="marksheets"
            title="Marksheet uploads"
            step={3}
            description="Your Coordinator verifies every figure above against these documents."
          >
            <p className="mb-4 text-xs text-ink-500">
              One per figure you entered above. Adding a semester adds its marksheet — a mark nobody
              can check against a document cannot be verified.
            </p>
            <div className={grid}>
              {requiredSheets.map((slot) => (
                <FileField
                  key={slot.key}
                  label={slot.label}
                  required
                  // The group message cannot say WHICH upload is missing when
                  // several are on screen, so the reason goes on the field
                  // that is actually empty (requested 2026-08-04).
                  error={
                    errors.marksheets !== undefined && marksheets[slot.key] === undefined
                      ? `Your ${slot.label} is required.`
                      : undefined
                  }
                  onChange={(e) => chooseMarksheet(slot.key, e.target.files?.[0])}
                />
              ))}
            </div>
            <ErrorText>
              {errors.marksheets === undefined
                ? undefined
                : `Upload your ${missingMarksheets(
                    { programmeLevel, semesters: semesters ?? [] },
                    Object.keys(marksheets),
                  )
                    .map((s) => s.label)
                    .join(", ")}.`}
            </ErrorText>
          </Section>

          <Section
            id="preferences"
            title="Placement preferences"
            step={4}
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
                        setValue(
                          "resumeCategories",
                          resumeCategories.filter((c) => next.includes(c)),
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
                        errors.resumeCategories !== undefined &&
                        !resumeCategories.includes(category)
                          ? `A ${ROLE_CATEGORY_LABELS[category]} resume is required.`
                          : undefined
                      }
                      onChange={(e) => {
                        const has = e.target.value !== "";
                        setValue(
                          "resumeCategories",
                          has
                            ? [...new Set([...resumeCategories, category])]
                            : resumeCategories.filter((c) => c !== category),
                          { shouldValidate: true },
                        );
                      }}
                    />
                  ))}
                </div>
                <ErrorText>{errors.resumeCategories?.message}</ErrorText>
              </div>
            )}
          </Section>

          <Section
            id="profiles"
            title="Professional profiles"
            step={5}
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
                    {...register(name)}
                  />
                  <ErrorText>{errors[name]?.message}</ErrorText>
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="additional"
            title="Skills and achievements"
            step={6}
            description="Be specific — this feeds shortlisting."
          >
            <div className="flex flex-col gap-4">
              <TextField
                label="Technical skills"
                placeholder="React, Python, SQL…"
                {...register("technicalSkills")}
              />
              <TextField
                label="Areas of interest"
                placeholder="Backend engineering, data…"
                {...register("areasOfInterest")}
              />
              <TextField
                label="Areas of expertise"
                placeholder="Where you are genuinely strong"
                {...register("areasOfExpertise")}
              />
              <TextField
                label="Projects"
                placeholder="Title, stack, and what you built"
                {...register("projects")}
              />
              <TextField label="Certifications" {...register("certifications")} />
              <TextField label="Achievements" {...register("achievements")} />
            </div>
          </Section>

          <Section id="consent" title="Consent and submission" step={7}>
            <CheckboxField
              required
              label="I consent to sharing my profile and resumes with recruiting companies"
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
      </main>
    </div>
  );
}
