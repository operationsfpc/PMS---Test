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
  { rail: "border-l-brand-500", band: "bg-brand-50" },
  { rail: "border-l-violet-500", band: "bg-violet-50" },
  { rail: "border-l-success-500", band: "bg-success-50" },
  { rail: "border-l-gold-500", band: "bg-gold-50" },
  { rail: "border-l-cyan-400", band: "bg-cyan-50" },
  { rail: "border-l-danger-500", band: "bg-danger-50" },
] as const;

export function visitAccent(index: number): (typeof VISIT_ACCENTS)[number] {
  return VISIT_ACCENTS[index % VISIT_ACCENTS.length] ?? VISIT_ACCENTS[0];
}
