import { Combobox } from "@components/combobox";
import { Button } from "@components/ui";
import { describeFileSize } from "@domain/attachments";
import { driveVenueApplies } from "@domain/drive-venue";
import { JOINING_TIMELINES, joiningLabel } from "@domain/joining";
import { MARKS_SCALES } from "@domain/marks";
import { SHIFT_TYPES, shiftLabel } from "@domain/shift";
import { joinMandatorySkills, normaliseSkillAreaName, skillAreaKey } from "@domain/skills";
import type { DriveMode } from "@domain/types";
import { ARREAR_POLICIES, DRIVE_MODES, DRIVE_TYPES } from "@domain/types";
import { useId, useState } from "react";
import {
  type Control,
  type FieldValues,
  type UseFormRegister,
  type UseFormSetValue,
  useFieldArray,
  useWatch,
} from "react-hook-form";
import { control as controlClass, Labelled, numeric, RadioGroup } from "./pif-controls";
import {
  ARREAR_LABELS,
  type ContactRow,
  DRIVE_MODE_LABELS,
  DRIVE_TYPE_LABELS,
  hasAnyContactIn,
  PASSING_YEARS,
  SCALE_LABELS,
} from "./pif-labels";

/**
 * The PIF's field groups, written ONCE.
 *
 * The single-role PIF and the multi-role form used to carry two hand-written
 * copies of every field block — drive type and compensation, shift, eligibility,
 * skills, designations, rounds, JD, contacts, venue — ~700 lines of drifting
 * duplication. Each group here is path-agnostic: it asks its `api` for full
 * RHF paths, so the single form scopes paths at the top level ("openings")
 * and a role card scopes them under its position ("roles.0.openings") with
 * the SAME component.
 *
 * The `as never` casts this demands are deliberately CONTAINED HERE, where
 * every path is also built; the two forms hand in their real, fully typed
 * register/setValue/control and never see one.
 */
export interface PifFieldApi<T extends FieldValues = FieldValues> {
  /** The full RHF path for one of this group's fields. */
  field: (name: string) => string;
  register: UseFormRegister<T>;
  setValue: UseFormSetValue<T>;
  control: Control<T>;
  err: (key: string) => string | undefined;
}

/** Scopes an api to a nested path (a role card) with that path's error set. */
export function scopedPifFieldApi<T extends FieldValues>(
  api: PifFieldApi<T>,
  path: string,
  errors: unknown,
): PifFieldApi<T> {
  const scoped = (errors ?? {}) as unknown as Record<string, { message?: string } | undefined>;
  return {
    field: (name) => `${path}.${name}`,
    register: api.register,
    setValue: api.setValue,
    control: api.control,
    err: (key) => scoped[key]?.message,
  };
}

/**
 * A1/A2: the type is the load-bearing first choice, and the compensation
 * fields follow from it — a placement carries CTC, an internship a stipend,
 * a convertible both. Compensation the new type does not have is CLEARED, not
 * merely hidden: a hidden field still submits.
 */
