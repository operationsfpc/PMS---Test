import { Button, Card, PageHeader } from "@components/ui";
import { describeFileSize } from "@domain/attachments";
import { JOINING_TIMELINES, joiningLabel } from "@domain/joining";
import { MARKS_SCALES } from "@domain/marks";
import { SHIFT_TYPES, shiftLabel } from "@domain/shift";
import { ARREAR_POLICIES, DRIVE_MODES, DRIVE_TYPES, ROLE_CATEGORIES } from "@domain/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useId, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { PIF_DEFAULTS, type PifFormValues, pifDraftSchema, pifSubmitSchema } from "./pif-schema";

/** Sections 1-4 are the AE's. Section 5 belongs to Delivery. */
export const PIF_SECTIONS = [
  { id: "company", title: "Company details" },
  { id: "role", title: "Role details" },
  { id: "eligibility", title: "Eligibility criteria" },
  { id: "process", title: "Selection process and timeline" },
] as const;

const ROLE_CATEGORY_LABELS: Record<string, string> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

const DRIVE_MODE_LABELS: Record<string, string> = {
  on_campus: "On-campus",
  physical_outside_campus: "Physical drive outside campus",
  virtual: "Virtual",
  pooled: "Pooled drive",
};

const DRIVE_TYPE_LABELS: Record<string, string> = {
  placement: "Placement",
  internship_convertible: "Internship (convertible)",
  internship: "Internship",
};

const ARREAR_LABELS: Record<string, string> = {
  flexible: "Flexible — arrears allowed",
  no_standing: "No standing arrears",
  no_history: "No arrear history at all",
};

const PASSING_YEARS = [2026, 2027, 2028] as const;

