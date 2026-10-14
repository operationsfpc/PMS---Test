import { Badge, Button, Card, StatCard } from "@components/ui";
import {
  type DateDimension,
  type DateRangeFilterCriteria,
  type DateRangePreset,
  type DriveAnalyticsSummary,
  type DriveDateFilterItem,
  exportDrivesAnalysisCsv,
  getDateRangeForPreset,
  summariseDriveAnalytics,
} from "@domain/drive-date-filter";
import { useId, useMemo } from "react";

const PRESET_LABELS: Record<DateRangePreset, string> = {
  all: "All Time",
  today: "Today",
  last_7_days: "Last 7 Days",
  last_30_days: "Last 30 Days",
  this_month: "This Month",
  custom: "Custom Range",
};

export function DriveDateFilter<T extends DriveDateFilterItem>({
  criteria,
  onChange,
  filteredDrives,
  allDrivesCount,
  showAnalytics = true,
}: {
  criteria: DateRangeFilterCriteria;
  onChange: (next: DateRangeFilterCriteria) => void;
  filteredDrives: readonly T[];
  allDrivesCount: number;
  showAnalytics?: boolean;
}) {
  const fromId = useId();
  const toId = useId();

  const analytics: DriveAnalyticsSummary = useMemo(
    () => summariseDriveAnalytics(filteredDrives),
    [filteredDrives],
  );

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

  const handleClear = () => {
    onChange({
      dimension: "created_at",
      preset: "all",
      startDate: null,
      endDate: null,
    });
  };

  const handleExportCsv = () => {
    if (filteredDrives.length === 0) return;
    const csvContent = exportDrivesAnalysisCsv(filteredDrives);
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

  const isFiltered =
    criteria.preset !== "all" || criteria.startDate !== null || criteria.endDate !== null;

  return (
    <div className="mb-6 space-y-4">
      {/* Date-Range Filter Control Box */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-500">
              Date Filter Dimension:
            </span>
            <div className="inline-flex rounded-lg border border-line bg-surface-muted p-0.5">
              <button
                type="button"
                onClick={() => handleDimensionChange("created_at")}
                aria-pressed={criteria.dimension === "created_at"}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  criteria.dimension === "created_at"
                    ? "bg-white text-ink-900 shadow-xs"
                    : "text-ink-600 hover:text-ink-900"
                }`}
              >
                Drive Creation Date
              </button>
              <button
                type="button"
                onClick={() => handleDimensionChange("tentative_date")}
                aria-pressed={criteria.dimension === "tentative_date"}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  criteria.dimension === "tentative_date"
                    ? "bg-white text-ink-900 shadow-xs"
                    : "text-ink-600 hover:text-ink-900"
                }`}
              >
                Drive / Event Date
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isFiltered && (
              <Button variant="secondary" size="sm" onClick={handleClear}>
                Reset Filter
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportCsv}
              disabled={filteredDrives.length === 0}
              title="Export analysis data for current date range as CSV"
            >
              Export Analysis (CSV)
            </Button>
          </div>
        </div>

        {/* Quick Presets & Date Inputs */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {(["all", "today", "last_7_days", "last_30_days", "this_month", "custom"] as const).map(
              (p) => {
                const active = criteria.preset === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePresetChange(p)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-[#3D3777] bg-[#3D3777] text-white"
                        : "border-line bg-white text-ink-700 hover:border-[#A46AFC]"
                    }`}
                  >
                    {PRESET_LABELS[p]}
                  </button>
                );
              },
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-ink-700">
              <label htmlFor={fromId} className="font-medium">
                From:
              </label>
              <input
                id={fromId}
                type="date"
                value={criteria.startDate ?? ""}
                onChange={(e) => handleDateChange("startDate", e.target.value)}
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs text-ink-900 outline-none focus:border-[#A46AFC]"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-ink-700">
              <label htmlFor={toId} className="font-medium">
                To:
              </label>
              <input
                id={toId}
                type="date"
                value={criteria.endDate ?? ""}
                onChange={(e) => handleDateChange("endDate", e.target.value)}
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs text-ink-900 outline-none focus:border-[#A46AFC]"
              />
            </div>
          </div>
        </div>

        {/* Filter status banner */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <span>
            {isFiltered ? (
              <>
                Filtered by{" "}
                <strong className="text-ink-700">
                  {criteria.dimension === "created_at" ? "Creation Date" : "Drive Date"}
                </strong>
                : showing <strong className="text-ink-900">{filteredDrives.length}</strong> of{" "}
                {allDrivesCount} drives.
              </>
            ) : (
              <>Showing all {allDrivesCount} drives across all time.</>
            )}
          </span>
          {isFiltered && (
            <Badge tone="brand">
              Range: {criteria.startDate ?? "Earliest"} → {criteria.endDate ?? "Latest"}
            </Badge>
          )}
        </div>
      </Card>

      {/* Real-Time Monitoring & Analysis Cards */}
      {showAnalytics && (
        <div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Drives / Roles"
              value={analytics.totalDrives}
              hint={`${analytics.uniqueCompanies} unique companies`}
              tone="brand"
            />
            <StatCard
              label="Total Openings"
              value={analytics.totalOpenings > 0 ? analytics.totalOpenings : "—"}
              hint="Declared vacancies"
            />
            <StatCard
              label="Average Max CTC"
              value={analytics.avgCtcMaxLpa !== null ? `₹${analytics.avgCtcMaxLpa} LPA` : "—"}
              {...(analytics.highestCtcMaxLpa !== null
                ? { hint: `Peak: ₹${analytics.highestCtcMaxLpa} LPA` }
                : {})}
              tone="brand"
            />
            <StatCard
              label="Applicants / Shortlisted"
              value={`${analytics.totalApplicants} / ${analytics.totalShortlisted}`}
              hint="Students in recruitment"
              tone="warning"
            />
            <StatCard
              label="Final Offers Made"
              value={analytics.totalOffers}
              hint="Offer stage conversions"
              tone="success"
            />
          </div>
        </div>
      )}
    </div>
  );
}
