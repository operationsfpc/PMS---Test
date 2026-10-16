import { ToastContainer, useToast } from "@components/toast";
import { Badge, Button, Card, PageHeader } from "@components/ui";
import { ROLE_CATEGORIES } from "@domain/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { type FieldErrors, useFieldArray } from "react-hook-form";
import { control, Labelled, numeric, Section, SectionNav } from "./pif-controls";
import { extractPifValidationIssues } from "./pif-diagnostics";
import {
  CompanyNameField,
  ContactsEditor,
  DesignationsEditor,
  DriveTypeAndCompensationField,
  EligibilityFields,
  findCompanyMatch,
  JobDescriptionField,
  JoiningCommentBox,
  JoiningTimelineField,
  type PifFieldApi,
  RoundsEditor,
  ShiftField,
  SkillsPicker,
  scopedPifFieldApi,
  VenueAndModeField,
} from "./pif-fields";
import {
  type ContactRow,
  contactSignature,
  DRIVE_MODE_LABELS,
  EVENT_STATUS_LABELS,
  hasAnyContactIn,
  PIF_SECTIONS,
  ROLE_CATEGORY_LABELS,
  ROLES_SECTION,
} from "./pif-labels";
import type { ExistingDriveEvent } from "./pif-repository";
import {
  DEFAULT_ROLE_VALUES,
  type MultiRolePifValues,
  multiRolePifDraftSchema,
  multiRolePifSubmitSchema,
  type PifFormValues,
  type PifRoleValues,
  toSinglePifValues,
} from "./pif-schema";
import { usePifIntent } from "./use-pif-intent";

/**
 * The AE's Position Information Form — the only one there is.
 *
 * One PIF is one company visit. The company and the day are stated once at the
 * top, and the roles raised under that visit each get an identical block added
 * with "+ Add another role". A visit with ONE role is still saved as a plain
 * drive; two or more go through the atomic `save_company_drive_with_roles` RPC,
 * so the visit and its roles commit or fail together and a half-raised event
 * with roles missing cannot exist.
 *
 * Offer category is deliberately absent: §3.3 gives it to the Delivery Head at
 * approval and makes it immutable, so the AE must not be able to propose it.
 * Draft and submit validate differently — a draft may be half-finished, but
 * submitting hands the PIF to an approver and must be complete.
 */

