import { CheckboxField, FileField, SelectField, TextField } from "@components/form";
import { ROLE_CATEGORIES, type RoleCategory } from "@domain/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuthActions } from "@lib/auth-context";
import { type ReactNode, useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { SrfSubmitError, submitSrf } from "./srf-api";
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
  title,
  step,
  description,
  children,
}: {
  title: string;
  step: number;
  description?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6"
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

export function SrfPage() {
  const { signOut } = useAuthActions();
  // Stable ids so React never re-keys an upload control on add/remove.
  const [semesterIds, setSemesterIds] = useState<readonly number[]>([1, 2]);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SrfFormValues>({
    resolver: zodResolver(srfSchema),
    defaultValues: SRF_DEFAULTS,
    mode: "onTouched",
  });

  const selectedCategories = watch("roleCategories");
  const resumeCategories = watch("resumeCategories");

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

  const num = (name: keyof SrfFormValues) =>
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
            <span className="rounded-full bg-gold-500 px-2.5 py-1 text-xs font-semibold text-brand-900">
              Draft
            </span>
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

        <ol className="mb-6 flex flex-wrap gap-1.5" aria-label="Form progress">
          {SRF_SECTIONS.map((s) => (
            <li
              key={s.id}
              className="flex-1 rounded-full bg-line py-1 text-center text-[10px] font-semibold text-ink-500 first:bg-brand-500 first:text-white"
            >
              {s.step}
            </li>
          ))}
        </ol>

        <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
          <Section title="Personal details" step={1} description="How we and recruiters reach you.">
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
              <div>
                <TextField
                  label="Overall CGPA"
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 8.24"
                  hint="Cumulative across all completed semesters, on a 10-point scale."
                  {...num("overallCgpa")}
                />
                <ErrorText>{errors.overallCgpa?.message}</ErrorText>
              </div>
              <div>
                <TextField
                  label="Current arrears"
                  type="number"
                  required
                  {...num("currentArrears")}
                />
                <ErrorText>{errors.currentArrears?.message}</ErrorText>
              </div>
              <div>
                <TextField
                  label="History of arrears"
                  type="number"
                  required
                  hint="Total backlogs ever held, including cleared ones."
                  {...num("historyOfArrears")}
                />
                <ErrorText>{errors.historyOfArrears?.message}</ErrorText>
              </div>
            </div>
          </Section>

          <Section
            title="Marksheet uploads"
            step={3}
            description="Your Coordinator verifies every figure above against these documents."
          >
            <div className={grid}>
              <FileField label="10th marksheet" required />
              <FileField label="12th marksheet" required />
              {semesterIds.map((id, i) => (
                <FileField key={id} label={`Semester ${i + 1} marksheet`} required />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSemesterIds((ids) => [...ids, Math.max(...ids) + 1])}
                className="rounded-lg border border-dashed border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-500 transition-colors hover:bg-brand-50"
              >
                + Add another semester
              </button>
              {semesterIds.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSemesterIds((ids) => ids.slice(0, -1))}
                  className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink-500 transition-colors hover:border-brand-300"
                >
                  Remove last semester
                </button>
              )}
            </div>
          </Section>

          <Section
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
                      hint="PDF only"
                      required
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

          <Section title="Professional profiles" step={5} description="Optional, but they matter.">
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

          <Section title="Consent and submission" step={7}>
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
              <button
                type="button"
                className="rounded-lg border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink-700 transition-colors hover:border-brand-300"
              >
                Save draft
              </button>
            </div>
          </Section>
        </form>
      </main>
    </div>
  );
}
