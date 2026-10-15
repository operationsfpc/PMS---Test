import { Button, Card, PageHeader } from "@components/ui";
import { describeFileSize } from "@domain/attachments";
import { driveVenueApplies } from "@domain/drive-venue";
import { JOINING_TIMELINES, joiningLabel } from "@domain/joining";
import { MARKS_SCALES } from "@domain/marks";
import { SHIFT_TYPES, shiftLabel } from "@domain/shift";
import { joinMandatorySkills, normaliseSkillAreaName, skillAreaKey } from "@domain/skills";
import { ARREAR_POLICIES, DRIVE_MODES, DRIVE_TYPES, ROLE_CATEGORIES } from "@domain/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useRef, useState } from "react";
import {
  type Control,
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import {
  ARREAR_LABELS,
  control as controlClass,
  DRIVE_MODE_LABELS,
  DRIVE_TYPE_LABELS,
  hasAnyContactIn,
  Labelled,
  PASSING_YEARS,
  RadioGroup,
  ROLE_CATEGORY_LABELS,
  SCALE_LABELS,
  Section,
} from "./pif-form";
import {
  DEFAULT_ROLE_VALUES,
  type MultiRolePifValues,
  multiRolePifDraftSchema,
  multiRolePifSubmitSchema,
} from "./pif-schema";

/**
 * The multi-role PIF: ONE recruitment event, SEVERAL roles raised together.
 *
 * Where the single-role PIF attaches its one role to an event the AE picks
 * (or creates), this form IS the event — company, date, mode, contacts — with
 * each role's specifics nested beneath it. It rides the atomic
 * `save_company_drive_with_roles` RPC, so the event and every role commit or
 * fail together: no half-raised drive with roles missing.
 *
 * Offer category is absent, as everywhere the AE writes: §3.3 gives it to the
 * Delivery Head at approval.
 */

/** An untouched optional number is NOT zero (the Number(null) lesson). */
const numeric = {
  setValueAs: (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v)),
};

const MULTI_DEFAULTS = {
  companyId: "",
  companyName: "",
  industry: "",
  companyWebsite: "",
  contacts: [] as Array<{ name: string; designation: string; email: string; phone: string }>,
  driveMode: "" as const,
  venueStatus: "not_yet_confirmed" as "not_yet_confirmed" | "confirmed",
  venue: "",
  tentativeDate: "",
  timelineNotes: "",
  joiningTimeline: "" as const,
  roles: [{ ...DEFAULT_ROLE_VALUES }] as MultiRolePifValues["roles"],
};