const UNIFIED_DEFAULTS = {
  companyId: "",
  companyDriveId: "",
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

/** The three event fields the company record can answer for the AE. */
const AUTO_FILLED = ["industry", "companyWebsite", "companyId"] as const;
type AutoFilledKey = (typeof AUTO_FILLED)[number];

/**
 * One role's block. Every field group is the SAME component the drive has
 * always asked for, scoped to `roles.N` — so a second role is not a second
 * class of form, and the two can never drift apart.
 */
function RoleBlock({
  index,
  count,
  api,
  errors,
  onRemove,
  skillAreas,
  joiningTimeline,
}: {
  index: number;
  /** Removing the only role would leave a drive with nothing on it. */
  count: number;
  api: PifFieldApi<MultiRolePifValues>;
  errors: FieldErrors<MultiRolePifValues>;
  onRemove: () => void;
  skillAreas: readonly string[];
  /** The DRIVE-level joining choice — each role keeps its own comment for it. */
  joiningTimeline: string;
}) {
  const roleApi = scopedPifFieldApi<MultiRolePifValues>(
    api,
    `roles.${index}`,
    errors.roles?.[index],
  );
  const number = PIF_SECTIONS.length + index + 1;

  return (
    <Section
      number={number}
      title={`Role ${index + 1}`}
      id={`role-${index}`}
      action={
        count > 1 ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            aria-label={`Remove role ${index + 1}`}
            onClick={onRemove}
          >
            Remove role
          </Button>
        ) : undefined
      }
    >
      {/* A1: the type is the first question of the block — it decides which
          compensation exists for THIS role, and a visit may hire an internship
          and a placement side by side. */}
      <DriveTypeAndCompensationField api={roleApi} />

      <Labelled label="Role title" required error={roleApi.err("roleTitle")}>
        {(id) => (
          <input
            id={id}
            placeholder="e.g. Associate Software Engineer"
            className={control}
            {...roleApi.register(roleApi.field("roleTitle") as never)}
          />
        )}
      </Labelled>
      <DesignationsEditor
        api={roleApi}
        heading="One interview process, however many designations — one role."
        detail="A designation with its own interview process needs its own role below — the visit is shared, the process is not. Two roles for one process would double the shortlist and the audience count."
      />
      <Labelled label="Role category" required error={roleApi.err("roleCategory")}>
        {(id) => (
          <select
            id={id}
            className={control}
            {...roleApi.register(roleApi.field("roleCategory") as never)}
          >
            <option value="">Select…</option>
            {ROLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {ROLE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        )}
      </Labelled>
      <Labelled label="Number of openings" required error={roleApi.err("openings")}>
        {(id) => (
          <input
            id={id}
            type="number"
            placeholder="e.g. 10"
            className={control}
            {...roleApi.register(roleApi.field("openings") as never, numeric)}
          />
        )}
      </Labelled>
      <Labelled label="Work location(s)" required error={roleApi.err("workLocations")}>
        {(id) => (
          <input
            id={id}
            placeholder="e.g. Chennai / Bangalore / Hybrid"
            className={control}
            {...roleApi.register(roleApi.field("workLocations") as never)}
          />
        )}
      </Labelled>
      <JobDescriptionField
        api={roleApi}
        fileHint="PDF only, up to 5 MB. Visible to the Delivery Head approving the drive and to the students it is published to."
      />
      <ShiftField api={roleApi} />
      <Labelled label="Bond / service agreement" error={roleApi.err("bondDetails")}>
        {(id) => (
          <input
            id={id}
            placeholder="e.g. 1 year service agreement or None"
            className={control}
            {...roleApi.register(roleApi.field("bondDetails") as never)}
          />
        )}
      </Labelled>

      <EligibilityFields api={roleApi} />
      <SkillsPicker
        skillAreas={skillAreas}
        onChange={(joined) =>
          roleApi.setValue(roleApi.field("mandatorySkills") as never, joined as never)
        }
      />

      <RoundsEditor api={roleApi} />

      {/* The choice belongs to the drive; each role keeps its own words for the
          option the drive chose. */}
      {joiningTimeline === "immediate" && (
        <JoiningCommentBox api={roleApi} which="immediate" wide />
      )}
      {joiningTimeline === "later" && <JoiningCommentBox api={roleApi} which="later" wide />}
    </Section>
  );
}

export function PifForm({
  onSubmit,
  onSaveDraft,
  skillAreas = [],
  initialValues,
  existingCompanies = [],
  getCompanyEvents,
}: {
  /**
   * One role → a flat `PifFormValues` drive. Two or more → the grouped values,
   * which the page sends to the event RPC. The form decides which it is; the
   * page only has to know where to write it.
   */
  onSubmit: (values: PifFormValues | MultiRolePifValues) => Promise<void>;
  onSaveDraft: (values: PifFormValues | MultiRolePifValues) => Promise<void>;
  /** The assessed-skills catalogue — the ONLY skills the AE may pick. */
  skillAreas?: readonly string[];
  initialValues?: Partial<MultiRolePifValues>;
  existingCompanies?: readonly {
    readonly id?: string;
    readonly name: string;
    readonly industry?: string | null;
    readonly website?: string | null;
  }[];
  getCompanyEvents?: (companyName: string) => Promise<readonly ExistingDriveEvent[]>;
}) {
  const [seed] = useState(() => ({ ...UNIFIED_DEFAULTS, ...initialValues }));
  const { toasts, toast, dismiss } = useToast();

  const { form, run, failure } = usePifIntent<MultiRolePifValues>({
    schemaFor: (mode) => (mode === "draft" ? multiRolePifDraftSchema : multiRolePifSubmitSchema),
    defaultValues: seed,
    onInvalid: (mode, validationErrors) => {
      const issues = extractPifValidationIssues(validationErrors);
      const title =
        mode === "submit"
          ? "Please resolve the following issues before submitting:"
          : "Draft cannot be saved:";
      toast({
        title,
        description: issues.length > 0 ? `${issues.length} field(s) require attention:` : undefined,
        issues,
        tone: "danger",
        duration: 9000,
      });

      if (typeof document !== "undefined") {
        setTimeout(() => {
          const firstInvalid = document.querySelector<HTMLElement>(
            '[aria-invalid="true"], [role="alert"], input:invalid, select:invalid, textarea:invalid',
          );
          if (firstInvalid) {
            if (typeof firstInvalid.scrollIntoView === "function") {
              firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            firstInvalid.focus?.();
          }
        }, 50);
      }
    },
    onCommit: (mode, values) => {
      const commit = mode === "draft" ? onSaveDraft : onSubmit;
      const roleList = values.roles ?? [];
      const onlyRole = roleList.length === 1 ? roleList[0] : undefined;
      if (onlyRole === undefined) {
        // Several roles: the visit IS the event. A date the AE picked in the
        // selector becomes the event these roles are added to.
        const event =
          values.companyDriveId && values.companyDriveId.trim() !== ""
            ? { ...values, id: values.companyDriveId.trim() }
            : values;
        return commit(event);
      }
      return commit(toSinglePifValues(values, onlyRole));
    },
    failureFallback: "Could not save the PIF.",
  });

  const {
    register,
    control: formControl,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const api: PifFieldApi<MultiRolePifValues> = {
    field: (name) => name,
    register,
    setValue,
    control: formControl,
    err: (key) =>
      (errors as unknown as Record<string, { message?: string } | undefined>)[key]?.message,
  };

  const roles = useFieldArray({ control: formControl, name: "roles" as never });
  const watchedCompanyName = watch("companyName") ?? "";
  const watchedRoles = (watch("roles") ?? []) as PifRoleValues[];
  /** The drive-level joining choice, read live so every role block follows it. */
  const joiningTimeline = (watch("joiningTimeline") ?? "") as string;

  const [eventsForCompany, setEventsForCompany] = useState<readonly ExistingDriveEvent[]>([]);
  const [selectedEventIdState, setSelectedEventIdState] = useState<string | null>(
    initialValues?.companyDriveId ?? null,
  );
  /** Mirror of `selectedEventId` so effects can read it without re-firing on it. */
  const selectedEventIdRef = useRef<string | null>(selectedEventIdState);
  const setSelectedEventId = useCallback((next: string | null) => {
    selectedEventIdRef.current = next;
    setSelectedEventIdState(next);
  }, []);
  const selectedEventId = selectedEventIdState;

  /**
   * Contacts that rode in with a selected event, as a signature. Selecting an
   * event must never clobber contacts the AE typed; and contacts inherited
   * from one event must not survive a switch to a NEW event, where they would
   * name the wrong company's people.
   */
  const autoContactSignatureRef = useRef<string | null>(null);
  /** The event whose defaults were auto-applied from the URL prefill, once. */
  const appliedEventRef = useRef<string | null>(null);
  /** What the company autofill wrote, so a re-match replaces its OWN values. */
  const autoFilledRef = useRef<Record<AutoFilledKey, string | undefined>>({
    industry: undefined,
    companyWebsite: undefined,
    companyId: undefined,
  });
  const [arrivedWithCompany, setArrivedWithCompany] = useState(
    () => (initialValues?.companyName ?? "").trim() !== "",
  );

  const matchedCompany = findCompanyMatch(watchedCompanyName, existingCompanies);

  /**
   * An existing company answers what it already knows — industry, website and
   * its id — so the AE does not retype it and the drive lands on the company's
   * existing profile.
   *
   * It is driven by the NAME, not by the input's change event, because the name
   * also arrives from a `?companyName=` prefill and from picking a datalist
   * entry. And it overwrites only what it filled itself: an AE who typed an
   * industry by hand gets to keep it.
   */
  useEffect(() => {
    const wanted: Record<AutoFilledKey, string> = {
      industry: matchedCompany?.industry ?? "",
      companyWebsite: matchedCompany?.website ?? "",
      companyId: matchedCompany?.id ?? "",
    };
    for (const key of AUTO_FILLED) {
      const current = (getValues(key) ?? "") as string;
      // A field the AE answered is theirs, whatever the record says.
      if (current !== "" && current !== autoFilledRef.current[key]) continue;
      if (current === wanted[key]) {
        autoFilledRef.current[key] = current === "" ? undefined : current;
        continue;
      }
      setValue(key, wanted[key]);
      autoFilledRef.current[key] = wanted[key] === "" ? undefined : wanted[key];
    }
  }, [matchedCompany, getValues, setValue]);

  /**
   * `0051` refuses a comment for the joining option the drive did not choose,
   * and the atomic event save would fail WHOLE over it. So an abandoned comment
   * is dropped from every role block, not merely hidden — a hidden field still
   * submits.
   */
  useEffect(() => {
    (getValues("roles") ?? []).forEach((role, index) => {
      if (joiningTimeline !== "immediate" && (role.joiningImmediateNotes ?? "") !== "") {
        setValue(`roles.${index}.joiningImmediateNotes` as never, "" as never);
      }
      if (joiningTimeline !== "later" && (role.joiningLaterNotes ?? "") !== "") {
        setValue(`roles.${index}.joiningLaterNotes` as never, "" as never);
      }
    });
  }, [joiningTimeline, getValues, setValue]);

  /**
   * Copies the targeted event's identity — date, mode, venue, contacts — onto
   * the form. The contacts rule: fill an empty form, replace an inherited set,
   * never touch a set the AE typed.
   */
  const applyEventDefaults = useCallback(
    (evt: ExistingDriveEvent) => {
      if (evt.tentativeDate) setValue("tentativeDate", evt.tentativeDate);
      if (evt.driveMode) {
        setValue("driveMode", evt.driveMode as MultiRolePifValues["driveMode"]);
        if (evt.venue) {
          setValue("venue", evt.venue);
          setValue("venueStatus", "confirmed");
        }
      }
      const incoming: ContactRow[] = (evt.contacts ?? []).map((c) => ({
        name: c.name ?? "",
        designation: c.designation ?? "",
        email: c.email ?? "",
        phone: c.phone ?? "",
      }));
      const current = getValues("contacts") as ContactRow[] | undefined;
      const inherited = contactSignature(current) === autoContactSignatureRef.current;
      if (!hasAnyContactIn(current) || inherited) {
        setValue("contacts", incoming);
        autoContactSignatureRef.current = incoming.length > 0 ? contactSignature(incoming) : null;
      }
    },
    [getValues, setValue],
  );

  useEffect(() => {
    let active = true;
    if (getCompanyEvents && watchedCompanyName.trim().length >= 2) {
      void getCompanyEvents(watchedCompanyName.trim()).then((events) => {
        if (!active) return;
        setEventsForCompany(events);
        if (initialValues?.companyDriveId) {
          const found = events.find((e) => e.id === initialValues.companyDriveId);
          if (found) {
            setSelectedEventId(found.id);
            // Applied once per event: a refetch (the name re-typed) must not
            // clobber what the AE edited since.
            if (appliedEventRef.current !== found.id) {
              appliedEventRef.current = found.id;
              applyEventDefaults(found);
            }
            return;
          }
        }
        // The name moved to a different company: a selection made under the
        // previous one must not ride along and attach this drive to its event.
        const previous = selectedEventIdRef.current;
        if (previous !== null && previous !== "new" && !events.some((e) => e.id === previous)) {
          setSelectedEventId(null);
          setValue("companyDriveId", "");
          const current = getValues("contacts") as ContactRow[] | undefined;
          if (
            autoContactSignatureRef.current !== null &&
            contactSignature(current) === autoContactSignatureRef.current
          ) {
            setValue("contacts", []);
            autoContactSignatureRef.current = null;
          }
        }
      });
    } else {
      setEventsForCompany([]);
    }
    return () => {
      active = false;
    };
  }, [
    getCompanyEvents,
    watchedCompanyName,
    initialValues?.companyDriveId,
    applyEventDefaults,
    setSelectedEventId,
    getValues,
    setValue,
  ]);

  const selectedEvent =
    selectedEventId !== null && selectedEventId !== "new"
      ? (eventsForCompany.find((e) => e.id === selectedEventId) ?? null)
      : null;

  const [companySection, eventSection] = PIF_SECTIONS;
  const roleCount = roles.fields.length;
  /** The array-level complaint ("add at least one role") lives on `.root`. */
  const rolesError =
    (errors.roles as unknown as { root?: { message?: string }; message?: string } | undefined)?.root
      ?.message ?? (errors.roles as unknown as { message?: string } | undefined)?.message;
  const namedRoles = watchedRoles
    .map((role) => (role.roleTitle ?? "").trim())
    .filter((title) => title !== "");

  function clearCompany() {
    setValue("companyName", "", { shouldValidate: true });
    setValue("companyDriveId", "");
    setArrivedWithCompany(false);
  }

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

        <SectionNav
          label="PIF sections"
          items={[
            ...PIF_SECTIONS.map((section, index) => ({
              id: section.id,
              label: section.short,
              number: index + 1,
            })),
            ...roles.fields.map((_, index) => ({
              id: `role-${index}`,
              label: `Role ${index + 1}`,
              number: PIF_SECTIONS.length + index + 1,
            })),
          ]}
        />

        <Section number={1} title={companySection.title} id={companySection.id}>
          {(arrivedWithCompany || matchedCompany !== null) && (
            <div className="sm:col-span-2 rounded-lg border border-brand-200 bg-brand-50 p-3.5 text-xs text-brand-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    Existing Company
                  </span>
                  <span className="font-semibold text-brand-900">
                    Adding a drive for {watchedCompanyName || matchedCompany?.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearCompany}
                  className="font-medium text-brand-700 underline hover:text-brand-900"
                >
                  Clear to create for another company
                </button>
              </div>
              <p className="mt-1 text-ink-600">
                Industry, website and contacts come from this company's existing profile.
              </p>
            </div>
          )}

          <CompanyNameField api={api} existingCompanies={existingCompanies} />
          <Labelled label="Industry / domain" error={api.err("industry")}>
            {(id) => <input id={id} className={control} {...register("industry")} />}
          </Labelled>
          <Labelled label="Company website" error={api.err("companyWebsite")}>
            {(id) => <input id={id} className={control} {...register("companyWebsite")} />}
          </Labelled>

          {/* A4/A5 (UAT 2026-08-19): several contacts, all optional. With none,
              the Central CPC is the point of contact — said here, not assumed. */}
          <ContactsEditor
            api={api}
            description="Who the placement team reaches at the company. Shared by every role on this drive; all optional — add as many as you have."
          />
        </Section>

        <Section number={2} title={eventSection.title} id={eventSection.id}>
          {eventsForCompany.length > 0 && (
            <div className="sm:col-span-2 rounded-xl border-2 border-brand-200 bg-brand-50/60 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-brand-900">
                    Recruitment Drive / Day for {watchedCompanyName}
                  </h3>
                  <p className="text-xs text-ink-600">
                    Select an already-created drive date to raise these roles on it, or schedule a
                    new drive date.
                  </p>
                </div>
                <span className="rounded-full border border-brand-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  {eventsForCompany.length} existing drive{eventsForCompany.length > 1 ? "s" : ""}
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {eventsForCompany.map((evt) => {
                  const isSelected = selectedEventId === evt.id;
                  return (
                    <label
                      key={evt.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                        isSelected
                          ? "border-brand-500 bg-white shadow-xs ring-1 ring-brand-500/20"
                          : "border-line bg-white/70 hover:bg-white"
                      }`}
                    >
                      <input
                        type="radio"
                        name="companyDriveEventSelector"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedEventId(evt.id);
                          setValue("companyDriveId", evt.id);
                          applyEventDefaults(evt);
                        }}
                        className="mt-1 size-4 accent-[#3D3777]"
                      />
                      <div className="flex-1 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-ink-900">
                            Drive Date:{" "}
                            {evt.tentativeDate ? evt.tentativeDate : "Date to be announced"}
                          </span>
                          <Badge tone={EVENT_STATUS_LABELS[evt.status]?.tone ?? "neutral"}>
                            {EVENT_STATUS_LABELS[evt.status]?.label ?? evt.status}
                          </Badge>
                          {evt.driveMode && (
                            <span className="text-ink-500 capitalize">
                              · {evt.driveMode.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                        {evt.existingRoles.length > 0 && (
                          <p className="mt-1 text-ink-700">
                            <strong>Existing role(s) in this drive:</strong>{" "}
                            {evt.existingRoles.join(", ")}
                          </p>
                        )}
                        {evt.venue && <p className="mt-0.5 text-ink-500">Venue: {evt.venue}</p>}
                      </div>
                    </label>
                  );
                })}

                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    selectedEventId === "new"
                      ? "border-brand-500 bg-white shadow-xs ring-1 ring-brand-500/20"
                      : "border-line bg-white/70 hover:bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="companyDriveEventSelector"
                    checked={selectedEventId === "new"}
                    onChange={() => {
                      setSelectedEventId("new");
                      setValue("companyDriveId", "");
                      // A NEW event starts clean. Anything inherited from a
                      // previously selected event — its date, mode, venue and
                      // auto-filled contacts — is dropped here, because a
                      // hidden field still submits (the J2 lesson).
                      setValue("tentativeDate", "");
                      setValue("driveMode", "");
                      setValue("venueStatus", "not_yet_confirmed");
                      setValue("venue", "");
                      const current = getValues("contacts") as ContactRow[] | undefined;
                      if (
                        autoContactSignatureRef.current !== null &&
                        contactSignature(current) === autoContactSignatureRef.current
                      ) {
                        setValue("contacts", []);
                        autoContactSignatureRef.current = null;
                      }
                    }}
                    className="mt-1 size-4 accent-[#3D3777]"
                  />
                  <div className="flex-1 text-xs">
                    <span className="font-bold text-ink-900">
                      + Create a new drive event / date for {watchedCompanyName}
                    </span>
                    <p className="mt-0.5 text-ink-500">
                      Schedule a separate campus recruitment visit with its own date, mode, and
                      details.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          <VenueAndModeField api={api} />

          <Labelled label="Tentative drive date" error={api.err("tentativeDate")}>
            {(id) => (
              <input id={id} type="date" className={control} {...register("tentativeDate")} />
            )}
          </Labelled>

          <JoiningTimelineField
            api={api}
            withComments={false}
            hint="Each role below keeps its own comments for this choice."
          />

          <Labelled label="Timeline notes" error={api.err("timelineNotes")} wide>
            {(id) => (
              <textarea id={id} rows={2} className={control} {...register("timelineNotes")} />
            )}
          </Labelled>
        </Section>

        <section id={ROLES_SECTION.id} className="mb-4 scroll-mt-24">
          <h2 className="mb-1 font-[Raleway] text-lg font-bold text-[#3D3777]">
            {ROLES_SECTION.title}
          </h2>
          <p className="mb-3 text-sm text-ink-700">{ROLES_SECTION.detail}</p>

          {rolesError !== undefined && (
            <p role="alert" className="mb-3 text-xs font-medium text-danger-700">
              {rolesError}
            </p>
          )}

          {roles.fields.map((field, index) => (
            <RoleBlock
              key={field.id}
              index={index}
              count={roleCount}
              api={api}
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
        </section>

        {/*
         * The one fact a silent form hid: WHERE this drive will land. An AE
         * adding roles to an existing visit must see the target before they
         * press submit — a role attached to the wrong event is found only
         * after the fact, on someone else's screen.
         */}
        {watchedCompanyName.trim() !== "" && (
          <section
            aria-label="Where this drive will be saved"
            className="mb-4 rounded-card border border-brand-200 bg-brand-50 p-4 shadow-sm"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-brand-700">
              Where this drive goes
            </p>
            <p className="mt-1 text-sm text-ink-900">
              <strong>
                {namedRoles.length === 0
                  ? "Unnamed role"
                  : namedRoles.length === 1
                    ? namedRoles[0]
                    : `${namedRoles.length} roles — ${namedRoles.join(", ")}`}
              </strong>{" "}
              → {selectedEvent !== null ? "existing drive" : "new drive event"} for{" "}
              <strong>{watchedCompanyName}</strong>
              {selectedEvent !== null && (
                <>
                  {" · "}
                  {selectedEvent.tentativeDate ?? "date to be announced"}
                  {selectedEvent.driveMode
                    ? ` · ${DRIVE_MODE_LABELS[selectedEvent.driveMode] ?? selectedEvent.driveMode.replace(/_/g, " ")}`
                    : ""}
                </>
              )}
            </p>
            {selectedEvent !== null && selectedEvent.existingRoles.length > 0 && (
              <p className="mt-1 text-xs text-ink-700">
                Already in this drive: {selectedEvent.existingRoles.join(", ")}
              </p>
            )}
          </section>
        )}

        <div className="flex flex-wrap gap-3 pb-10">
          <Button type="button" disabled={isSubmitting} onClick={run("submit")}>
            {isSubmitting ? "Working…" : "Submit for approval"}
          </Button>
          <Button type="button" variant="secondary" disabled={isSubmitting} onClick={run("draft")}>
            Save draft
          </Button>
        </div>
      </form>

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
