import { Button, StatCard } from "@components/ui";
import {
  type DateDimension,
  type DateRangeFilterCriteria,
  type DateRangePreset,
  type DriveDateFilterItem,
  exportDrivesAnalysisCsv,
  getDateRangeForPreset,
  summariseDriveAnalytics,
} from "@domain/drive-date-filter";
import { useId, useMemo } from "react";

const PRESETS: readonly DateRangePreset[] = [
  "all",
  "today",
  "last_7_days",
  "last_30_days",
  "this_month",
  "custom",
];

const PRESET_LABELS: Record<DateRangePreset, string> = {
  all: "All time",
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  this_month: "This month",
  custom: "Custom range",
};

/**
 * The date half of a drive list's one filter card.
 *
 * 2026-11-02: this used to be a Card of its own, sitting above a search box,
 * a type filter and a sort control — four stacked blocks of chrome over one
 * list, which is what "filter cards and more" was about. It is now the second
 * row of the page's single filter card, and the analytics tiles it carried
 * became `DriveAnalyticsReadouts` below it.
 *
 * "All time" is the reset: a separate Reset button that cleared no more than
 * that chip already did read as a fifth control.
 */
export function DriveDateFilter({
  criteria,
  onChange,
  /** The drives currently on screen. The CSV copies exactly this set. */
  drives,
  className = "",
  compact = false,
}: {
  criteria: DateRangeFilterCriteria;
  onChange: (next: DateRangeFilterCriteria) => void;
  drives: readonly DriveDateFilterItem[];
  className?: string;
  compact?: boolean;
}) {
  const fromId = useId();
  const toId = useId();

  const handleDimensionChange = (dimension: DateDimension) => {
    onChange({ ...criteria, dimension });
  };

  const handlePresetChange = (preset: DateRangePreset) => {
    if (preset === "custom") {
      onChange({ ...criteria, preset });
      return;
    }
    const dates = getDateRangeForPreset(preset);
    onChange({
      ...criteria,
      preset,
      startDate: dates.startDate,
      endDate: dates.endDate,
    });
  };

  const handleDateChange = (field: "startDate" | "endDate", value: string) => {
    onChange({
      ...criteria,
      preset: "custom",
      [field]: value.trim() === "" ? null : value.trim(),
    });
  };

  const handleExportCsv = () => {
    if (drives.length === 0) return;
    const csvContent = exportDrivesAnalysisCsv(drives);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const dimensionTag = criteria.dimension === "created_at" ? "created" : "event";
    const dateTag = criteria.startDate
      ? `_${criteria.startDate}_to_${criteria.endDate ?? "now"}`
      : "";
    link.setAttribute("download", `drives_analysis_${dimensionTag}${dateTag}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (compact) {
    return (
      <fieldset className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
        <legend className="sr-only">Date filter</legend>
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="text-xs font-semibold text-ink-500 uppercase tracking-wider"
          >
            Date
          </span>
          <select
            aria-label="Date field"
            value={criteria.dimension}
            onChange={(e) => handleDimensionChange(e.target.value as DateDimension)}
            className="rounded-lg border border-field bg-surface px-2.5 py-1 text-xs font-medium text-ink-800 outline-none hover:border-brand-400 focus:border-brand-600"
          >
            <option value="created_at">Created date</option>
            <option value="tentative_date">Drive date</option>
          </select>
        </div>

        <select
          aria-label="Date range preset"
          value={criteria.preset}
          onChange={(e) => handlePresetChange(e.target.value as DateRangePreset)}
          className="rounded-lg border border-field bg-surface px-2.5 py-1 text-xs font-medium text-ink-800 outline-none hover:border-brand-400 focus:border-brand-600"
        >
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </select>

        {criteria.preset === "custom" && (
          <div className="flex items-center gap-1.5 text-xs text-ink-700">
            <input
              id={fromId}
              type="date"
              aria-label="From date"
              value={criteria.startDate ?? ""}
              onChange={(e) => handleDateChange("startDate", e.target.value)}
              className="rounded-lg border border-field bg-surface px-2 py-0.5 text-xs text-ink-900 outline-none focus:border-brand-600"
            />
            <span className="text-ink-500">to</span>
            <input
              id={toId}
              type="date"
              aria-label="To date"
              value={criteria.endDate ?? ""}
              onChange={(e) => handleDateChange("endDate", e.target.value)}
              className="rounded-lg border border-field bg-surface px-2 py-0.5 text-xs text-ink-900 outline-none focus:border-brand-600"
            />
          </div>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={handleExportCsv}
          disabled={drives.length === 0}
          title="Download the drives currently shown as a CSV"
          className="text-xs"
        >
          Export CSV
        </Button>
      </fieldset>
    );
  }

  return (
    <fieldset className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 border-t border-line/50 pt-3">
      <legend className="sr-only">Date range</legend>

      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="text-xs font-medium text-ink-500 uppercase tracking-wider mr-0.5"
        >
          Date
        </span>

        {/* Which date the range measures. "Created" alone is vague, so the two
            choices are named against each other: created, or the visit itself. */}
        <div className="inline-flex rounded-lg border border-line/70 bg-surface-muted/50 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => handleDimensionChange("created_at")}
            aria-pressed={criteria.dimension === "created_at"}
            title="Filter by when the drive was raised"
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              criteria.dimension === "created_at"
                ? "bg-surface text-ink-900 shadow-2xs font-semibold"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            Created
          </button>
          <button
            type="button"
            onClick={() => handleDimensionChange("tentative_date")}
            aria-pressed={criteria.dimension === "tentative_date"}
            title="Filter by the drive / event date"
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              criteria.dimension === "tentative_date"
                ? "bg-surface text-ink-900 shadow-2xs font-semibold"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            Drive date
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((preset) => {
            const active = criteria.preset === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => handlePresetChange(preset)}
                aria-pressed={active}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                  active
                    ? "border-brand-500 bg-brand-600 text-white shadow-2xs font-semibold"
                    : "border-field bg-surface text-ink-600 hover:border-brand-400 hover:text-ink-900 hover:bg-surface-muted/50"
                }`}
              >
                {PRESET_LABELS[preset]}
              </button>
            );
          })}
        </div>
      </div>

      {/* From/To only when they mean something: a preset already sets them. */}
      {criteria.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-ink-700">
            <label htmlFor={fromId} className="font-medium">
              From
            </label>
            <input
              id={fromId}
              type="date"
              value={criteria.startDate ?? ""}
              onChange={(e) => handleDateChange("startDate", e.target.value)}
              className="rounded-lg border border-field bg-surface px-2 py-0.5 text-xs text-ink-900 outline-none focus:border-brand-600"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-ink-700">
            <label htmlFor={toId} className="font-medium">
              To
            </label>
            <input
              id={toId}
              type="date"
              value={criteria.endDate ?? ""}
              onChange={(e) => handleDateChange("endDate", e.target.value)}
              className="rounded-lg border border-field bg-surface px-2 py-0.5 text-xs text-ink-900 outline-none focus:border-brand-600"
            />
          </div>
        </div>
      )}

      <div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExportCsv}
          disabled={drives.length === 0}
          title="Download the drives currently shown as a CSV"
          className="text-xs"
        >
          Export CSV
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * What the drives on screen add up to — five figures under one label, not five
 * bordered tiles. The landing's headline row is the same shape, and for the
 * same reason: five boxes compete for attention that five numbers do not.
 *
 * The figures are computed from what is visible, so narrowing by type or
 * search narrows the totals too; a readout row that ignored the filters would
 * disagree with the list under it.
 */
