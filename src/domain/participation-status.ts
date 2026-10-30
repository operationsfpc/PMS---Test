/**
 * How a student's PARTICIPATION status is named and coloured.
 *
 * The record page used to print `participationStatus.replaceAll("_", " ")`,
 * which gave coordinators and students the lower-case column value — "opted
 * out" beside a badge that said "Verified" in title case, on the same screen.
 * Every other queue in the app already says "Opted out", "On hold" and
 * "Disbarred"; this is those words, in one place.
 *
 * The colours are not decoration: they answer "is this student in the pipeline
 * or not, and did they choose that?" — which is the first question a
 * coordinator asks before shortlisting anyone.
 */

import type { ParticipationStatus } from "./types";
import { PARTICIPATION_STATUSES } from "./types";

/** The badge's colour, named by intent. A subset of the UI's `Tone`. */
export type ParticipationStatusTone = "neutral" | "warning" | "danger";

const LABEL: Readonly<Record<ParticipationStatus, string>> = {
  active: "In the pipeline",
  opted_out: "Opted out",
  on_hold: "On hold",
  disbarred: "Disbarred",
};

const TONE: Readonly<Record<ParticipationStatus, ParticipationStatusTone>> = {
  active: "neutral",
  // Their own decision, recorded and reversible by them — not a problem flag.
  opted_out: "neutral",
  on_hold: "warning",
  disbarred: "danger",
};

function asStatus(raw: string): ParticipationStatus | null {
  return PARTICIPATION_STATUSES.find((status) => status === raw) ?? null;
}

export function participationStatusLabel(status: string): string {
  const known = asStatus(status);
  return known === null ? status.replaceAll("_", " ") : LABEL[known];
}

/** An unknown status is quiet: it is a data gap, not somebody's alarm. */
export function participationStatusTone(status: string): ParticipationStatusTone {
  const known = asStatus(status);
  return known === null ? "neutral" : TONE[known];
}