export function DriveTypeAndCompensationField<T extends FieldValues>({
  api,
}: {
  api: PifFieldApi<T>;
}) {
  const driveType = (useWatch({ control: api.control, name: api.field("driveType") as never }) ??
    "") as unknown as string;
  const wantsCtc = driveType === "placement" || driveType === "internship_convertible";
  const wantsStipend = driveType === "internship" || driveType === "internship_convertible";

  return (
    <>
      <div className="sm:col-span-2">
        <RadioGroup
          legend="Drive type"
          required
          name={api.field("driveType")}
          value={driveType}
          options={DRIVE_TYPES.map((t) => ({ value: t, label: DRIVE_TYPE_LABELS[t] ?? t }))}
          error={api.err("driveType")}
          onChange={(next) => {
            api.setValue(api.field("driveType") as never, next as never, {
              shouldValidate: true,
            });
            // A hidden field still submits (the J2 lesson): compensation
            // the new type does not have is cleared, not merely hidden.
            if (next === "placement") {
              api.setValue(api.field("stipendMinMonthly") as never, null as never);
              api.setValue(api.field("stipendMaxMonthly") as never, null as never);
            }
            if (next === "internship") {
              api.setValue(api.field("ctcMinLpa") as never, null as never);
              api.setValue(api.field("ctcMaxLpa") as never, null as never);
              api.setValue(api.field("ctcBreakup") as never, "" as never);
            }
          }}
        />
      </div>

      {wantsStipend && (
        <>
          <Labelled
            label="Stipend minimum (₹ / month)"
            required
            error={api.err("stipendMinMonthly")}
          >
            {(id) => (
              <input
                id={id}
                type="number"
                placeholder="e.g. 25000"
                className={controlClass}
                {...api.register(api.field("stipendMinMonthly") as never, numeric)}
              />
            )}
          </Labelled>
          <Labelled label="Stipend maximum (₹ / month)" error={api.err("stipendMaxMonthly")}>
            {(id) => (
              <input
                id={id}
                type="number"
                placeholder="e.g. 35000"
                className={controlClass}
                {...api.register(api.field("stipendMaxMonthly") as never, numeric)}
              />
            )}
          </Labelled>
        </>
      )}

      {wantsCtc && (
        <>
          <Labelled label="Minimum CTC (LPA)" required error={api.err("ctcMinLpa")}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                placeholder="e.g. 6.5"
                className={controlClass}
                {...api.register(api.field("ctcMinLpa") as never, numeric)}
              />
            )}
          </Labelled>
          <Labelled label="Maximum CTC (LPA)" error={api.err("ctcMaxLpa")}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="0.01"
                placeholder="e.g. 8.0"
                className={controlClass}
                {...api.register(api.field("ctcMaxLpa") as never, numeric)}
              />
            )}
          </Labelled>
          <Labelled label="CTC breakup (fixed / variable)" error={api.err("ctcBreakup")} wide>
            {(id) => (
              <input
                id={id}
                placeholder="e.g. 6 LPA Fixed + 0.5 LPA Performance Bonus"
                className={controlClass}
                {...api.register(api.field("ctcBreakup") as never)}
              />
            )}
          </Labelled>
        </>
      )}

      {driveType === "" && (
        <p className="sm:col-span-2 text-sm text-ink-500">
          Choose the type first — the compensation fields follow from it.
        </p>
      )}
    </>
  );
}

/**
 * J2 (2026-08-18): a radio, not a text box. A free-text box produced
 * "General" on four live drives, which tells a student nothing about whether
 * they will be awake at 3am. The hours appear only for Night, and switching
 * away drops them — `0051` refuses a night timing on a day shift outright.
 */
export function ShiftField<T extends FieldValues>({ api }: { api: PifFieldApi<T> }) {
  const shiftType = (useWatch({ control: api.control, name: api.field("shiftType") as never }) ??
    "") as unknown as string;

  return (
    <div className="sm:col-span-2">
      <RadioGroup
        legend="Shift"
        name={api.field("shiftType")}
        value={shiftType}
        options={SHIFT_TYPES.map((s) => ({ value: s, label: shiftLabel(s) }))}
        error={api.err("shiftType")}
        onChange={(next) => {
          api.setValue(api.field("shiftType") as never, next as never, { shouldValidate: true });
          // Hiding the box is not enough: a hidden field still submits,
          // and `0051` refuses a night timing on a day shift.
          if (next !== "night") api.setValue(api.field("shiftNightTiming") as never, "" as never);
        }}
      />
      {shiftType === "night" && (
        <div className="mt-3 border-l-[3px] border-violet-400 bg-violet-400/5 py-3 pl-4 pr-3">
          <Labelled label="Night shift timing" error={api.err("shiftNightTiming")}>
            {(id) => (
              <input
                id={id}
                className={controlClass}
                placeholder="9.00 pm – 6.00 am IST"
                {...api.register(api.field("shiftNightTiming") as never)}
              />
            )}
          </Labelled>
        </div>
      )}
    </div>
  );
}

/**
 * F12: the cutoff is stated the way the recruiter's own HR states it, on the
 * scale it was declared on. The normalised CGPA every drive is filtered on is
 * derived once, in the repository, via `@domain/marks`.
 */
