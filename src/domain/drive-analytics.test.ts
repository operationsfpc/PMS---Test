import { describe, expect, it } from "vitest";
import { applicationWindow, conversionRate, driveOutcome } from "./drive-analytics";

/**
 * Live drive figures. PRD §17.
 *
 * "Open drives, time left; number of eligible versus applied students; offers
 * out of a drive." Every one of these is a judgement a screen would otherwise
 * make for itself — and the clock especially, because `Date.now()` inside a
 * component cannot be tested and will be wrong the moment a coordinator's
 * laptop clock is.
 *
 * `now` is always passed in (CLAUDE.md), so every case below is exact.
 */
const at = (iso: string) => new Date(iso);
const NOW = at("2026-09-05T10:00:00Z");

describe("applicationWindow", () => {
  const open = { start: at("2026-09-01T00:00:00Z"), end: at("2026-09-10T00:00:00Z") };

  it("says a drive is open, and how long is left", () => {
    const window = applicationWindow(open, NOW);

    expect(window.state).toBe("open");
    expect(window.label).toBe("4 days left");
  });

  it("counts down in hours on the last day, because days would read as zero", () => {
    const window = applicationWindow(
      { start: at("2026-09-01T00:00:00Z"), end: at("2026-09-05T18:00:00Z") },
      NOW,
    );

    expect(window.label).toBe("8 hours left");
  });

  it("counts down in minutes in the last hour", () => {
    const window = applicationWindow(
      { start: at("2026-09-01T00:00:00Z"), end: at("2026-09-05T10:25:00Z") },
      NOW,
    );

    expect(window.label).toBe("25 minutes left");
  });

  it("does not say '1 days'", () => {
    const window = applicationWindow(
      { start: at("2026-09-01T00:00:00Z"), end: at("2026-09-06T12:00:00Z") },
      NOW,
    );

    expect(window.label).toBe("1 day left");
  });

  it("flags a drive closing within two days as urgent", () => {
    expect(applicationWindow(open, NOW).urgent).toBe(false);
    expect(applicationWindow({ ...open, end: at("2026-09-06T09:00:00Z") }, NOW).urgent).toBe(true);
  });

  it("says a drive has not opened yet, and when it will", () => {
    const window = applicationWindow(
      { start: at("2026-09-08T10:00:00Z"), end: at("2026-09-20T00:00:00Z") },
      NOW,
    );

    expect(window.state).toBe("not_open");
    expect(window.label).toBe("Opens in 3 days");
    expect(window.urgent).toBe(false);
  });

  it("says a drive has closed", () => {
    const window = applicationWindow(
      { start: at("2026-08-01T00:00:00Z"), end: at("2026-09-01T00:00:00Z") },
      NOW,
    );

    expect(window.state).toBe("closed");
    expect(window.label).toBe("Closed");
  });

  it("treats the closing instant itself as closed, not as zero minutes left", () => {
    const window = applicationWindow({ start: at("2026-09-01T00:00:00Z"), end: NOW }, NOW);

    expect(window.state).toBe("closed");
  });

  it("reports a drive with no window set as unscheduled rather than guessing", () => {
    const window = applicationWindow({ start: null, end: null }, NOW);

    expect(window.state).toBe("unscheduled");
    expect(window.label).toBe("No application window set");
  });

  it("is unscheduled when only half the window exists", () => {
    expect(applicationWindow({ start: at("2026-09-01T00:00:00Z"), end: null }, NOW).state).toBe(
      "unscheduled",
    );
    expect(applicationWindow({ start: null, end: at("2026-09-20T00:00:00Z") }, NOW).state).toBe(
      "unscheduled",
    );
  });
});

describe("conversionRate", () => {
  it("expresses applicants as a share of those eligible", () => {
    expect(conversionRate(30, 120)).toBe(25);
  });

  it("is zero when nobody was eligible, rather than NaN", () => {
    expect(conversionRate(0, 0)).toBe(0);
  });

  /**
   * R5a: the Central CPC can open a prestige drive to everyone, so more people
   * can apply than the criteria alone would allow. The figure is capped rather
   * than printed as 140%, which reads as a bug.
   */
  it("never exceeds a hundred per cent", () => {
    expect(conversionRate(140, 100)).toBe(100);
  });
});

describe("driveOutcome", () => {
  it("summarises a drive as applied, offered and the conversion between them", () => {
    const outcome = driveOutcome({ eligible: 200, applied: 50, offers: 5 });

    expect(outcome.applicationRate).toBe(25);
    expect(outcome.offerRate).toBe(10);
  });

  it("reports a drive nobody applied to without dividing by zero", () => {
    const outcome = driveOutcome({ eligible: 200, applied: 0, offers: 0 });

    expect(outcome.applicationRate).toBe(0);
    expect(outcome.offerRate).toBe(0);
  });
});
