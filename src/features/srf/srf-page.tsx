import { CheckboxField, FileField, SelectField, TextField } from "@components/form";
import { type ReactNode, useId } from "react";

/**
 * Student Registration Form — PRD §4.1.
 *
 * VISUAL MOCK: layout, brand and structure only. No validation, no submission,
 * no state. Field logic arrives once the design is approved.
 */

export const SRF_SECTIONS = [
  { id: "personal", title: "Personal details", step: 1 },
  { id: "academic", title: "Academic record", step: 2 },
  { id: "marksheets", title: "Marksheet uploads", step: 3 },
  { id: "preferences", title: "Placement preferences", step: 4 },
  { id: "profiles", title: "Professional profiles", step: 5 },
  { id: "additional", title: "Skills and achievements", step: 6 },
  { id: "consent", title: "Consent and submission", step: 7 },
] as const;

/** The five FINAL role categories. */
const ROLE_CATEGORY_LABELS = [
  ["software_technical", "Software / Technical"],
  ["technical_support_it_ops", "Technical Support / IT Operations"],
  ["digital_marketing", "Digital Marketing"],
  ["sales", "Sales"],
  ["operations_business", "Operations and Business Roles"],
] as const;

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

const grid = "grid gap-4 sm:grid-cols-2";

export function SrfPage() {
  return (
    <div className="min-h-dvh bg-surface-muted">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-line bg-brand-500 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="font-heading text-sm font-extrabold tracking-tight sm:text-base">
              FACE Prep Campus
            </p>
            <p className="truncate text-xs text-white/70">Placement Management System</p>
          </div>
          <span className="shrink-0 rounded-full bg-gold-500 px-2.5 py-1 text-xs font-semibold text-brand-900">
            Draft
          </span>
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

        {/* Progress */}
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

        <form className="flex flex-col gap-5">
          <Section title="Personal details" step={1} description="How we and recruiters reach you.">
            <div className={grid}>
              <TextField label="Full name" required defaultValue="Priya Ramesh" />
              <TextField label="Roll number" required defaultValue="21CSE1042" disabled />
              <TextField
                label="Email ID"
                type="email"
                required
                defaultValue="priya.r@example.edu"
              />
              <TextField label="Mobile number" type="tel" required placeholder="10-digit mobile" />
              <TextField label="WhatsApp number" type="tel" placeholder="If different" />
              <TextField label="Alternate contact number" type="tel" />
            </div>
          </Section>

          <Section
            title="Academic record"
            step={2}
            description="Eligibility is checked against these figures once verified."
          >
            <div className={grid}>
              <TextField label="10th marks (%)" type="number" required placeholder="e.g. 91.4" />
              <TextField label="12th marks (%)" type="number" required placeholder="e.g. 88.0" />
              <SelectField
                label="Degree"
                required
                options={["B.E / B.Tech", "BCA", "B.Sc CS / CT", "MCA", "M.Sc CS", "B.Com", "BBA"]}
              />
              <SelectField
                label="Branch / specialisation"
                required
                options={["CSE", "IT", "ECE", "EEE", "Mechanical", "Civil", "Not applicable"]}
              />
              <TextField label="Passing year" type="number" required placeholder="e.g. 2026" />
              <TextField
                label="Overall CGPA"
                type="number"
                required
                placeholder="e.g. 8.24"
                hint="Cumulative across all completed semesters."
              />
              <TextField label="Current arrears" type="number" required defaultValue={0} />
              <TextField
                label="History of arrears"
                type="number"
                required
                defaultValue={0}
                hint="Total backlogs ever held, including cleared ones."
              />
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
              <FileField label="Semester 1 marksheet" required />
              <FileField label="Semester 2 marksheet" required />
            </div>
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-dashed border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-500 transition-colors hover:bg-brand-50 sm:w-auto"
            >
              + Add another semester
            </button>
          </Section>

          <Section
            title="Placement preferences"
            step={4}
            description="Choose every role type you want to be considered for, then upload a tailored resume for each."
          >
            <div className="grid gap-2.5 sm:grid-cols-2">
              {ROLE_CATEGORY_LABELS.map(([value, label]) => (
                <CheckboxField key={value} label={label} name="role_category" value={value} />
              ))}
            </div>
            <div className="mt-5 rounded-lg bg-surface-muted p-4">
              <p className="mb-3 text-sm font-semibold text-ink-700">
                Resume per selected category
              </p>
              <div className={grid}>
                <FileField label="Software / Technical resume" hint="PDF only" />
                <FileField label="Sales resume" hint="PDF only" />
              </div>
            </div>
          </Section>

          <Section title="Professional profiles" step={5} description="Optional, but they matter.">
            <div className={grid}>
              <TextField label="LinkedIn" type="url" placeholder="linkedin.com/in/…" />
              <TextField label="GitHub" type="url" placeholder="github.com/…" />
              <TextField label="LeetCode" type="url" />
              <TextField label="HackerRank" type="url" />
            </div>
          </Section>

          <Section
            title="Skills and achievements"
            step={6}
            description="Be specific — this feeds shortlisting."
          >
            <div className="flex flex-col gap-4">
              <TextField label="Technical skills" placeholder="React, Python, SQL…" />
              <TextField label="Areas of interest" placeholder="Backend engineering, data…" />
              <TextField label="Areas of expertise" placeholder="Where you are genuinely strong" />
              <TextField label="Projects" placeholder="Title, stack, and what you built" />
              <TextField label="Certifications" />
              <TextField label="Achievements" />
            </div>
          </Section>

          <Section title="Consent and submission" step={7}>
            <CheckboxField
              required
              label="I consent to sharing my profile and resumes with recruiting companies"
              description="Your profile, academic record and the relevant resume are shared with companies whose drives you apply to. Every share is logged."
            />
            <div className="mt-5 flex flex-col gap-3 sm:flex-row-reverse">
              <button
                type="submit"
                className="rounded-lg bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 sm:px-6"
              >
                Submit for verification
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
