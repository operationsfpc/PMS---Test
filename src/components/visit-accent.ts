/**
 * One colour per company visit, shared by every screen that draws a visit as
 * a card.
 *
 * 2026-10-29 (UAT, "use some colours for batches"): visits stacked as
 * identical white cards were told apart only by reading every name. The rail
 * and its band now carry the visit. 2026-10-31: the palette moved here from
 * the student's drive list so the AE portfolio, the CPC progress list, the
 * central cockpit, the dashboard roster and the student screens colour the
 * same visit the same way.
 *
 * Assigned by position in the list, not by hashing the visit id: two visits
 * that happen to hash alike would wear the same colour, which is the exact
 * confusion these are here to end. Neighbouring cards always differ, and the
 * order is the one the data already arrives in, so colours do not jump between
 * reads.
 */
export const VISIT_ACCENTS = [
  { rail: "", band: "bg-brand-50", tone: "brand", dot: "bg-brand-500" },
  { rail: "", band: "bg-violet-50", tone: "accent", dot: "bg-violet-500" },
  { rail: "", band: "bg-success-50", tone: "success", dot: "bg-success-500" },
  { rail: "", band: "bg-gold-50", tone: "warning", dot: "bg-gold-500" },
  { rail: "", band: "bg-cyan-50", tone: "neutral", dot: "bg-cyan-400" },
  { rail: "", band: "bg-danger-50", tone: "danger", dot: "bg-danger-500" },
] as const;

export function visitAccent(index: number): (typeof VISIT_ACCENTS)[number] {
  return VISIT_ACCENTS[index % VISIT_ACCENTS.length] ?? VISIT_ACCENTS[0];
}
