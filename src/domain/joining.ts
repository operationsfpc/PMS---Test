/**
 * When an offer turns into a job. Asked for 2026-08-18:
 *
 *   "in offer rollout and joining timeline, instead of a large text box, have
 *    radio button for immediate joining and joining later. Have a comments box
 *    also for both the options."
 *
 * The one fact a student plans their year around — do I start now, or next
 * July? — used to be buried in a three-row textarea, so no screen could show
 * it and no list could be ordered by it.
 *
 * ONE COMMENT BOX PER OPTION (answer 6), and therefore one column per option.
 * Only the chosen option's comment is kept: a note about joining next July,
 * left behind on a drive that now says immediate, is worse than no note.
 */

export const JOINING_TIMELINES = ["immediate", "later"] as const;

export type JoiningTimeline = (typeof JOINING_TIMELINES)[number];

export function isJoiningTimeline(value: string): value is JoiningTimeline {
  return (JOINING_TIMELINES as readonly string[]).includes(value);
}

const LABELS: Record<JoiningTimeline, string> = {
  immediate: "Immediate joining",
  later: "Joining later",
};

export function joiningLabel(timeline: JoiningTimeline): string {
  return LABELS[timeline];
}

/**
 * What a reader is told.
 *
 * A drive raised before this field existed has prose and no choice, and that
 * prose is all anyone has — it is repeated verbatim rather than dropped
 * (answer 9: the live drives are left exactly as they are).
 */
export function describeJoining(
  timeline: string | null | undefined,
  notes: string | null | undefined,
): string {
  const comment = (notes ?? "").trim();
  const value = (timeline ?? "").trim();

  if (value === "" || !isJoiningTimeline(value)) {
    return comment === "" ? "Not recorded" : comment;
  }

  return comment === "" ? LABELS[value] : `${LABELS[value]} — ${comment}`;
}

/** The comments that may be stored, given the option that was actually chosen. */
export function joiningNotesFor(
  timeline: string,
  immediateNotes: string,
  laterNotes: string,
): { immediate: string; later: string } {
  return {
    immediate: timeline === "immediate" ? immediateNotes.trim() : "",
    later: timeline === "later" ? laterNotes.trim() : "",
  };
}