export function EligibilityFields<T extends FieldValues>({ api }: { api: PifFieldApi<T> }) {
  return (
    <>
      <Labelled label="Cutoff scale" error={api.err("minOverallCgpaScale")}>
        {(id) => (
          <select
            id={id}
            className={controlClass}
            {...api.register(api.field("minOverallCgpaScale") as never)}
          >
            {MARKS_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {SCALE_LABELS[scale]}
              </option>
            ))}
          </select>
        )}
      </Labelled>
      <Labelled label="Minimum overall marks" error={api.err("minOverallCgpa")}>
        {(id) => (
          <input
            id={id}
            type="number"
            step="0.01"
            placeholder="e.g. 7.5"
            className={controlClass}
            {...api.register(api.field("minOverallCgpa") as never, numeric)}
          />
        )}
      </Labelled>
      <Labelled label="Arrear policy" error={api.err("arrearsPolicy")}>
        {(id) => (
          <select
            id={id}
            className={controlClass}
            {...api.register(api.field("arrearsPolicy") as never)}
          >
            {ARREAR_POLICIES.map((p) => (
              <option key={p} value={p}>
                {ARREAR_LABELS[p]}
              </option>
            ))}
          </select>
        )}
      </Labelled>
      <Labelled label="Minimum 10th %" error={api.err("minTenthPercentage")}>
        {(id) => (
          <input
            id={id}
            type="number"
            step="0.01"
            placeholder="e.g. 60"
            className={controlClass}
            {...api.register(api.field("minTenthPercentage") as never, numeric)}
          />
        )}
      </Labelled>
      <Labelled label="Minimum 12th %" error={api.err("minTwelfthPercentage")}>
        {(id) => (
          <input
            id={id}
            type="number"
            step="0.01"
            placeholder="e.g. 60"
            className={controlClass}
            {...api.register(api.field("minTwelfthPercentage") as never, numeric)}
          />
        )}
      </Labelled>

      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-ink-900">Eligible passing years *</legend>
        <div className="flex flex-wrap gap-4">
          {PASSING_YEARS.map((year) => (
            <label key={year} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={year}
                className="size-4 accent-brand-500"
                {...api.register(api.field("eligiblePassingYears") as never)}
              />
              {year}
            </label>
          ))}
        </div>
        {api.err("eligiblePassingYears") !== undefined && (
          <p className="mt-1 text-xs text-danger-500" role="status">
            {api.err("eligiblePassingYears")}
          </p>
        )}
      </fieldset>
    </>
  );
}

/**
 * Spec 2026-08-21 part A (approved 2026-08-24): the ONLY skills the AE may
 * pick are the ones the students are assessed on; anything else is an
 * explicit "other". Free text invited names the ranking could never match.
 * The joined text lands in the form through `onChange`.
 */
