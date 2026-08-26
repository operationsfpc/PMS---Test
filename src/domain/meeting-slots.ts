/**
 * F5 (UAT 2026-08-19) — per-student meeting links for online rounds, uploaded
 * in bulk with individual time slots.
 *
 * CSV shape: `roll_number,meeting_link,scheduled_at`. The header row is
 * REQUIRED and checked verbatim: a file with the columns in another order,
 * read positionally, would send each student someone else's interview.
 *
 * UAT 2026-08-26 (live): an upload answered "No participant in this round
 * carries these roll numbers: 124, BCA2023156" while the screen underneath
 * listed exactly those two. Two consequences, both here:
 *
 *  1. MATCHING is a domain rule (`matchMeetingSlots`), done against the
 *     participants the screen is showing. The screen and the matcher can no
 *     longer disagree about who is in the round.
 *  2. Roll numbers are compared as people WRITE them (`normaliseRollNumber`):
 *     case, padding, stray spaces, Excel's quotes and its byte-order mark are
 *     formatting, not identity.
 *
 * And `buildMeetingSlotsTemplate` removes the guesswork the coordinator was
 * left with: the template is not a blank sample, it is THIS round's people,
 * pre-filled, so a downloaded-then-uploaded file always matches.
 */

export interface MeetingSlot {
  readonly rollNumber: string;
  readonly meetingLink: string;
  /** `datetime-local` text, or null when the file left it blank. */
  readonly scheduledAt: string | null;
}

export interface ParsedMeetingSlots {
  readonly slots: readonly MeetingSlot[];
  /** Human sentences naming the LINE, so the fix is findable in Excel. */
  readonly problems: readonly string[];
}

/** Who is in the round, as the screen knows them. */
export interface SlotParticipant {
  readonly applicationId: string;
  readonly rollNumber: string;
}

export interface SlotAssignment {
  readonly applicationId: string;
  /** As written in the file — what the coordinator will search for. */
  readonly rollNumber: string;
  readonly meetingLink: string;
  readonly scheduledAt: string | null;
}

export interface MatchedMeetingSlots {
  readonly assignments: readonly SlotAssignment[];
  /** Roll numbers in the file that nobody in this round carries. */
  readonly unmatched: readonly string[];
}

export const MEETING_SLOTS_HEADER = "roll_number,meeting_link,scheduled_at";

const isUrl = (value: string) => /^https?:\/\/\S+$/.test(value);

/**
 * Invisible characters Excel and copy-paste leave behind: the byte-order
 * mark, the zero-width space and the zero-width non-joiner. They are not part
 * of anybody's roll number.
 */
const INVISIBLE = /[\uFEFF\u200B-\u200D]/g;

/** A cell as the file wrote it: unwrapped from Excel's quotes, trimmed. */
function cell(raw: string): string {
  const trimmed = raw.replaceAll(INVISIBLE, "").trim();
  const unquoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.trim();
}

/**
 * The comparable form of a roll number. Case and spacing are how it was
 * TYPED; the roll number is what is left once they are taken away.
 */
export function normaliseRollNumber(raw: string): string {
  return cell(raw).replaceAll(/\s+/g, "").toUpperCase();
}

/**
 * A roll number the database never recorded. `participants()` prints an em
 * dash in its place, and an em dash must never match an em dash — that would
 * hand one student the link meant for another.
 */
const isRealRollNumber = (roll: string) => {
  const normalised = normaliseRollNumber(roll);
  return normalised !== "" && normalised !== "—" && normalised !== "-";
};

export function parseMeetingSlotsCsv(text: string): ParsedMeetingSlots {
  // split() always yields at least one element, so the first is a string —
  // stated with `slice(0, 1)` and a test-reachable fallback rather than an
  // unreachable `??` branch the coverage gate can never see taken.
  const lines = text.split(/\r?\n/);
  const header = lines
    .slice(0, 1)
    .join("")
    .replaceAll(INVISIBLE, "")
    .split(",")
    .map((column) => cell(column).toLowerCase().replaceAll(/\s/g, ""))
    .join(",");

  if (header !== MEETING_SLOTS_HEADER) {
    return {
      slots: [],
      problems: [`The first line must be exactly: ${MEETING_SLOTS_HEADER}`],
    };
  }

  const slots: MeetingSlot[] = [];
  const problems: string[] = [];
  const seen = new Map<string, number>();

  lines.slice(1).forEach((line, index) => {
    if (line.trim() === "") return;
    const lineNumber = index + 2;
    const [rollNumber = "", meetingLink = "", scheduledAt = ""] = line.split(",").map(cell);

    if (rollNumber === "") {
      problems.push(`Line ${lineNumber} has no roll number.`);
      return;
    }
    if (!isUrl(meetingLink)) {
      problems.push(`Line ${lineNumber}: the meeting link must be a full URL (https://…).`);
      return;
    }

    // Two rows for one student is a mistake with a silent worst case: the
    // last one wins and nobody is told which link was actually sent.
    const key = normaliseRollNumber(rollNumber);
    const first = seen.get(key);
    if (first !== undefined) {
      problems.push(
        `Roll number ${rollNumber} appears twice — lines ${first} and ${lineNumber}. Keep one row per student.`,
      );
      return;
    }
    seen.set(key, lineNumber);

    slots.push({
      rollNumber,
      meetingLink,
      scheduledAt: scheduledAt === "" ? null : scheduledAt,
    });
  });

  return { slots, problems };
}

/**
 * The file against the round. Nothing is written for a roll number that is
 * not in this round — an interview link sent to the wrong person cannot be
 * unsent.
 */
export function matchMeetingSlots(
  slots: readonly MeetingSlot[],
  participants: readonly SlotParticipant[],
): MatchedMeetingSlots {
  const byRoll = new Map(
    participants
      .filter((participant) => isRealRollNumber(participant.rollNumber))
      .map((participant) => [
        normaliseRollNumber(participant.rollNumber),
        participant.applicationId,
      ]),
  );

  const assignments: SlotAssignment[] = [];
  const unmatched: string[] = [];

  for (const slot of slots) {
    const applicationId = byRoll.get(normaliseRollNumber(slot.rollNumber));
    if (applicationId === undefined) {
      unmatched.push(slot.rollNumber);
      continue;
    }
    assignments.push({
      applicationId,
      rollNumber: slot.rollNumber,
      meetingLink: slot.meetingLink,
      scheduledAt: slot.scheduledAt,
    });
  }

  return { assignments, unmatched };
}

/**
 * The template — this round's roster, not an invented sample. Downloading it,
 * typing the links into column B and uploading it back cannot produce a
 * roll-number mismatch, because the roll numbers came from the round itself.
 */
export function buildMeetingSlotsTemplate(
  participants: readonly {
    readonly rollNumber: string;
    readonly meetingLink?: string | null;
    readonly scheduledAt?: string | null;
  }[],
): string {
  const rows = participants
    .filter((participant) => isRealRollNumber(participant.rollNumber))
    .map(
      (participant) =>
        `${cell(participant.rollNumber)},${participant.meetingLink ?? ""},${participant.scheduledAt ?? ""}`,
    );

  return [MEETING_SLOTS_HEADER, ...rows, ""].join("\n");
}
