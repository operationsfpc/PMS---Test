import { Badge, Button, Card, PageHeader } from "@components/ui";
import { type DriveReadiness, missingBeforeGoLive } from "@domain/drive-lifecycle";
import type { EligibilityCriteria } from "@domain/eligibility";
import type { OfferCategory } from "@domain/offer-category";
import type { DriveStatus, DriveType, RoleCategory } from "@domain/types";
import type { StudentContext, VisibilityReason, VisibleDrive } from "@domain/visibility";
import { isDriveVisibleToStudent } from "@domain/visibility";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Central CPC — DAF creation and audience targeting. PRD §7.1, §6.2, §6.5.
 *
 * The live audience count is computed by running the REAL domain rules over the
 * cohort. Nothing here re-implements eligibility or the ladder, so what the
 * coordinator sees before publishing is exactly what students will get.
 *
 * Everything it runs those rules over now comes from the view: the drive, the
 * targeting options, and the students. It used to be a hardcoded cohort of
 * twelve invented people and four hardcoded chip lists, which meant the
 * audience number on screen had nothing to do with the roster.
 */

/** One student, as the domain needs them, plus enough to name them. */
export interface PublishCandidate extends StudentContext {
  readonly id: string;
  readonly name: string;
}

export interface TargetingOptions {
  readonly cities: readonly string[];
  readonly campuses: readonly string[];
  readonly degrees: readonly string[];
  readonly branches: readonly string[];
}

/** Whom the drive is already targeted at. Empty everywhere means "not yet". */
export type DriveTargeting = TargetingOptions;

export interface DriveRound {
  readonly sequence: number;
  readonly name: string;
}

export interface PublishDrive {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string | null;
  readonly subtitle: string;
  readonly status: DriveStatus;
  readonly driveType: DriveType | null;
  readonly offerCategory: OfferCategory | null;
  readonly roleCategory: RoleCategory | null;
  readonly jobDescription: string;
  readonly locations: readonly string[];
  readonly ctcMinLpa: number | null;
  readonly applicationStart: Date | null;
  readonly applicationEnd: Date | null;
  readonly onHold: boolean;
  readonly rounds: readonly DriveRound[];
  /**
   * The eligibility the AE declared and the Delivery Head approved. This
   * screen used to seed a hardcoded 7.0 and "no standing arrears" over the top
   * of both and then publish the invention, so what went live was never what
   * was approved. Null means the drive declares no cutoff - which is not the
   * same as a cutoff of zero.
   */
  readonly minOverallCgpa: number | null;
  /** The school bars, set here (2026-08-18). Null means the drive sets none. */
  readonly minTenthPercentage: number | null;
  readonly minTwelfthPercentage: number | null;
  readonly arrearPolicy: EligibilityCriteria["arrearPolicy"];
  readonly targeting: DriveTargeting;
  /**
   * How many rounds the AE said the recruiter runs (F11, UAT 2026-08-06).
   * Null when they never said. It seeds the list below and is then compared
   * against it — it is information, not a constraint.
   */
  readonly declaredRoundCount: number | null;
}

export interface PublishInput {
  readonly driveId: string;
  readonly cities: readonly string[];
  readonly campuses: readonly string[];
  readonly degrees: readonly string[];
  readonly branches: readonly string[];
  readonly minOverallCgpa: number | null;
  readonly minTenthPercentage: number | null;
  readonly minTwelfthPercentage: number | null;
  readonly arrearPolicy: EligibilityCriteria["arrearPolicy"];
  readonly openToAllOverride: boolean;
  readonly overrideReason: string | null;
  /** `datetime-local` values, or null when never set. */
  readonly applicationStart: string | null;
  readonly applicationEnd: string | null;
  readonly rounds: readonly DriveRound[];
}

export interface PublishView {
  load(): Promise<{
    drive: PublishDrive;
    options: TargetingOptions;
    cohort: readonly PublishCandidate[];
  }>;
  publish(input: PublishInput): Promise<void>;
}

