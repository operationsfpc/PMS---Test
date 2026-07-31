import { Badge, Button, Card, PageHeader } from "@components/ui";
import type { EligibilityCriteria } from "@domain/eligibility";
import type { VisibilityReason, VisibleDrive } from "@domain/visibility";
import { isDriveVisibleToStudent } from "@domain/visibility";
import { COHORT } from "@lib/mock-data";
import { useMemo, useState } from "react";

/**
 * Central CPC — DAF creation and audience targeting. PRD §7.1, §6.2, §6.5.
 *
 * The live audience count is computed by running the REAL domain rules over the
 * cohort. Nothing here re-implements eligibility or the ladder, so what the
 * coordinator sees before publishing is exactly what students will get.
 */

const CITIES = ["Chennai", "Bengaluru"] as const;
const CAMPUSES = ["Alliance University", "VIT Bangalore"] as const;
const DEGREES = ["B.E", "MCA", "B.Sc CS"] as const;
const BRANCHES = ["CSE", "IT", "ECE"] as const;

const EXCLUSION_LABEL: Record<Exclude<VisibilityReason, "visible">, string> = {
  srf_not_approved: "SRF not yet verified",
  opted_out: "Opted out of placements",
  disbarred: "Disbarred",
  not_eligible: "Does not meet eligibility",
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

export function DafPublish() {
  const [cities, setCities] = useState<readonly string[]>([]);
  const [campuses, setCampuses] = useState<readonly string[]>([]);
  const [degrees, setDegrees] = useState<readonly string[]>([]);
  const [branches, setBranches] = useState<readonly string[]>([]);
  const [minCgpa, setMinCgpa] = useState("7");
  const [arrearPolicy, setArrearPolicy] =
    useState<EligibilityCriteria["arrearPolicy"]>("no_standing");
  const [openToAll, setOpenToAll] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const toggle =
    (set: (fn: (cur: readonly string[]) => readonly string[]) => void) =>
    (value: string): void =>
      set((cur) => (cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]));

  const drive: VisibleDrive = useMemo(
    () => ({
      id: "d1",
      status: "approved",
      driveType: "placement",
      offerCategory: "dream",
      openToAllOverride: openToAll,
      applicationStart: new Date("2026-08-01T00:00:00Z"),
      applicationEnd: new Date("2026-08-14T23:59:59Z"),
      criteria: {
        eligibleDegrees: degrees,
        eligibleBranches: branches,
        eligiblePassingYears: [],
        minOverallCgpa: minCgpa === "" ? null : Number(minCgpa),
        minTenthPercentage: null,
        minTwelfthPercentage: null,
        arrearPolicy,
        targetCities: cities,
        targetCampuses: campuses,
      },
    }),
    [degrees, branches, minCgpa, arrearPolicy, cities, campuses, openToAll],
  );

  const audience = useMemo(() => {
    const included: string[] = [];
    const excluded = new Map<string, number>();
    for (const student of COHORT) {
      const result = isDriveVisibleToStudent(student, drive);
      if (result.visible) included.push(student.name);
      else excluded.set(result.reason, (excluded.get(result.reason) ?? 0) + 1);
    }
    return { included, excluded: [...excluded.entries()] };
  }, [drive]);

  const overrideIncomplete = openToAll && overrideReason.trim() === "";
  const canPublish = audience.included.length > 0 && !overrideIncomplete;

  return (
    <>
      <PageHeader
        title="Publish drive — Goldman Sachs"
        subtitle="Analyst — Engineering · Super Dream · ₹18–22 LPA · Placement"
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="mb-4 text-lg text-ink-900">Audience targeting</h2>
            <div className="flex flex-col gap-5">
              <MultiSelect
                label="Cities"
                options={CITIES}
                selected={cities}
                onToggle={toggle(setCities)}
              />
              <MultiSelect
                label="Campuses"
                options={CAMPUSES}
                selected={campuses}
                onToggle={toggle(setCampuses)}
              />
              <MultiSelect
                label="Degrees"
                options={DEGREES}
                selected={degrees}
                onToggle={toggle(setDegrees)}
              />
              <MultiSelect
                label="Branches"
                options={BRANCHES}
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
                of {COHORT.length} students will see this drive
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
                    ["Company, role and JD", true],
                    ["CTC and classification", true],
                    ["Rounds configured", true],
                    ["Application window set", true],
                    ["At least one student targeted", audience.included.length > 0],
                    ["Override reason supplied", !overrideIncomplete],
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

              <Button className="mt-4 w-full" disabled={!canPublish}>
                Publish to {audience.included.length} students
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