/** The per-role skills picker, with its own picked/other state per role card. */
function RoleSkillsPicker({
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
 * One role's card. Its hooks (watch, field arrays) live here so each card
 * owns its own conditional compensation fields, designations and rounds.
 */
function RoleCard({
  index,
  register,
  control,
  setValue,
  errors,
  onRemove,
  skillAreas,
  joiningTimeline,
}: {
  index: number;
  register: UseFormRegister<MultiRolePifValues>;
  control: Control<MultiRolePifValues>;
  setValue: UseFormSetValue<MultiRolePifValues>;
  errors: FieldErrors<MultiRolePifValues>;
  onRemove: () => void;
  skillAreas: readonly string[];
  /** The EVENT-level joining choice — each role's comment follows it. */
  joiningTimeline: string;
}) {
  const path = `roles.${index}` as const;
  const driveType = (useWatch({ control, name: `${path}.driveType` as never }) ?? "") as string;
  const shiftType = (useWatch({ control, name: `${path}.shiftType` as never }) ?? "") as string;
  const rounds = (useWatch({ control, name: `${path}.rounds` as never }) ?? []) as Array<{
    sequence: number;
    name: string;
  }>;
  const jdFile = (useWatch({ control, name: `${path}.jobDescriptionFile` as never }) ??
    null) as File | null;

  const designations = useFieldArray({
    control,
    name: `${path}.additionalDesignations` as never,
  });

  const roleErrors = (errors.roles?.[index] ?? {}) as unknown as Record<
    string,
    { message?: string } | undefined
  >;
  const err = (k: string) => roleErrors[k]?.message as string | undefined;

  const wantsCtc = driveType === "placement" || driveType === "internship_convertible";
  const wantsStipend = driveType === "internship" || driveType === "internship_convertible";

  return (
    <Card className="mb-4 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-[Raleway] text-lg font-bold text-[#3D3777]">Role {index + 1}</h3>
        <Button
          type="button"
          variant="danger"
          size="sm"
          aria-label={`Remove role ${index + 1}`}
          onClick={onRemove}
        >
          Remove role
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Labelled label="Role title" required error={err("roleTitle")}>
          {(id) => (
            <input id={id} className={controlClass} {...register(`${path}.roleTitle` as never)} />
          )}
        </Labelled>
        <Labelled label="Role category" required error={err("roleCategory")}>
          {(id) => (
            <select id={id} className={controlClass} {...register(`${path}.roleCategory` as never)}>
              <option value="">Select…</option>
              {ROLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ROLE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </Labelled>

        {/* A1: the type decides which compensation exists for THIS role. */}
        <div className="sm:col-span-2">
          <RadioGroup
            legend="Drive type"
            required
            name={`role-drive-type-${index}`}
            value={driveType}
            options={DRIVE_TYPES.map((t) => ({ value: t, label: DRIVE_TYPE_LABELS[t] ?? t }))}
            error={err("driveType")}
            onChange={(next) => {
              setValue(`${path}.driveType` as never, next as never, { shouldValidate: true });
              // Compensation the new type does not have is cleared, not hidden.
              if (next === "placement") {
                setValue(`${path}.stipendMinMonthly` as never, null as never);
                setValue(`${path}.stipendMaxMonthly` as never, null as never);
              }
              if (next === "internship") {
                setValue(`${path}.ctcMinLpa` as never, null as never);
                setValue(`${path}.ctcMaxLpa` as never, null as never);
                setValue(`${path}.ctcBreakup` as never, "" as never);
              }
            }}
          />
        </div>

        {wantsStipend && (
          <>
            <Labelled label="Stipend minimum (₹ / month)" required error={err("stipendMinMonthly")}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  className={controlClass}
                  {...register(`${path}.stipendMinMonthly` as never, numeric)}
                />
              )}
            </Labelled>
            <Labelled label="Stipend maximum (₹ / month)" error={err("stipendMaxMonthly")}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  className={controlClass}
                  {...register(`${path}.stipendMaxMonthly` as never, numeric)}
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
                  className={controlClass}
                  {...register(`${path}.ctcMinLpa` as never, numeric)}
                />
              )}
            </Labelled>
            <Labelled label="Maximum CTC (LPA)" error={err("ctcMaxLpa")}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  step="0.01"
                  className={controlClass}
                  {...register(`${path}.ctcMaxLpa` as never, numeric)}
                />
              )}
            </Labelled>
            <Labelled label="CTC breakup (fixed / variable)" error={err("ctcBreakup")} wide>
              {(id) => (
                <input
                  id={id}
                  className={controlClass}
                  {...register(`${path}.ctcBreakup` as never)}
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

        <Labelled label="Number of openings" required error={err("openings")}>
          {(id) => (
            <input
              id={id}
              type="number"
              className={controlClass}
              {...register(`${path}.openings` as never, numeric)}
            />
          )}
        </Labelled>
        <Labelled label="Work location(s)" required error={err("workLocations")}>
          {(id) => (
            <input
              id={id}
              className={controlClass}
              {...register(`${path}.workLocations` as never)}
            />
          )}
        </Labelled>
        <Labelled label="Job description" error={err("jobDescription")} wide>
          {(id) => (
            <>
              <textarea
                id={id}
                rows={4}
                className={controlClass}
                {...register(`${path}.jobDescription` as never)}
              />
              <p className="mt-1 text-xs text-ink-500">
                Optional. Shown on the student's drive card and in the recruiter export.
              </p>
            </>
          )}
        </Labelled>
        <Labelled label="Attach the job description (PDF)" error={err("jobDescriptionFile")} wide>
          {(id) => (
            <>
              <input
                id={id}
                type="file"
                accept="application/pdf,.pdf"
                className={`${control} file:mr-3 file:rounded-md file:border-0 file:bg-[#3D3777] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white`}
                onChange={(e) =>
                  setValue(
                    `${path}.jobDescriptionFile` as never,
                    (e.target.files?.[0] ?? null) as never,
                    { shouldValidate: true },
                  )
                }
              />
              <p className="mt-1 text-xs text-ink-500">PDF only, up to 5 MB.</p>
              {jdFile !== null && (
                <p className="mt-2 text-xs font-medium text-ink-800">
                  Attached: {jdFile.name}{" "}
                  <span className="font-normal text-ink-500">
                    ({describeFileSize(jdFile.size)})
                  </span>
                </p>
              )}
            </>
          )}
        </Labelled>

        <div className="sm:col-span-2">
          <RadioGroup
            legend="Shift"
            name={`role-shift-${index}`}
            value={shiftType}
            options={SHIFT_TYPES.map((s) => ({ value: s, label: shiftLabel(s) }))}
            error={err("shiftType")}
            onChange={(next) => {
              setValue(`${path}.shiftType` as never, next as never, { shouldValidate: true });
              if (next !== "night") setValue(`${path}.shiftNightTiming` as never, "" as never);
            }}
          />
          {shiftType === "night" && (
            <div className="mt-3 border-l-[3px] border-[#A46AFC] bg-[#A46AFC]/5 py-3 pl-4 pr-3">
              <Labelled label="Night shift timing" error={err("shiftNightTiming")}>
                {(id) => (
                  <input
                    id={id}
                    className={controlClass}
                    placeholder="9.00 pm – 6.00 am IST"
                    {...register(`${path}.shiftNightTiming` as never)}
                  />
                )}
              </Labelled>
            </div>
          )}
        </div>
        <Labelled label="Bond / service agreement" error={err("bondDetails")}>
          {(id) => (
            <input id={id} className={controlClass} {...register(`${path}.bondDetails` as never)} />
          )}
        </Labelled>

        <Labelled label="Cutoff scale" error={err("minOverallCgpaScale")}>
          {(id) => (
            <select
              id={id}
              className={controlClass}
              {...register(`${path}.minOverallCgpaScale` as never)}
            >
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
              className={controlClass}
              {...register(`${path}.minOverallCgpa` as never, numeric)}
            />
          )}
        </Labelled>
        <Labelled label="Arrear policy" error={err("arrearsPolicy")}>
          {(id) => (
            <select
              id={id}
              className={controlClass}
              {...register(`${path}.arrearsPolicy` as never)}
            >
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
              className={controlClass}
              {...register(`${path}.minTenthPercentage` as never, numeric)}
            />
          )}
        </Labelled>
        <Labelled label="Minimum 12th %" error={err("minTwelfthPercentage")}>
          {(id) => (
            <input
              id={id}
              type="number"
              step="0.01"
              className={controlClass}
              {...register(`${path}.minTwelfthPercentage` as never, numeric)}
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
                  {...register(`${path}.eligiblePassingYears` as never)}
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

        <RoleSkillsPicker
          skillAreas={skillAreas}
          onChange={(joined) => setValue(`${path}.mandatorySkills` as never, joined as never)}
        />

        <div className="sm:col-span-2 rounded-lg border border-line bg-surface-muted p-4">
          <p className="text-sm font-medium text-ink-900">
            One interview process, however many designations — one role.
          </p>
          {designations.fields.map((field, dIndex) => (
            <div key={field.id} className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <label
                  htmlFor={`role-${index}-designation-${dIndex}`}
                  className="mb-1 block text-xs font-medium text-ink-700"
                >
                  Designation {dIndex + 1}
                </label>
                <input
                  id={`role-${index}-designation-${dIndex}`}
                  className={controlClass}
                  {...register(`${path}.additionalDesignations.${dIndex}` as never)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove designation ${dIndex + 1}`}
                onClick={() => designations.remove(dIndex)}
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

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-ink-700">Rounds in the process *</p>
          <p className="mb-3 text-xs text-ink-500">
            In order — e.g. Round 1 Aptitude test, Round 2 Technical interview.
          </p>
          <div className="flex flex-col gap-2">
            {rounds.map((round, rIndex) => (
              <div key={round.sequence} className="flex flex-wrap items-end gap-2">
                <div className="min-w-56 flex-1">
                  <Labelled label={`Round ${round.sequence} name`}>
                    {(id) => (
                      <input
                        id={id}
                        className={controlClass}
                        value={round.name}
                        onChange={(e) =>
                          setValue(
                            `${path}.rounds` as never,
                            rounds.map((r, i) =>
                              i === rIndex ? { ...r, name: e.target.value } : r,
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
                    setValue(
                      `${path}.rounds` as never,
                      rounds
                        .filter((_, i) => i !== rIndex)
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
              setValue(
                `${path}.rounds` as never,
                [...rounds, { sequence: rounds.length + 1, name: "" }] as never,
                { shouldValidate: true },
              )
            }
          >
            Add round
          </Button>
          {err("rounds") !== undefined && (
            <p role="alert" className="mt-1 text-xs font-medium text-danger-700">
              {err("rounds")}
            </p>
          )}
        </div>

        {/* The joining CHOICE belongs to the event; each role keeps its own
            comment for the option the event chose. */}
        {joiningTimeline === "immediate" && (
          <Labelled label="Comments on immediate joining" error={err("joiningImmediateNotes")} wide>
            {(id) => (
              <textarea
                id={id}
                rows={2}
                className={controlClass}
                placeholder="Optional — e.g. onboarding within 30 days of the offer."
                {...register(`${path}.joiningImmediateNotes` as never)}
              />
            )}
          </Labelled>
        )}
        {joiningTimeline === "later" && (
          <Labelled label="Comments on joining later" error={err("joiningLaterNotes")} wide>
            {(id) => (
              <textarea
                id={id}
                rows={2}
                className={controlClass}
                placeholder="Optional — e.g. offers in Nov 2026, joining from July 2027."
                {...register(`${path}.joiningLaterNotes` as never)}
              />
            )}
          </Labelled>
        )}
      </div>
    </Card>
  );
}

export function PifMultiForm({
  onSubmit,
  onSaveDraft,
  skillAreas = [],
  existingCompanies = [],
}: {
  onSubmit: (values: MultiRolePifValues) => Promise<void>;
  onSaveDraft: (values: MultiRolePifValues) => Promise<void>;
  skillAreas?: readonly string[];
  existingCompanies?: readonly {
    readonly id?: string;
    readonly name: string;
    readonly industry?: string | null;
    readonly website?: string | null;
  }[];
}) {
  const intent = useRef<"draft" | "submit">("submit");
  const [failure, setFailure] = useState<string | null>(null);

  const {
    register,
    control: formControl,
    handleSubmit,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MultiRolePifValues>({
    defaultValues: MULTI_DEFAULTS,
    resolver: async (values, context, options) =>
      zodResolver(intent.current === "draft" ? multiRolePifDraftSchema : multiRolePifSubmitSchema)(
        values,
        context,
        options,
      ),
  });

  const roles = useFieldArray({ control: formControl, name: "roles" as never });
  const contacts = useFieldArray({ control: formControl, name: "contacts" as never });

  const driveMode = watch("driveMode") ?? "";
  const venueStatus = watch("venueStatus") ?? "not_yet_confirmed";
  const joiningTimeline = watch("joiningTimeline") ?? "";
  const hasAnyContact = hasAnyContactIn(watch("contacts"));

  const err = (k: keyof MultiRolePifValues) => errors[k]?.message as string | undefined;
  /** The array-level complaint ("add at least one role") lives on `.root`. */
  const rolesError =
    (errors.roles as unknown as { root?: { message?: string } } | undefined)?.root?.message ??
    (errors.roles as unknown as { message?: string } | undefined)?.message;

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
        const reason =
          cause instanceof Error && cause.message !== ""
            ? cause.message
            : "Could not save the drive.";
        setFailure(`${reason} Your entries are still here.`);
      }
    });
  };

  return (
    <>
      <PageHeader
        title="Multi-role company drive"
        subtitle="One recruitment event, several roles — raised together, approved together."
      />

      {failure !== null && (
        <Card className="mb-4 border border-[#DD4820] bg-[#FFF0EC] p-4">
          <p role="alert" className="text-sm text-[#DD4820]">
            {failure}
          </p>
        </Card>
      )}

      <form noValidate>
        <p className="mb-4 text-sm text-ink-700">
          Fields marked * are required to submit for approval. A draft can be saved at any point.
        </p>

        <Section title="Drive event">
          <Labelled label="Company name" required error={err("companyName")}>
            {(id) => (
              <div>
                <input
                  id={id}
                  className={controlClass}
                  {...register("companyName", {
                    onChange: (e) => {
                      const val = (e.target.value as string).trim();
                      const match = existingCompanies.find(
                        (c) => c.name.toLowerCase() === val.toLowerCase(),
                      );
                      if (match) {
                        if (match.industry && getValues("industry") === "") {
                          setValue("industry", match.industry);
                        }
                        if (match.website && getValues("companyWebsite") === "") {
                          setValue("companyWebsite", match.website);
                        }
                        if (match.id) {
                          setValue("companyId", match.id);
                        }
                      }
                    },
                  })}
                  list={`${id}-companies-list`}
                  autoComplete="off"
                />
                {existingCompanies.length > 0 && (
                  <datalist id={`${id}-companies-list`}>
                    {existingCompanies.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.industry ? `${c.name} (${c.industry})` : c.name}
                      </option>
                    ))}
                  </datalist>
                )}
              </div>
            )}
          </Labelled>
          <Labelled label="Industry / domain" error={err("industry")}>
            {(id) => <input id={id} className={controlClass} {...register("industry")} />}
          </Labelled>
          <Labelled label="Company website" error={err("companyWebsite")}>
            {(id) => <input id={id} className={controlClass} {...register("companyWebsite")} />}
          </Labelled>

          <Labelled label="Drive mode" error={err("driveMode")}>
            {(id) => (
              <select
                id={id}
                className={controlClass}
                {...register("driveMode", {
                  onChange: (e) => {
                    // The venue exists only where the mode has one (the J2 lesson).
                    if (!driveVenueApplies(e.target.value as "on_campus")) {
                      setValue("venueStatus", "not_yet_confirmed");
                      setValue("venue", "");
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
                  if (next !== "confirmed") setValue("venue", "");
                }}
              />
              {venueStatus === "confirmed" && (
                <div className="mt-3 border-l-[3px] border-[#A46AFC] bg-[#A46AFC]/5 py-3 pl-4 pr-3">
                  <Labelled label="Venue" error={err("venue")}>
                    {(id) => (
                      <input
                        id={id}
                        className={controlClass}
                        placeholder="e.g. HCL Campus, Sholinganallur, Chennai"
                        {...register("venue")}
                      />
                    )}
                  </Labelled>
                </div>
              )}
            </div>
          )}

          <Labelled label="Tentative drive date" error={err("tentativeDate")}>
            {(id) => (
              <input id={id} type="date" className={controlClass} {...register("tentativeDate")} />
            )}
          </Labelled>

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
              }}
            />
            <p className="mt-1 text-xs text-ink-500">
              Each role below keeps its own comments for this choice.
            </p>
          </div>

          <Labelled label="Timeline notes" error={err("timelineNotes")} wide>
            {(id) => (
              <textarea id={id} rows={2} className={controlClass} {...register("timelineNotes")} />
            )}
          </Labelled>

          <div className="sm:col-span-2 rounded-lg border border-line bg-surface-muted p-4">
            <p className="text-sm font-medium text-ink-900">Company contacts</p>
            <p className="mt-1 text-xs text-ink-700">
              Shared by every role in this event. All optional — add as many as you have.
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
                    className={controlClass}
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
                    className={controlClass}
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
                    className={controlClass}
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
                      className={controlClass}
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

        <div className="mb-4">
          <h2 className="mb-1 font-[Raleway] text-lg font-bold text-[#3D3777]">
            Roles under this event
          </h2>
          <p className="mb-3 text-sm text-ink-700">
            Every role shares the event above and is approved with it. Raise roles with SEPARATE
            interview processes on separate events.
          </p>
          {rolesError !== undefined && (
            <p role="alert" className="mb-3 text-xs font-medium text-danger-700">
              {rolesError}
            </p>
          )}
          {roles.fields.map((field, index) => (
            <RoleCard
              key={field.id}
              index={index}
              register={register}
              control={formControl}
              setValue={setValue}
              errors={errors}
              onRemove={() => roles.remove(index)}
              skillAreas={skillAreas}
              joiningTimeline={joiningTimeline}
            />
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => roles.append({ ...DEFAULT_ROLE_VALUES } as never)}
          >
            + Add another role
          </Button>
        </div>

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
