import { Button, Card, PageHeader } from "@components/ui";
import { describeFileSize } from "@domain/attachments";
import { driveVenueApplies } from "@domain/drive-venue";
import { JOINING_TIMELINES, joiningLabel } from "@domain/joining";
import { MARKS_SCALES } from "@domain/marks";
import { SHIFT_TYPES, shiftLabel } from "@domain/shift";
import { ARREAR_POLICIES, DRIVE_MODES, DRIVE_TYPES, ROLE_CATEGORIES } from "@domain/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useId, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { PIF_DEFAULTS, type PifFormValues, pifDraftSchema, pifSubmitSchema } from "./pif-schema";

/**
 * The AE's sections, in the order UAT 2026-08-19 asked for (A1/A3): the drive
 * type FIRST — it decides which compensation exists, which students see the
 * drive and how the offer classifies — with the compensation immediately
 * after it. Offer category still belongs to the Delivery Head.
 */
export const PIF_SECTIONS = [
  { id: "type", title: "Drive type and compensation" },
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
  required = false,
}: {
  label: string;
  error?: string | undefined;
  children: (id: string) => ReactNode;
  wide?: boolean;
  /** G2 (UAT 2026-08-20): required to SUBMIT — the marker the form was missing. */
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-900">
        {required ? `${label} *` : label}
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
  required = false,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
  error?: string | undefined;
  /** G2: required to submit. */
  required?: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-900">
        {required ? `${legend} *` : legend}
      </legend>
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

  /** A4 (UAT 2026-08-19): several contacts per drive, added with a "+". */
  const contacts = useFieldArray({ control: formControl, name: "contacts" as never });

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
  const driveMode = watch("driveMode") ?? "";
  const venueStatus = watch("venueStatus") ?? "not_yet_confirmed";
  const joiningTimeline = watch("joiningTimeline") ?? "";
  /** A1/A2: the load-bearing first choice, and what compensation follows it. */
  const driveType = watch("driveType") ?? "";
  const wantsCtc = driveType === "placement" || driveType === "internship_convertible";
  const wantsStipend = driveType === "internship" || driveType === "internship_convertible";
  const contactRows = watch("contacts") ?? [];
  const hasAnyContact = contactRows.some((c) =>
    [c?.name, c?.designation, c?.email, c?.phone].some(
      (f) => typeof f === "string" && f.trim() !== "",
    ),
  );

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
        {/* G2 (UAT 2026-08-20): the convention, stated once. Before this, no
            field said whether it was mandatory, and thin PIFs reached the
            Delivery Head looking complete. */}
        <p className="mb-4 text-sm text-ink-700">
          Fields marked * are required to submit for approval. A draft can be saved at any point.
        </p>
        {/* A1 (UAT 2026-08-19): the type comes FIRST — it decides which
            compensation fields exist at all, so asking it last meant an AE
            discovered the form's shape after filling it. */}
        <Section title="Drive type and compensation">
          <div className="sm:col-span-2">
            <RadioGroup
              legend="Drive type"
              required
              name="driveType"
              value={driveType}
              options={DRIVE_TYPES.map((t) => ({ value: t, label: DRIVE_TYPE_LABELS[t] ?? t }))}
              error={err("driveType")}
              onChange={(next) => {
                setValue("driveType", next as typeof driveType, { shouldValidate: true });
                // A hidden field still submits (the J2 lesson): compensation
                // the new type does not have is cleared, not merely hidden.
                if (next === "placement") {
                  setValue("stipendMinMonthly", null);
                  setValue("stipendMaxMonthly", null);
                }
                if (next === "internship") {
                  setValue("ctcMinLpa", null);
                  setValue("ctcMaxLpa", null);
                  setValue("ctcBreakup", "");
                }
              }}
            />
          </div>

          {wantsStipend && (
            <>
              <Labelled
                label="Stipend minimum (₹ / month)"
                required
                error={err("stipendMinMonthly")}
              >
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    className={control}
                    {...register("stipendMinMonthly", numeric)}
                  />
                )}
              </Labelled>
              <Labelled label="Stipend maximum (₹ / month)" error={err("stipendMaxMonthly")}>
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    className={control}
                    {...register("stipendMaxMonthly", numeric)}
                  />
                )}
              </Labelled>
            </>
          )}

          {wantsCtc && (
            <>
              <Labelled label="Minimum CTC (LPA)" required error={err("ctcMinLpa")}>
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
            </>
          )}

          {driveType === "" && (
            <p className="sm:col-span-2 text-sm text-ink-500">
              Choose the type first — the compensation fields follow from it.
            </p>
          )}
        </Section>

        <Section title="Company details">
          <Labelled label="Company name" required error={err("companyName")}>
            {(id) => <input id={id} className={control} {...register("companyName")} />}
          </Labelled>
          <Labelled label="Industry / domain" error={err("industry")}>
            {(id) => <input id={id} className={control} {...register("industry")} />}
          </Labelled>
          <Labelled label="Company website" error={err("companyWebsite")}>
            {(id) => <input id={id} className={control} {...register("companyWebsite")} />}
          </Labelled>

          {/* A4/A5 (UAT 2026-08-19): several contacts, all optional. With none,
              the Central CPC is the point of contact — said here, not assumed. */}
          <div className="sm:col-span-2 rounded-lg border border-line bg-surface-muted p-4">
            <p className="text-sm font-medium text-ink-900">Company contacts</p>
            <p className="mt-1 text-xs text-ink-700">
              Who the placement team reaches at {"the company"}. All optional — add as many as you
              have.
            </p>

            {!hasAnyContact && (
              <p
                role="note"
                className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-ink-900"
              >
                No contact added — the <strong>Central Placement Coordinator</strong> will be the
                point of contact for this company.
              </p>
            )}

            {contacts.fields.map((field, index) => (
              <div
                key={field.id}
                className="mt-3 grid gap-2 rounded-lg border border-line bg-white p-3 sm:grid-cols-2"
              >
                <div>
                  <label
                    htmlFor={`contact-name-${index}`}
                    className="mb-1 block text-xs font-medium text-ink-700"
                  >
                    Contact {index + 1} name
                  </label>
                  <input
                    id={`contact-name-${index}`}
                    className={control}
                    {...register(`contacts.${index}.name` as never)}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`contact-designation-${index}`}
                    className="mb-1 block text-xs font-medium text-ink-700"
                  >
                    Contact {index + 1} designation
                  </label>
                  <input
                    id={`contact-designation-${index}`}
                    className={control}
                    {...register(`contacts.${index}.designation` as never)}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`contact-email-${index}`}
                    className="mb-1 block text-xs font-medium text-ink-700"
                  >
                    Contact {index + 1} email
                  </label>
                  <input
                    id={`contact-email-${index}`}
                    className={control}
                    {...register(`contacts.${index}.email` as never)}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label
                      htmlFor={`contact-phone-${index}`}
                      className="mb-1 block text-xs font-medium text-ink-700"
                    >
                      Contact {index + 1} phone
                    </label>
                    <input
                      id={`contact-phone-${index}`}
                      className={control}
                      {...register(`contacts.${index}.phone` as never)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove contact ${index + 1}`}
                    onClick={() => contacts.remove(index)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() =>
                contacts.append({ name: "", designation: "", email: "", phone: "" } as never)
              }
            >
              + Add a contact
            </Button>
          </div>
        </Section>

        <Section title="Role details">
          <Labelled label="Role title" required error={err("roleTitle")}>
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

          <Labelled label="Role category" required error={err("roleCategory")}>
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
          {/* A3 (UAT 2026-08-19): openings and location directly after the role
              — the order the meeting proposed. */}
          <Labelled label="Number of openings" required error={err("openings")}>
            {(id) => (
              <input id={id} type="number" className={control} {...register("openings", numeric)} />
            )}
          </Labelled>
          <Labelled label="Work location(s)" required error={err("workLocations")}>
            {(id) => <input id={id} className={control} {...register("workLocations")} />}
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
              Eligible passing years *
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
              <select
                id={id}
                className={control}
                {...register("driveMode", {
                  onChange: () => {
                    // UAT 2026-08-21 item 2, the J2 lesson: a venue typed for
                    // an off-campus mode must not survive, hidden, when the
                    // mode changes its mind. Reset both halves.
                    setValue("venueStatus", "not_yet_confirmed");
                    setValue("venue", "");
                  },
                })}
              >
                <option value="">Select…</option>
                {DRIVE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {DRIVE_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
          {/*
           * UAT 2026-08-21 item 2: an off-campus drive happens somewhere, and
           * the PIF had nowhere to say where. The venue is often NOT final at
           * PIF time — "not yet confirmed" always submits, and the Central
           * CPC records the venue once the company confirms it (answer Q5).
           */}
          {driveVenueApplies(driveMode) && (
            <div className="sm:col-span-2">
              <RadioGroup
                legend="Venue"
                name="venueStatus"
                value={venueStatus}
                options={[
                  { value: "not_yet_confirmed", label: "Venue not yet confirmed" },
                  { value: "confirmed", label: "Venue confirmed" },
                ]}
                error={err("venueStatus")}
                onChange={(next) => {
                  setValue("venueStatus", next as "not_yet_confirmed" | "confirmed", {
                    shouldValidate: true,
                  });
                  // The J2 lesson again: an abandoned venue does not linger.
                  if (next !== "confirmed") setValue("venue", "");
                }}
              />
              {venueStatus === "confirmed" && (
                <div className="mt-3 border-l-[3px] border-[#A46AFC] bg-[#A46AFC]/5 py-3 pl-4 pr-3">
                  <Labelled label="Venue" error={err("venue")}>
                    {(id) => (
                      <input
                        id={id}
                        className={control}
                        placeholder="e.g. HCL Campus, Sholinganallur, Chennai"
                        {...register("venue")}
                      />
                    )}
                  </Labelled>
                </div>
              )}
            </div>
          )}
          {/* Drive type moved to Section 1 (A1, UAT 2026-08-19). */}
          {/*
           * The rounds, named and numbered (2026-08-18). F11 asked the AE for a
           * COUNT, which told the Central CPC how many boxes to invent and told
           * the student nothing - nobody can prepare for "Round 2". The AE heard
           * the process from the company, so the names are theirs to record, and
           * they are carried onto the drive at publish.
           */}
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-ink-700">Rounds in the process *</p>
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
              required
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