/** A Date as a `datetime-local` value, in the browser's own zone. */
function toLocalInput(value: Date | null): string {
  if (value === null) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}`;
}

const EXCLUSION_LABEL: Record<Exclude<VisibilityReason, "visible">, string> = {
  srf_not_approved: "SRF not yet verified",
  opted_out: "Opted out of placements",
  disbarred: "Disbarred",
  not_eligible: "Does not meet eligibility",
  area_not_chosen: "Did not choose this area",
  internship_cap_consumed: "Internship cap already used",
  placed_at_equal_or_higher: "Placed at an equal or higher category",
};

function MultiSelect({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink-700">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <label
              key={o}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-line bg-surface text-ink-700 hover:border-brand-300"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => onToggle(o)}
              />
              {o}
            </label>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="mt-1 text-xs text-ink-300">No filter — all {label.toLowerCase()} included.</p>
      )}
    </fieldset>
  );
}

export function DafPublish({ view }: { view: PublishView }) {
  const [loaded, setLoaded] = useState<Awaited<ReturnType<PublishView["load"]>> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [cities, setCities] = useState<readonly string[]>([]);
  const [campuses, setCampuses] = useState<readonly string[]>([]);
  const [degrees, setDegrees] = useState<readonly string[]>([]);
  const [branches, setBranches] = useState<readonly string[]>([]);
  // Seeded from the drive in `load()`. There is no sensible default for either:
  // a hardcoded cutoff is a rule nobody approved, and it used to be published.
  const [minCgpa, setMinCgpa] = useState("");
  /**
   * The school bars (2026-08-18). The columns have existed since 0004 and
   * `evaluateEligibility` has always read them - nothing has ever been able to
   * SET them, so every drive has silently declared none.
   */
  const [minTenth, setMinTenth] = useState("");
  const [minTwelfth, setMinTwelfth] = useState("");
  const [arrearPolicy, setArrearPolicy] = useState<EligibilityCriteria["arrearPolicy"]>("flexible");
  const [openToAll, setOpenToAll] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [windowStart, setWindowStart] = useState("");
  /** N3: "there should also be a now click box." Stamped at publish, not here. */
  const [openNow, setOpenNow] = useState(false);
  const [windowEnd, setWindowEnd] = useState("");
  const [rounds, setRounds] = useState<readonly DriveRound[]>([]);
  const [roundName, setRoundName] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await view.load();
      setLoaded(next);
      // Seed the editors from whatever the drive already has, so an existing
      // window or round list is edited rather than silently replaced.
      // `?? ""` rather than a null check: a drive that has never been given a
      // bar must open on an empty box, and `String(undefined)` reaches the
      // audience as NaN - a cutoff nobody set, excluding everybody.
      setMinTenth(next.drive.minTenthPercentage?.toString() ?? "");
      setMinTwelfth(next.drive.minTwelfthPercentage?.toString() ?? "");
      setWindowStart(toLocalInput(next.drive.applicationStart));
      setWindowEnd(toLocalInput(next.drive.applicationEnd));
      /**
       * The same argument, for the eligibility the Delivery Head approved and
       * the targeting the drive already carries. Both were fetched and
       * discarded: the screen opened on an invented 7.0 cutoff with every chip
       * clear, and publishing wrote that over the approved criteria and
       * DELETED the link rows. An empty link table means "any", so re-
       * publishing a live drive silently opened it to the whole roster.
       */
      setMinCgpa(next.drive.minOverallCgpa === null ? "" : String(next.drive.minOverallCgpa));
      setArrearPolicy(next.drive.arrearPolicy);
      setCities([...next.drive.targeting.cities]);
      setCampuses([...next.drive.targeting.campuses]);
      setDegrees([...next.drive.targeting.degrees]);
      setBranches([...next.drive.targeting.branches]);
      /**
       * F11: seeded from what the AE declared, but ONLY when the coordinator
       * has named none themselves. Their names are the real work here; a
       * fetched count must never wipe them.
       */
      const declared = next.drive.declaredRoundCount;
      setRounds(
        next.drive.rounds.length > 0 || declared === null || declared <= 0
          ? next.drive.rounds
          : Array.from({ length: declared }, (_, index) => ({
              sequence: index + 1,
              name: `Round ${index + 1}`,
            })),
      );
      setLoadError(null);
    } catch {
      setLoadError("Could not load this drive. Please try again.");
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle =
    (set: (fn: (cur: readonly string[]) => readonly string[]) => void) =>
    (value: string): void =>
      set((cur) => (cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]));

  const cohort = loaded?.cohort ?? [];
  const loadedDrive = loaded?.drive ?? null;

  const drive: VisibleDrive | null = useMemo(
    () =>
      loadedDrive === null
        ? null
        : {
            id: loadedDrive.id,
            status: loadedDrive.status,
            driveType: loadedDrive.driveType ?? "placement",
            offerCategory: loadedDrive.offerCategory,
            openToAllOverride: openToAll,
            // 2026-08-18: the drive's area, so the audience counts only the
            // students who asked for that kind of work.
            roleCategory: loadedDrive.roleCategory,
            // A drive with no window yet must not silently exclude everyone:
            // the window is set elsewhere and checked by the readiness list.
            applicationStart: openNow ? new Date() : (loadedDrive.applicationStart ?? new Date(0)),
            applicationEnd: loadedDrive.applicationEnd ?? new Date(8.64e15),
            criteria: {
              eligibleDegrees: degrees,
              eligibleBranches: branches,
              eligiblePassingYears: [],
              minOverallCgpa: minCgpa === "" ? null : Number(minCgpa),
              minTenthPercentage: minTenth === "" ? null : Number(minTenth),
              minTwelfthPercentage: minTwelfth === "" ? null : Number(minTwelfth),
              arrearPolicy,
              targetCities: cities,
              targetCampuses: campuses,
            },
          },
    // `openNow` is in the list because the audience is judged against the
    // window, and ticking it changes the start the audience is judged on.
    [
      loadedDrive,
      degrees,
      branches,
      minCgpa,
      minTenth,
      minTwelfth,
      arrearPolicy,
      cities,
      campuses,
      openToAll,
      openNow,
    ],
  );

  const audience = useMemo(() => {
    const included: string[] = [];
    const excluded = new Map<string, number>();
    if (drive !== null) {
      for (const student of cohort) {
        const result = isDriveVisibleToStudent(student, drive);
        if (result.visible) included.push(student.name);
        else excluded.set(result.reason, (excluded.get(result.reason) ?? 0) + 1);
      }
    }
    return { included, excluded: [...excluded.entries()] };
  }, [drive, cohort]);

  const overrideIncomplete = openToAll && overrideReason.trim() === "";

  /**
   * "Open now" (2026-08-18). Expressing the most common intent there is - open
   * it as I publish - took four fields of `datetime-local` arithmetic, and a
   * minute out in the wrong direction announces a drive students cannot yet
   * apply to, which reads as a broken page.
   *
   * The instant is stamped AT PUBLISH, not when the box is ticked: a
   * coordinator who ticks it and then spends five minutes on the targeting
   * would otherwise publish a window that opened in the past.
   */
  const startForPublish = (): string | null =>
    openNow ? toLocalInput(new Date()) : windowStart === "" ? null : windowStart;

  /**
   * The readiness list is the domain's, not a hand-written one.
   *
   * The mock ticked "Rounds configured" and "Application window set"
   * unconditionally, so a drive that could never go live looked ready. Asking
   * `missingBeforeGoLive` means the checklist and the refusal can never
   * disagree - they are the same rule.
   */
  const readiness: DriveReadiness | null =
    loadedDrive === null
      ? null
      : {
          companyName: loadedDrive.companyName,
          roleTitle: loadedDrive.roleTitle ?? "",
          roleCategory: loadedDrive.roleCategory,
          jobDescription: loadedDrive.jobDescription,
          locations: loadedDrive.locations,
          ctcMinLpa: loadedDrive.ctcMinLpa,
          driveType: loadedDrive.driveType,
          offerCategory: loadedDrive.offerCategory,
          hasEligibilityCriteria: true,
          roundCount: rounds.length,
          // Ticked, the start is answered - the readiness rule must not still
          // report "application start" as missing and refuse to publish.
          applicationStart: startForPublish(),
          applicationEnd: windowEnd === "" ? null : windowEnd,
          onHold: loadedDrive.onHold,
        };

  const missing = readiness === null ? [] : missingBeforeGoLive(readiness);

  /**
   * A disabled button with the reason buried in a checklist is what made this
   * look broken. The press is always accepted; if it cannot go ahead, it says
   * so where the coordinator is looking.
   */
  async function publish() {
    setFailure(null);

    if (overrideIncomplete) {
      setFailure(
        "An override reason is required before this drive can go live. It is audit-logged.",
      );
      return;
    }
    if (missing.length > 0) {
      setFailure(`This drive cannot go live yet. Missing: ${missing.join(", ")}.`);
      return;
    }
    if (audience.included.length === 0) {
      setFailure("Nobody matches this targeting yet, so there would be nobody to publish to.");
      return;
    }
    if (loadedDrive === null) return;

    setPublishing(true);
    try {
      await view.publish({
        driveId: loadedDrive.id,
        cities,
        campuses,
        degrees,
        branches,
        minOverallCgpa: minCgpa === "" ? null : Number(minCgpa),
        // An empty box is "no bar", never a bar of zero - the same distinction
        // the CGPA cutoff makes, and the one an invented 7.0 got wrong before.
        minTenthPercentage: minTenth === "" ? null : Number(minTenth),
        minTwelfthPercentage: minTwelfth === "" ? null : Number(minTwelfth),
        arrearPolicy,
        openToAllOverride: openToAll,
        overrideReason: openToAll ? overrideReason.trim() : null,
        applicationStart: startForPublish(),
        applicationEnd: windowEnd === "" ? null : windowEnd,
        rounds,
      });
      setPublished(true);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not publish this drive.");
    } finally {
      setPublishing(false);
    }
  }

  if (loadError !== null) {
    return (
      <Card className="p-6">
        <p role="alert" className="text-sm text-danger-700">
          {loadError}
        </p>
      </Card>
    );
  }

  if (loaded === null || loadedDrive === null) {
    return (
      <p role="status" className="p-6 text-sm text-ink-500">
        Loading this drive…
      </p>
    );
  }

  if (published) {
    return (
      <Card className="p-6">
        <h1 className="font-heading text-xl font-bold text-brand-600">
          {loadedDrive.companyName} is live
        </h1>
        <p role="status" className="mt-2 text-sm text-ink-700">
          {audience.included.length} students can now see and apply to this drive.
        </p>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={`Publish drive — ${loadedDrive.companyName}`}
        subtitle={loadedDrive.subtitle}
      />

      {failure !== null && (
        <Card className="mb-4 border border-danger-500 bg-danger-50 p-4">
          <p role="alert" className="text-sm text-danger-700">
            {failure}
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="mb-4 text-lg text-ink-900">Audience targeting</h2>
            <div className="flex flex-col gap-5">
              <MultiSelect
                label="Cities"
                options={loaded.options.cities}
                selected={cities}
                onToggle={toggle(setCities)}
              />
              <MultiSelect
                label="Campuses"
                options={loaded.options.campuses}
                selected={campuses}
                onToggle={toggle(setCampuses)}
              />
              <MultiSelect
                label="Degrees"
                options={loaded.options.degrees}
                selected={degrees}
                onToggle={toggle(setDegrees)}
              />
              <MultiSelect
                label="Branches"
                options={loaded.options.branches}
                selected={branches}
                onToggle={toggle(setBranches)}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="min-cgpa"
                    className="mb-1.5 block text-sm font-medium text-ink-700"
                  >
                    Minimum overall CGPA
                  </label>
                  <input
                    id="min-cgpa"
                    type="number"
                    step="0.1"
                    value={minCgpa}
                    onChange={(e) => setMinCgpa(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="min-tenth"
                    className="mb-1.5 block text-sm font-medium text-ink-700"
                  >
                    Minimum 10th percentage
                  </label>
                  <input
                    id="min-tenth"
                    type="number"
                    step="0.01"
                    value={minTenth}
                    onChange={(e) => setMinTenth(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="min-twelfth"
                    className="mb-1.5 block text-sm font-medium text-ink-700"
                  >
                    Minimum 12th percentage
                  </label>
                  <input
                    id="min-twelfth"
                    type="number"
                    step="0.01"
                    value={minTwelfth}
                    onChange={(e) => setMinTwelfth(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="arrears"
                    className="mb-1.5 block text-sm font-medium text-ink-700"
                  >
                    Arrear policy
                  </label>
                  <select
                    id="arrears"
                    value={arrearPolicy}
                    onChange={(e) =>
                      setArrearPolicy(e.target.value as EligibilityCriteria["arrearPolicy"])
                    }
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  >
                    <option value="flexible">Flexible — no restriction</option>
                    <option value="no_standing">No standing arrears</option>
                    <option value="no_history">No history of arrears (strictest)</option>
                  </select>
                </div>
              </div>
            </div>
          </Card>

          {/* A24: the window and the rounds are decided here, at publish time.
              Neither had an input anywhere in the application before this. */}
          <Card className="p-5">
            <h2 className="mb-4 text-lg text-ink-900">Application window and rounds</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="window-start"
                  className="mb-1.5 block text-sm font-medium text-ink-700"
                >
                  Applications open
                </label>
                <input
                  id="window-start"
                  type="datetime-local"
                  value={windowStart}
                  disabled={openNow}
                  onChange={(e) => setWindowStart(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm disabled:bg-surface-muted disabled:text-ink-500"
                />
                {/* The date the coordinator typed is kept, not cleared: unticking
                    must give them their own answer back, not a blank field. */}
                <label className="mt-2 flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={openNow}
                    onChange={(e) => setOpenNow(e.target.checked)}
                  />
                  Open now — the moment I publish
                </label>
              </div>
              <div>
                <label
                  htmlFor="window-end"
                  className="mb-1.5 block text-sm font-medium text-ink-700"
                >
                  Applications close
                </label>
                <input
                  id="window-end"
                  type="datetime-local"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-1.5 text-sm font-medium text-ink-700">Rounds</p>

              {/* F11: the AE already knew. Reported here rather than left in
                  an email the coordinator has to go and find. */}
              {loadedDrive.declaredRoundCount !== null && (
                <>
                  <p className="mb-1 text-xs font-medium text-ink-700">
                    The Account Executive declared {loadedDrive.declaredRoundCount} rounds for this
                    drive.
                  </p>
                  {rounds.length !== loadedDrive.declaredRoundCount && (
                    <p className="mb-2 text-xs font-medium text-gold-700">
                      They declared {loadedDrive.declaredRoundCount} rounds, but {rounds.length}{" "}
                      {rounds.length === 1 ? "is" : "are"} configured — check which is out of date.
                    </p>
                  )}
                </>
              )}

              {rounds.length === 0 ? (
                <p className="mb-2 text-xs text-ink-300">
                  No rounds yet. A drive cannot go live without at least one.
                </p>
              ) : (
                <ol className="mb-3 flex flex-col gap-1.5">
                  {rounds.map((round) => (
                    <li
                      key={`${round.sequence}-${round.name}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm"
                    >
                      <span className="text-ink-900">
                        {round.sequence}. {round.name}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove round ${round.sequence}: ${round.name}`}
                        onClick={() =>
                          setRounds((current) =>
                            current
                              .filter((r) => r.sequence !== round.sequence)
                              // Sequence is positional, so closing the gap keeps
                              // 1..n contiguous for the schema's check constraint.
                              .map((r, index) => ({ ...r, sequence: index + 1 })),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ol>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <label
                    htmlFor="round-name"
                    className="mb-1.5 block text-xs font-medium text-ink-500"
                  >
                    Round name
                  </label>
                  <input
                    id="round-name"
                    value={roundName}
                    onChange={(e) => setRoundName(e.target.value)}
                    placeholder="e.g. Aptitude test"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const name = roundName.trim();
                    if (name === "") return;
                    setRounds((current) => [...current, { sequence: current.length + 1, name }]);
                    setRoundName("");
                  }}
                >
                  Add round
                </Button>
              </div>
            </div>
          </Card>

          {/* R5a — deliberately styled as an exception, not a convenience. */}
          <Card className="border-gold-300 p-5">
            <div className="flex items-start gap-3">
              <input
                id="open-to-all"
                type="checkbox"
                checked={openToAll}
                onChange={(e) => setOpenToAll(e.target.checked)}
                className="mt-1 size-4 accent-gold-600"
              />
              <div className="min-w-0 flex-1">
                <label htmlFor="open-to-all" className="font-heading font-bold text-ink-900">
                  Open to all students (prestige-drive override)
                </label>
                <p className="mt-1 text-sm text-ink-500">
                  Ignores the category ladder and the internship cap, so already-placed students can
                  apply. Does <strong>not</strong> override eligibility, opt-outs or disbarments.
                </p>
                {openToAll && (
                  <div className="mt-3">
                    <label
                      htmlFor="override-reason"
                      className="mb-1.5 block text-sm font-medium text-ink-700"
                    >
                      Reason for override (required, audit-logged)
                    </label>
                    <input
                      id="override-reason"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="e.g. Flagship recruiter, opened campus-wide by CEO approval"
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                    />
                    {overrideIncomplete && (
                      <p className="mt-1 text-xs font-medium text-danger-700">
                        A reason is required before this drive can go live.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Live audience — the whole point of the screen. */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden">
            <div className="border-b border-line bg-brand-500 px-4 py-3 text-white">
              <p className="text-xs uppercase tracking-wide text-white/70">Live audience</p>
              <p className="font-heading text-3xl font-bold" data-testid="audience-count">
                {audience.included.length}
              </p>
              <p className="text-xs text-white/70">
                of {cohort.length} students will see this drive
              </p>
            </div>

            <div className="p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                Excluded
              </p>
              {audience.excluded.length === 0 ? (
                <p className="text-sm text-ink-500">Nobody is excluded.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {audience.excluded.map(([reason, count]) => (
                    <li key={reason} className="flex items-start justify-between gap-2 text-sm">
                      <span className="text-ink-500">
                        {EXCLUSION_LABEL[reason as Exclude<VisibilityReason, "visible">]}
                      </span>
                      <span className="font-semibold text-ink-900">{count}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Before going live
                </p>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {[
                    ...missing.map((field) => [field, false] as const),
                    ["Not on hold", !loadedDrive.onHold] as const,
                    ["At least one student targeted", audience.included.length > 0] as const,
                    ["Override reason supplied", !overrideIncomplete] as const,
                  ].map(([label, done]) => (
                    <li key={String(label)} className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={done === true ? "text-success-500" : "text-danger-500"}
                      >
                        {done === true ? "✓" : "✕"}
                      </span>
                      <span className={done === true ? "text-ink-500" : "text-danger-700"}>
                        {label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Never disabled while there is something to explain: a dead
                  button is indistinguishable from a broken one. */}
              <Button className="mt-4 w-full" disabled={publishing} onClick={() => void publish()}>
                {publishing
                  ? "Publishing…"
                  : `Publish to ${audience.included.length} student${
                      audience.included.length === 1 ? "" : "s"
                    }`}
              </Button>
              {openToAll && (
                <p className="mt-2 text-center text-xs">
                  <Badge tone="warning">Override active</Badge>
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
