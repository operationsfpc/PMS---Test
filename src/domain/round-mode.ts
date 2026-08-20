/**
 * Round modes (UAT 2026-08-20, G6b — Q8 approved).
 *
 * A round is held Online, Physical on campus, or Physical outside campus. The
 * mode decides which location field the round carries: an online round has a
 * meeting LINK; a physical round has a VENUE — an address, not a URL. Before
 * this rule, "Physical, outside campus" still showed a "Link" box, and the
 * only way to record where the interview was happening was to lie to a URL
 * field.
 *
 * The stored values match 0053's `round_mode_is_known` check constraint.
 */
export const ROUND_MODES = ["virtual", "on_campus", "physical_outside_campus"] as const;
export type RoundMode = (typeof ROUND_MODES)[number];

const LABELS: Record<RoundMode, string> = {
  virtual: "Online",
  on_campus: "Physical — on campus",
  physical_outside_campus: "Physical — outside campus",
};

/** The label a screen shows. An unknown stored value is repeated verbatim, never guessed at. */
export function roundModeLabel(mode: string | null): string {
  if (mode === null) return "Mode not set";
  return (LABELS as Record<string, string>)[mode] ?? mode;
}

/** Which location field this round has: a meeting link, or a venue address. */
export function roundLocationKind(mode: string | null): "link" | "venue" {
  return mode === "on_campus" || mode === "physical_outside_campus" ? "venue" : "link";
}