export function DriveAnalyticsReadouts({
  drives,
  className = "",
  embedded = false,
}: {
  drives: readonly DriveDateFilterItem[];
  className?: string;
  embedded?: boolean;
}) {
  const analytics = useMemo(() => summariseDriveAnalytics(drives), [drives]);
  const companyWord = analytics.uniqueCompanies === 1 ? "company" : "companies";

  const containerClasses = embedded
    ? `grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 ${className}`
    : `rounded-2xl border border-line/80 bg-surface p-3 sm:px-5 sm:py-3.5 shadow-xs grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 ${className}`;

  return (
    <section aria-label="Drive analytics" className={containerClasses}>
      <StatCard
        label="Drives / roles"
        value={analytics.totalDrives}
        hint={`${analytics.uniqueCompanies} unique ${companyWord}`}
        variant="readout"
      />
      <StatCard
        label="Total openings"
        value={analytics.totalOpenings > 0 ? analytics.totalOpenings : "—"}
        hint="declared vacancies"
        variant="readout"
      />
      <StatCard
        label="Average max CTC"
        value={analytics.avgCtcMaxLpa !== null ? `₹${analytics.avgCtcMaxLpa} LPA` : "—"}
        {...(analytics.highestCtcMaxLpa !== null
          ? { hint: `peak ₹${analytics.highestCtcMaxLpa} LPA` }
          : {})}
        tone="warning"
        variant="readout"
      />
      <StatCard
        label="Applicants / shortlisted"
        value={`${analytics.totalApplicants} / ${analytics.totalShortlisted}`}
        hint="students in recruitment"
        variant="readout"
      />
      <StatCard
        label="Final offers"
        value={analytics.totalOffers}
        hint="offers made"
        tone="success"
        variant="readout"
      />
    </section>
  );
}