export function SkillsPicker({
  skillAreas,
  onChange,
}: {
  skillAreas: readonly string[];
  onChange: (joined: string) => void;
}) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [others, setOthers] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState("");
  const id = useId();

  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1 block text-sm font-medium text-ink-700">Mandatory skills</legend>
      {skillAreas.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {skillAreas.map((name) => (
            <label key={name} className="flex items-center gap-2 text-sm text-ink-800">
              <input
                type="checkbox"
                checked={picked.includes(name)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...picked, name]
                    : picked.filter((p) => p !== name);
                  setPicked(next);
                  onChange(joinMandatorySkills(next, others, skillAreas));
                }}
              />
              {name}
            </label>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`${id}-other`} className="mb-1 block text-xs font-medium text-ink-700">
            Other skill
          </label>
          <input
            id={`${id}-other`}
            className={controlClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label="Add other skill"
          onClick={() => {
            const name = normaliseSkillAreaName(draft);
            if (name === "") return;
            const next = others.some((o) => skillAreaKey(o) === skillAreaKey(name))
              ? others
              : [...others, name];
            setOthers(next);
            setDraft("");
            onChange(joinMandatorySkills(picked, next, skillAreas));
          }}
        >
          Add
        </Button>
      </div>
      {others.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {others.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-800"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                className="font-bold text-ink-500"
                onClick={() => {
                  const next = others.filter((o) => o !== name);
                  setOthers(next);
                  onChange(joinMandatorySkills(picked, next, skillAreas));
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-ink-500">
        Skills outside the repository can't be scored until they are assessed and added to the Skill
        repository.
      </p>
    </fieldset>
  );
}

/**
 * F7: one interview process, several job titles. Rows are added by the AE and
 * blank ones are dropped by the schema — an untouched row is not a mistake
 * worth an error message.
 */
export function DesignationsEditor<T extends FieldValues>({
  api,
  heading,
  detail,
}: {
  api: PifFieldApi<T>;
  heading: string;
  detail?: string;
}) {
  const designations = useFieldArray({
    control: api.control,
    name: api.field("additionalDesignations") as never,
  });

  return (
    <div className="sm:col-span-2 rounded-lg border border-line bg-surface-muted p-4">
      <p className="text-sm font-medium text-ink-900">{heading}</p>
      {detail !== undefined && <p className="mt-1 text-xs text-ink-700">{detail}</p>}

      {designations.fields.map((field, index) => (
        <div key={field.id} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label
              htmlFor={`designation-${field.id}`}
              className="mb-1 block text-xs font-medium text-ink-700"
            >
              Designation {index + 1}
            </label>
            <input
              id={`designation-${field.id}`}
              className={controlClass}
              {...api.register(`${api.field("additionalDesignations")}.${index}` as never)}
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

      {api.err("additionalDesignations") !== undefined && (
        <p className="mt-1 text-xs text-danger-500" role="status">
          {api.err("additionalDesignations")}
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
  );
}

/**
 * The rounds, named and numbered (2026-08-18). F11 asked the AE for a COUNT,
 * which told the Central CPC how many boxes to invent and told the student
 * nothing — nobody can prepare for "Round 2". Numbers are positional, so
 * removing one closes the gap, the same rule the semester lines follow.
 */
export function RoundsEditor<T extends FieldValues>({ api }: { api: PifFieldApi<T> }) {
  const rounds = (useWatch({ control: api.control, name: api.field("rounds") as never }) ??
    []) as unknown as Array<{ sequence: number; name: string }>;

  return (
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
                    className={controlClass}
                    value={round.name}
                    onChange={(e) =>
                      api.setValue(
                        api.field("rounds") as never,
                        rounds.map((r, i) =>
                          i === index ? { ...r, name: e.target.value } : r,
                        ) as never,
                        { shouldValidate: true },
                      )
                    }
                  />
                )}
              </Labelled>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove round ${round.sequence}`}
              onClick={() =>
                api.setValue(
                  api.field("rounds") as never,
                  rounds
                    .filter((_, i) => i !== index)
                    .map((r, i) => ({ ...r, sequence: i + 1 })) as never,
                  { shouldValidate: true },
                )
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() =>
          api.setValue(
            api.field("rounds") as never,
            [...rounds, { sequence: rounds.length + 1, name: "" }] as never,
            { shouldValidate: true },
          )
        }
      >
        Add round
      </Button>
      {api.err("rounds") !== undefined && (
        <p role="alert" className="mt-1 text-xs font-medium text-danger-700">
          {api.err("rounds")}
        </p>
      )}
    </div>
  );
}

/**
 * The typed description sits BESIDE the attached PDF (J1/answer 1), never
 * instead of it: the text is what a drive card and the recruiter export can
 * actually show, the file is what the company actually wrote.
 */
export function JobDescriptionField<T extends FieldValues>({
  api,
  fileHint,
}: {
  api: PifFieldApi<T>;
  fileHint: string;
}) {
  const jdFile = (useWatch({
    control: api.control,
    name: api.field("jobDescriptionFile") as never,
  }) ?? null) as unknown as File | null;

  return (
    <>
      <Labelled label="Job description" error={api.err("jobDescription")} wide>
        {(id) => (
          <>
            <textarea
              id={id}
              rows={4}
              className={controlClass}
              {...api.register(api.field("jobDescription") as never)}
            />
            <p className="mt-1 text-xs text-ink-500">
              Optional. Shown on the student's drive card and in the recruiter export.
            </p>
          </>
        )}
      </Labelled>
      <Labelled label="Attach the job description (PDF)" error={api.err("jobDescriptionFile")} wide>
        {(id) => (
          <>
            <input
              id={id}
              type="file"
              accept="application/pdf,.pdf"
              className={`${controlClass} file:mr-3 file:rounded-md file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white`}
              onChange={(e) =>
                api.setValue(
                  api.field("jobDescriptionFile") as never,
                  (e.target.files?.[0] ?? null) as never,
                  { shouldValidate: true },
                )
              }
            />
            <p className="mt-1 text-xs text-ink-500">{fileHint}</p>
            {jdFile !== null && (
              <p className="mt-2 text-xs font-medium text-ink-800">
                Attached: {jdFile.name}{" "}
                <span className="font-normal text-ink-500">({describeFileSize(jdFile.size)})</span>
              </p>
            )}
          </>
        )}
      </Labelled>
    </>
  );
}

/**
 * The existing-company record a name refers to, matched the same way the
 * database matches it (case- and whitespace-insensitive). Exported because the
 * FORM owns the autofilling: the name can also arrive from a `?companyName=`
 * prefill, which never fires an input's change handler.
 */
export function findCompanyMatch<T extends { readonly name: string }>(
  name: string,
  companies: readonly T[],
): T | null {
  const key = name.trim().toLowerCase();
  if (key === "") return null;
  return companies.find((c) => c.name.trim().toLowerCase() === key) ?? null;
}

/**
 * Company identity: a datalist over the companies already on record. Typing a
 * known name shows its industry beside it, and the form fills industry,
 * website and companyId from that record — a second company profile for the
 * same recruiter is how drives stop being attributable to one employer.
 */
export function CompanyNameField<T extends FieldValues>({
  api,
  existingCompanies,
}: {
  api: PifFieldApi<T>;
  existingCompanies: readonly {
    readonly id?: string;
    readonly name: string;
    readonly industry?: string | null;
    readonly website?: string | null;
  }[];
}) {
  const companyNameValue = (useWatch({
    control: api.control,
    name: api.field("companyName") as never,
  }) ?? "") as unknown as string;

  const options = existingCompanies.map((c) => ({
    value: c.id ?? c.name,
    label: c.name,
    sublabel: c.industry ?? null,
  }));

  return (
    <Labelled label="Company name" required error={api.err("companyName")}>
      {(id) => (
        <Combobox
          id={id}
          name={api.field("companyName")}
          value={companyNameValue}
          options={options}
          placeholder="e.g. Zoho Corporation or search existing recruiter…"
          error={Boolean(api.err("companyName"))}
          allowCustom={true}
          onChange={(val) => {
            api.setValue(api.field("companyName") as never, val as never, {
              shouldValidate: true,
            });
          }}
        />
      )}
    </Labelled>
  );
}

/**
 * A4/A5 (UAT 2026-08-19): several contacts per drive, added with a "+", every
 * part optional. With none, the Central CPC is the point of contact — said
 * here, not assumed.
 */
export function ContactsEditor<T extends FieldValues>({
  api,
  description,
}: {
  api: PifFieldApi<T>;
  description: string;
}) {
  const contacts = useFieldArray({ control: api.control, name: api.field("contacts") as never });
  const watched = (useWatch({
    control: api.control,
    name: api.field("contacts") as never,
  }) ?? []) as unknown as readonly ContactRow[];
  const hasAnyContact = hasAnyContactIn(watched);

  return (
    <div className="sm:col-span-2 rounded-lg border border-line bg-surface-muted p-4">
      <p className="text-sm font-medium text-ink-900">Company contacts</p>
      <p className="mt-1 text-xs text-ink-700">{description}</p>

      {!hasAnyContact && (
        <p
          role="note"
          className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-ink-900"
        >
          No contact added — the <strong>Central Placement Coordinator</strong> will be the point of
          contact for this company.
        </p>
      )}

      {contacts.fields.map((field, index) => (
        <div
          key={field.id}
          className="mt-3 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2"
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
              className={controlClass}
              placeholder="e.g. Priya Sharma"
              {...api.register(`${api.field("contacts")}.${index}.name` as never)}
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
              className={controlClass}
              placeholder="e.g. Head of Talent Acquisition"
              {...api.register(`${api.field("contacts")}.${index}.designation` as never)}
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
              className={controlClass}
              placeholder="e.g. priya.sharma@company.com"
              {...api.register(`${api.field("contacts")}.${index}.email` as never)}
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
                className={controlClass}
                placeholder="e.g. +91 98765 43210"
                {...api.register(`${api.field("contacts")}.${index}.phone` as never)}
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
  );
}

/**
 * UAT 2026-08-21 item 2: an off-campus drive happens somewhere. The venue is
 * often NOT final at PIF time — "not yet confirmed" always submits, and the
 * Central CPC records the venue once the company confirms it (answer Q5).
 * A venue must never survive hidden on a mode that has none (the J2 lesson).
 */
export function VenueAndModeField<T extends FieldValues>({ api }: { api: PifFieldApi<T> }) {
  const driveMode = (useWatch({ control: api.control, name: api.field("driveMode") as never }) ??
    "") as unknown as string;
  const venueStatus = (useWatch({
    control: api.control,
    name: api.field("venueStatus") as never,
  }) ?? "not_yet_confirmed") as unknown as string;

  return (
    <>
      <Labelled label="Drive mode" error={api.err("driveMode")}>
        {(id) => (
          <select
            id={id}
            className={controlClass}
            {...api.register(api.field("driveMode") as never, {
              onChange: (e) => {
                // Moving between two venue-bearing modes keeps the venue — it
                // may be the one the targeted event already confirmed.
                if (!driveVenueApplies((e.target as HTMLSelectElement).value as DriveMode | "")) {
                  api.setValue(api.field("venueStatus") as never, "not_yet_confirmed" as never);
                  api.setValue(api.field("venue") as never, "" as never);
                }
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
      {driveVenueApplies(driveMode as DriveMode | "") && (
        <div className="sm:col-span-2">
          <RadioGroup
            legend="Venue"
            name={api.field("venueStatus")}
            value={venueStatus}
            options={[
              { value: "not_yet_confirmed", label: "Venue not yet confirmed" },
              { value: "confirmed", label: "Venue confirmed" },
            ]}
            error={api.err("venueStatus")}
            onChange={(next) => {
              api.setValue(api.field("venueStatus") as never, next as never, {
                shouldValidate: true,
              });
              // The J2 lesson again: an abandoned venue does not linger.
              if (next !== "confirmed") api.setValue(api.field("venue") as never, "" as never);
            }}
          />
          {venueStatus === "confirmed" && (
            <div className="mt-3 border-l-[3px] border-violet-400 bg-violet-400/5 py-3 pl-4 pr-3">
              <Labelled label="Venue" error={api.err("venue")}>
                {(id) => (
                  <input
                    id={id}
                    className={controlClass}
                    placeholder="e.g. HCL Campus, Sholinganallur, Chennai"
                    {...api.register(api.field("venue") as never)}
                  />
                )}
              </Labelled>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * J3 (2026-08-18): a radio for immediate/later, not prose. One comment box
 * PER OPTION (answer 6) — switching the radio drops the other, because a note
 * about joining next July left on a drive that says immediate is worse than no
 * note at all.
 *
 * The multi-role form raises the CHOICE at event level (`withComments={false}`)
 * and lets each role card hold its own comment for the chosen option.
 */
export function JoiningTimelineField<T extends FieldValues>({
  api,
  withComments = true,
  hint,
}: {
  api: PifFieldApi<T>;
  withComments?: boolean;
  hint?: string;
}) {
  const joiningTimeline = (useWatch({
    control: api.control,
    name: api.field("joiningTimeline") as never,
  }) ?? "") as unknown as string;

  return (
    <div className="sm:col-span-2">
      <RadioGroup
        legend="Offer rollout and joining"
        required
        name={api.field("joiningTimeline")}
        value={joiningTimeline}
        options={JOINING_TIMELINES.map((t) => ({ value: t, label: joiningLabel(t) }))}
        error={api.err("joiningTimeline")}
        onChange={(next) => {
          api.setValue(api.field("joiningTimeline") as never, next as never, {
            shouldValidate: true,
          });
          if (withComments) {
            api.setValue(
              api.field(
                next === "immediate" ? "joiningLaterNotes" : "joiningImmediateNotes",
              ) as never,
              "" as never,
            );
          }
        }}
      />
      {withComments && joiningTimeline !== "" && (
        <div className="mt-3 border-l-[3px] border-violet-400 bg-violet-400/5 py-3 pl-4 pr-3">
          <JoiningCommentBox
            api={api}
            which={joiningTimeline === "immediate" ? "immediate" : "later"}
          />
        </div>
      )}
      {hint !== undefined && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/** The comment box for one joining option — the event's choice, the role's words. */
export function JoiningCommentBox<T extends FieldValues>({
  api,
  which,
  wide = false,
}: {
  api: PifFieldApi<T>;
  which: "immediate" | "later";
  wide?: boolean;
}) {
  return which === "immediate" ? (
    <Labelled
      label="Comments on immediate joining"
      error={api.err("joiningImmediateNotes")}
      wide={wide}
    >
      {(id) => (
        <textarea
          id={id}
          rows={2}
          className={controlClass}
          placeholder="Optional — e.g. onboarding within 30 days of the offer."
          {...api.register(api.field("joiningImmediateNotes") as never)}
        />
      )}
    </Labelled>
  ) : (
    <Labelled label="Comments on joining later" error={api.err("joiningLaterNotes")} wide={wide}>
      {(id) => (
        <textarea
          id={id}
          rows={2}
          className={controlClass}
          placeholder="Optional — e.g. offers in Nov 2026, joining from July 2027."
          {...api.register(api.field("joiningLaterNotes") as never)}
        />
      )}
    </Labelled>
  );
}
