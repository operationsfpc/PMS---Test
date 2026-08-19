/**
 * F5 (UAT 2026-08-19) — per-student meeting links for online rounds, uploaded
 * in bulk with individual time slots.
 *
 * CSV shape: `roll_number,meeting_link,scheduled_at`. The header row is
 * REQUIRED and checked verbatim: a file with the columns in another order,
 * read positionally, would send each student someone else's interview.
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

export const MEETING_SLOTS_HEADER = "roll_number,meeting_link,scheduled_at";

const isUrl = (value: string) => /^https?:\/\/\S+$/.test(value);

export function parseMeetingSlotsCsv(text: string): ParsedMeetingSlots {
  // split() always yields at least one element, so the first is a string —
  // stated with `at(0)` and a test-reachable fallback rather than an
  // unreachable `??` branch the coverage gate can never see taken.
  const lines = text.split(/\r?\n/);
  const header = lines.slice(0, 1).join("").trim().toLowerCase().replaceAll(/\s/g, "");

  if (header !== MEETING_SLOTS_HEADER) {
    return {
      slots: [],
      problems: [`The first line must be exactly: ${MEETING_SLOTS_HEADER}`],
    };
  }

  const slots: MeetingSlot[] = [];
  const problems: string[] = [];

  lines.slice(1).forEach((line, index) => {
    if (line.trim() === "") return;
    const lineNumber = index + 2;
    const [rollNumber = "", meetingLink = "", scheduledAt = ""] = line
      .split(",")
      .map((cell) => cell.trim());

    if (rollNumber === "") {
      problems.push(`Line ${lineNumber} has no roll number.`);
      return;
    }
    if (!isUrl(meetingLink)) {
      problems.push(`Line ${lineNumber}: the meeting link must be a full URL (https://…).`);
      return;
    }

    slots.push({
      rollNumber,
      meetingLink,
      scheduledAt: scheduledAt === "" ? null : scheduledAt,
    });
  });

  return { slots, problems };
}
