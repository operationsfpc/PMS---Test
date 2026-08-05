import { Button, Card, PageHeader } from "@components/ui";
import { MARKS_SCALES } from "@domain/marks";
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
              One interview process, however many designations \u2014 one PIF.
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
          <Labelled label="Job description" error={err("jobDescription")} wide>
            {(id) => (
              <textarea id={id} rows={4} className={control} {...register("jobDescription")} />
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
          <Labelled label="Shift type" error={err("shiftType")}>
            {(id) => <input id={id} className={control} {...register("shiftType")} />}
          </Labelled>
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
          {/* F11: the Central CPC was typing the round list from an email. */}
          <Labelled label="Number of rounds" error={err("roundCount")}>
            {(id) => (
              <input
                id={id}
                type="number"
                min="1"
                className={control}
                {...register("roundCount", numeric)}
              />
            )}
          </Labelled>
          <Labelled label="Tentative drive date" error={err("tentativeDate")}>
            {(id) => (
              <input id={id} type="date" className={control} {...register("tentativeDate")} />
            )}
          </Labelled>
          <Labelled label="Offer rollout and joining timeline" error={err("timelineNotes")} wide>
            {(id) => (
              <textarea id={id} rows={3} className={control} {...register("timelineNotes")} />
            )}
          </Labelled>
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