/** F12: recruiters state the bar the way their own HR does. */
const SCALE_LABELS: Record<string, string> = {
  cgpa: "CGPA (out of 10)",
  percentage: "Percentage (out of 100)",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="mb-4 p-5">
      <h2 className="mb-4 font-[Raleway] text-lg font-bold text-[#3D3777]">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function Labelled({
  label,
  error,
  children,
  wide = false,
}: {
  label: string;
  error?: string | undefined;
  children: (id: string) => ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-900">
        {label}
      </label>
      {children(id)}
      {error !== undefined && (
        <p className="mt-1 text-xs text-[#DD4820]" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

const control =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-[#A46AFC]";

/**
 * A radio group, as a fieldset with a real legend.
 *
 * Nothing is preselected anywhere it is used: a preselected first option is an
 * answer nobody gave, and it would be stored as if the AE had chosen it.
 */
function RadioGroup({
  legend,
  name,
  options,
  value,
  onChange,
  error,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  error?: string | undefined;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-900">{legend}</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-4 accent-[#3D3777]"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error !== undefined && (
        <p className="mt-1 text-xs text-[#DD4820]" role="status">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * The AE's Position Information Form.
 *
 * Offer category is deliberately absent: §3.3 gives it to the Delivery Head at
 * approval and makes it immutable, so the AE must not be able to propose one.
 *
 * Draft and submit validate differently - a draft may be half-finished, but
 * submitting hands the PIF to an approver and must be complete.
 */
export function PifForm({
  onSubmit,
  onSaveDraft,
}: {
  onSubmit: (values: PifFormValues) => Promise<void>;
  onSaveDraft: (values: PifFormValues) => Promise<void>;
}) {
  const intent = useRef<"draft" | "submit">("submit");
  const [failure, setFailure] = useState<string | null>(null);

  const {
    register,
    control: formControl,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PifFormValues>({
    defaultValues: { ...PIF_DEFAULTS },
    resolver: async (values, context, options) =>
      zodResolver(intent.current === "draft" ? pifDraftSchema : pifSubmitSchema)(
        values,
        context,
        options,
      ),
  });

  /**
   * The mode is set when the BUTTON IS PRESSED, not when it is rendered.
   *
   * This used to be `run(mode)` called during render, setting `intent.current`
   * as a side effect — so whichever button rendered last won, and that was
   * "Save draft". Every "Submit for approval" was therefore validated against
   * `pifDraftSchema`, which asks for a company name and nothing else. An AE
   * could hand the Delivery Head a PIF with no role, no CTC, no eligibility
   * and no passing years, and the only symptom was an approval queue full of
   * empty forms.
   */
  const run = (mode: "draft" | "submit") => async () => {
    intent.current = mode;
    await submitWith(mode)();
  };

  const submitWith = (mode: "draft" | "submit") => {
    return handleSubmit(async (values) => {
      setFailure(null);
      try {
        await (mode === "draft" ? onSaveDraft(values) : onSubmit(values));
      } catch (cause) {
        // The repository knows WHY it failed. Replacing that with a blanket
        // apology made a production failure impossible to diagnose, and told
        // the AE to "try again" at something that could never succeed.
        const reason =
          cause instanceof Error && cause.message !== ""
            ? cause.message
            : "Could not save the PIF.";
        setFailure(`${reason} Your entries are still here.`);
      }
    });
  };

  /**
   * F7: one interview process, several job titles, ONE PIF. Rows are added by
   * the AE and blank ones are dropped by the schema - an untouched row is not
   * a mistake worth an error message.
   */
  const designations = useFieldArray({
    control: formControl,
    // `additionalDesignations` is a string array, which useFieldArray cannot
    // key on directly; RHF handles the primitive case through the same API.
    name: "additionalDesignations" as never,
  });

  /**
   * An untouched optional number is NOT zero.
   *
   * This read `v === "" ? null : Number(v)`, and RHF hands `setValueAs` the
   * DEFAULT value - `null` - for a field nobody typed in. `Number(null)` is 0,
   * so every blank optional number was submitted as a real zero: a maximum CTC
   * of 0 (which then failed "cannot be below the minimum"), and a CGPA cutoff
   * of 0 stored as a cutoff rather than as "none set".
   */
  const numeric = {
    setValueAs: (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v)),
  };
  const err = (k: keyof PifFormValues) => errors[k]?.message as string | undefined;

  /** The named rounds (2026-08-18). Numbered by position, like the semesters. */
  const rounds = watch("rounds") ?? [];

  /** J1/J2/J3 (2026-08-18): each drives a conditional part of the form. */
  const jobDescriptionFile = watch("jobDescriptionFile") ?? null;
  const shiftType = watch("shiftType") ?? "";
  const joiningTimeline = watch("joiningTimeline") ?? "";

  return (
    <>
      <PageHeader
        title="Position Information Form"
        subtitle="Raise a new drive. It goes to the Delivery Head for approval."
      />

      {failure !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {failure}
          </p>
        </Card>
      )}

      <form noValidate>
        <Section title="Company details">
          <Labelled label="Company name" error={err("companyName")}>
            {(id) => <input id={id} className={control} {...register("companyName")} />}
          </Labelled>
          <Labelled label="Industry / domain" error={err("industry")}>
            {(id) => <input id={id} className={control} {...register("industry")} />}
          </Labelled>
          <Labelled label="Company website" error={err("companyWebsite")}>
            {(id) => <input id={id} className={control} {...register("companyWebsite")} />}
          </Labelled>
          <Labelled label="Contact name" error={err("spocName")}>
            {(id) => <input id={id} className={control} {...register("spocName")} />}
          </Labelled>
          <Labelled label="Contact designation" error={err("spocDesignation")}>
            {(id) => <input id={id} className={control} {...register("spocDesignation")} />}
          </Labelled>
          <Labelled label="Contact email" error={err("spocEmail")}>
            {(id) => <input id={id} className={control} {...register("spocEmail")} />}
          </Labelled>
          <Labelled label="Contact phone" error={err("spocPhone")}>
            {(id) => <input id={id} className={control} {...register("spocPhone")} />}
          </Labelled>
        </Section>

        <Section title="Role details">
          <Labelled label="Role title" error={err("roleTitle")}>
            {(id) => <input id={id} className={control} {...register("roleTitle")} />}
          </Labelled>
          <div className="sm:col-span-2 rounded-lg border border-line bg-surface-muted p-4">
            <p className="text-sm font-medium text-ink-900">
              One interview process, however many designations — one PIF.
            </p>
            <p className="mt-1 text-xs text-ink-700">
              If the recruiter runs a separate interview process for another designation, raise a
              separate PIF for it. Two PIFs for one process would double the drive, the shortlist
              and the audience count.
            </p>

            {designations.fields.map((field, index) => (
              <div key={field.id} className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <label
                    htmlFor={`designation-${index}`}
                    className="mb-1 block text-xs font-medium text-ink-700"
                  >
                    Designation {index + 1}
                  </label>
                  <input
                    id={`designation-${index}`}
                    className={control}
                    {...register(`additionalDesignations.${index}` as never)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove designation ${index + 1}`}
                  onClick={() => designations.remove(index)}
                >
                  Remove
                </Button>
              </div>
            ))}

            {err("additionalDesignations") !== undefined && (
              <p className="mt-1 text-xs text-[#DD4820]" role="status">
                {err("additionalDesignations")}
              </p>
            )}

            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => designations.append("" as never)}
            >
              Add another designation
            </Button>
          </div>

          <Labelled label="Role category" error={err("roleCategory")}>
            {(id) => (
              <select id={id} className={control} {...register("roleCategory")}>
                <option value="">Select…</option>
                {ROLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ROLE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
          {/* Answer 2 (2026-08-18): "keep space to type JD. Field is not
              mandatory." It is what the student's drive card and the recruiter
              export can actually show — a PDF is neither excerptable nor
              readable on a phone between lectures. */}
          <Labelled label="Job description" error={err("jobDescription")} wide>
            {(id) => (
              <>
                <textarea id={id} rows={4} className={control} {...register("jobDescription")} />
                <p className="mt-1 text-xs text-ink-500">
                  Optional. Shown on the student's drive card and in the recruiter export.
                </p>
              </>
            )}
          </Labelled>

          {/*
           * J1 (2026-08-18): "add an option to ATTACH a JD (job description) as
           * PDF FILE." The AE used to retype or paste a fragment of the
           * recruiter's mail; the document itself never entered the system, so
           * nobody downstream could read what the company actually wrote.
           *
           * It sits BESIDE the typed description (answer 1), not instead of it.
           */}
          <Labelled label="Attach the job description (PDF)" error={err("jobDescriptionFile")} wide>
            {(id) => (
              <>
                <input
                  id={id}
                  type="file"
                  accept="application/pdf,.pdf"
                  className={`${control} file:mr-3 file:rounded-md file:border-0 file:bg-[#3D3777] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white`}
                  onChange={(e) =>
                    setValue("jobDescriptionFile", e.target.files?.[0] ?? null, {
                      shouldValidate: true,
                    })
                  }
                />
                <p className="mt-1 text-xs text-ink-500">
                  PDF only, up to 5 MB. Visible to the Delivery Head approving the drive and to the
                  students it is published to.
                </p>
                {jobDescriptionFile !== null && (
                  <p className="mt-2 text-xs font-medium text-ink-800">
                    Attached: {jobDescriptionFile.name}{" "}
                    <span className="font-normal text-ink-500">
                      ({describeFileSize(jobDescriptionFile.size)})
                    </span>
                  </p>
                )}
              </>
            )}
          </Labelled>
          <Labelled label="Number of openings" error={err("openings")}>
            {(id) => (
              <input id={id} type="number" className={control} {...register("openings", numeric)} />
            )}
          </Labelled>
          <Labelled label="Work location(s)" error={err("workLocations")}>
            {(id) => <input id={id} className={control} {...register("workLocations")} />}
          </Labelled>
          <Labelled label="Minimum CTC (LPA)" error={err("ctcMinLpa")}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                className={control}
                {...register("ctcMinLpa", numeric)}
              />
            )}
          </Labelled>
          <Labelled label="Maximum CTC (LPA)" error={err("ctcMaxLpa")}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                className={control}
                {...register("ctcMaxLpa", numeric)}
              />
            )}
          </Labelled>
          <Labelled label="CTC breakup (fixed / variable)" error={err("ctcBreakup")} wide>
            {(id) => <input id={id} className={control} {...register("ctcBreakup")} />}
          </Labelled>
          {/*
           * J2 (2026-08-18): "Shift time, instead of a text box, change to
           * radio button — Day and Night as options with time to be filled as
           * text for night box." Rotational and Flexible were added at
           * approval (answer 5).
           *
           * A free-text box produced "General" on four live drives, which tells
           * a student nothing about whether they will be awake at 3am.
           */}
          <div className="sm:col-span-2">
            <RadioGroup
              legend="Shift"
              name="shiftType"
              value={shiftType}
              options={SHIFT_TYPES.map((s) => ({ value: s, label: shiftLabel(s) }))}
              error={err("shiftType")}
              onChange={(next) => {
                setValue("shiftType", next as typeof shiftType, { shouldValidate: true });
                // Hiding the box is not enough: a hidden field still submits,
                // and `0051` refuses a night timing on a day shift.
                if (next !== "night") setValue("shiftNightTiming", "");
              }}
            />
            {shiftType === "night" && (
              <div className="mt-3 border-l-[3px] border-[#A46AFC] bg-[#A46AFC]/5 py-3 pl-4 pr-3">
                <Labelled label="Night shift timing" error={err("shiftNightTiming")}>
                  {(id) => (
                    <>
                      <input
                        id={id}
                        className={control}
                        placeholder="9.00 pm – 6.00 am IST"
                        {...register("shiftNightTiming")}
                      />
                      <p className="mt-1 text-xs text-ink-500">
                        In the recruiter's own words. A student plans their travel around it.
                      </p>
                    </>
                  )}
                </Labelled>
              </div>
            )}
          </div>
          <Labelled label="Bond / service agreement" error={err("bondDetails")}>
            {(id) => <input id={id} className={control} {...register("bondDetails")} />}
          </Labelled>
        </Section>

        <Section title="Eligibility criteria">
          {/* F12: the figure and the scale it was stated on. The normalised
              CGPA every drive is filtered on is derived once, in the
              repository, via @domain/marks. */}
          <Labelled label="Cutoff scale" error={err("minOverallCgpaScale")}>
            {(id) => (
              <select id={id} className={control} {...register("minOverallCgpaScale")}>
                {MARKS_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    {SCALE_LABELS[scale]}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
          <Labelled label="Minimum overall marks" error={err("minOverallCgpa")}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                className={control}
                {...register("minOverallCgpa", numeric)}
              />
            )}
          </Labelled>
          <Labelled label="Arrear policy" error={err("arrearsPolicy")}>
            {(id) => (
              <select id={id} className={control} {...register("arrearsPolicy")}>
                {ARREAR_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {ARREAR_LABELS[p]}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
          <Labelled label="Minimum 10th %" error={err("minTenthPercentage")}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                className={control}
                {...register("minTenthPercentage", numeric)}
              />
            )}
          </Labelled>
          <Labelled label="Minimum 12th %" error={err("minTwelfthPercentage")}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                className={control}
                {...register("minTwelfthPercentage", numeric)}
              />
            )}
          </Labelled>

          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-ink-900">
              Eligible passing years
            </legend>
            <div className="flex flex-wrap gap-4">
              {PASSING_YEARS.map((year) => (
                <label key={year} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    value={year}
                    className="size-4 accent-[#3D3777]"
                    {...register("eligiblePassingYears")}
                  />
                  {year}
                </label>
              ))}
            </div>
            {err("eligiblePassingYears") !== undefined && (
              <p className="mt-1 text-xs text-[#DD4820]" role="status">
                {err("eligiblePassingYears")}
              </p>
            )}
          </fieldset>

          <Labelled label="Mandatory skills" error={err("mandatorySkills")} wide>
            {(id) => <input id={id} className={control} {...register("mandatorySkills")} />}
          </Labelled>
        </Section>

        <Section title="Selection process and timeline">
          <Labelled label="Drive mode" error={err("driveMode")}>
            {(id) => (
              <select id={id} className={control} {...register("driveMode")}>
                <option value="">Select…</option>
                {DRIVE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {DRIVE_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
          <Labelled label="Drive type" error={err("driveType")}>
            {(id) => (
              <select id={id} className={control} {...register("driveType")}>
                <option value="">Select…</option>
                {DRIVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DRIVE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
          {/*
           * The rounds, named and numbered (2026-08-18). F11 asked the AE for a
           * COUNT, which told the Central CPC how many boxes to invent and told
           * the student nothing - nobody can prepare for "Round 2". The AE heard
           * the process from the company, so the names are theirs to record, and
           * they are carried onto the drive at publish.
           */}
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-ink-700">Rounds in the process</p>
            <p className="mb-3 text-xs text-ink-500">
              In order — e.g. Round 1 Aptitude test, Round 2 Technical interview.
            </p>

            <div className="flex flex-col gap-2">
              {rounds.map((round, index) => (
                <div key={round.sequence} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-56 flex-1">
                    <Labelled label={`Round ${round.sequence} name`}>
                      {(id) => (
                        <input
                          id={id}
                          className={control}
                          value={round.name}
                          onChange={(e) =>
                            setValue(
                              "rounds",
                              rounds.map((r, i) =>
                                i === index ? { ...r, name: e.target.value } : r,
                              ),
                              { shouldValidate: true },
                            )
                          }
                        />
                      )}
                    </Labelled>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove round ${round.sequence}`}
                    onClick={() =>
                      setValue(
                        "rounds",
                        // Numbers are positional, so close the gap - the same
                        // rule the semester lines follow.
                        rounds
                          .filter((_, i) => i !== index)
                          .map((r, i) => ({ ...r, sequence: i + 1 })),
                        { shouldValidate: true },
                      )
                    }
                    className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-danger-700 hover:bg-danger-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                setValue("rounds", [...rounds, { sequence: rounds.length + 1, name: "" }], {
                  shouldValidate: true,
                })
              }
              className="mt-3 rounded-lg border border-dashed border-brand-300 px-4 py-2 text-sm font-semibold text-brand-500 hover:bg-brand-50"
            >
              Add round
            </button>
            {err("rounds") !== undefined && (
              <p role="alert" className="mt-1 text-xs font-medium text-danger-700">
                {err("rounds")}
              </p>
            )}
          </div>
          <Labelled label="Tentative drive date" error={err("tentativeDate")}>
            {(id) => (
              <input id={id} type="date" className={control} {...register("tentativeDate")} />
            )}
          </Labelled>
          {/*
           * J3 (2026-08-18): "instead of a large text box, have radio button
           * for immediate joining and joining later. Have a comments box also
           * for both the options."
           *
           * The one fact a student plans their year around used to be buried in
           * prose, so no screen could show it and no list could be filtered by
           * it. One comment box PER OPTION (answer 6) — switching the radio
           * drops the other, because a note about joining next July left on a
           * drive that says immediate is worse than no note at all.
           */}
          <div className="sm:col-span-2">
            <RadioGroup
              legend="Offer rollout and joining"
              name="joiningTimeline"
              value={joiningTimeline}
              options={JOINING_TIMELINES.map((t) => ({ value: t, label: joiningLabel(t) }))}
              error={err("joiningTimeline")}
              onChange={(next) => {
                setValue("joiningTimeline", next as typeof joiningTimeline, {
                  shouldValidate: true,
                });
                setValue(next === "immediate" ? "joiningLaterNotes" : "joiningImmediateNotes", "");
              }}
            />
            {joiningTimeline !== "" && (
              <div className="mt-3 border-l-[3px] border-[#A46AFC] bg-[#A46AFC]/5 py-3 pl-4 pr-3">
                {joiningTimeline === "immediate" ? (
                  <Labelled
                    label="Comments on immediate joining"
                    error={err("joiningImmediateNotes")}
                  >
                    {(id) => (
                      <textarea
                        id={id}
                        rows={2}
                        className={control}
                        placeholder="Optional — e.g. onboarding within 30 days of the offer."
                        {...register("joiningImmediateNotes")}
                      />
                    )}
                  </Labelled>
                ) : (
                  <Labelled label="Comments on joining later" error={err("joiningLaterNotes")}>
                    {(id) => (
                      <textarea
                        id={id}
                        rows={2}
                        className={control}
                        placeholder="Optional — e.g. offers in Nov 2026, joining from July 2027."
                        {...register("joiningLaterNotes")}
                      />
                    )}
                  </Labelled>
                )}
              </div>
            )}
          </div>
        </Section>

        <div className="flex flex-wrap gap-3 pb-10">
          <Button type="button" disabled={isSubmitting} onClick={run("submit")}>
            {isSubmitting ? "Working…" : "Submit for approval"}
          </Button>
          <Button type="button" variant="secondary" disabled={isSubmitting} onClick={run("draft")}>
            Save draft
          </Button>
        </div>
      </form>
    </>
  );
}
