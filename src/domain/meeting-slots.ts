/**
 * F5 (UAT 2026-08-19) — per-student meeting links for online rounds, uploaded
 * in bulk with individual time slots.
 *
 * CSV shape: `roll_number,meeting_link,date (dd-mm-yyyy),time (hh:mm)`. The
 * header row is REQUIRED and checked by name: a file with the columns in
 * another order, read positionally, would send each student someone else's
 * interview. The header carries the date format because the header is the
 * only instruction that travels with the file into Excel.
 *
 * The earlier three-column `roll_number,meeting_link,scheduled_at` file is
 * still read — templates already downloaded must not stop working.
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
 *
 * UAT 2026-08-27 (live): a file whose time column read `1pm` was answered
 * with "No participant in this round carries these roll numbers: BCA2023156,
 * 124" — both of whom were in the round. The roll numbers matched perfectly;
 * `1pm` reached Postgres as `1pm:00+05:30`, every write failed, and the only
 * message the screen had for a failed write blamed the students. So the time
 * column is judged HERE (`parseScheduledAt`), before anything is sent, and
 * what leaves this file is always a `datetime-local` value.
 *
 * A time on its own (`1pm`) is what a coordinator actually types — the day is
 * the round's day — so it is read against `roundDate` rather than refused.
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

export interface MeetingSlotsContext {
  /** The round's own day, `YYYY-MM-DD`, so `1pm` has a date to sit on. */
  readonly roundDate?: string | null;
}

/**
 * Karthik, 2026-08-27: "date and time can be text fields without validation,
 * or suggest a format in the header of the CSV template." The format is
 * suggested here — and then read generously, because a coordinator who typed
 * 27/08/2026 has not made a mistake worth refusing.
 */
export const MEETING_SLOTS_HEADER = "roll_number,meeting_link,date (dd-mm-yyyy),time (hh:mm)";

/** The file this screen used to produce. Still accepted, never written. */
const LEGACY_HEADER = "roll_number,meeting_link,scheduled_at";

const isUrl = (value: string) => /^https?:\/\/\S+$/.test(value);

/** The examples every message repeats, so the fix is always spelled out. */
const DATE_HINT = "01-09-2026";
const TIME_HINT = "10:30";
const TIME_ADVICE = "Write it as 13:00 or 1:00 pm.";

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

const pad = (value: number) => String(value).padStart(2, "0");

/** How long each month is. February is decided by the year. */
function daysInMonth(year: number, month: number): number | undefined {
  const leap = year % (year % 100 === 0 ? 400 : 4) === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

/**
 * Calendar arithmetic done by hand: `Date` is banned in domain code, and
 * `new Date("2026-02-30")` would have rolled the day into March rather than
 * telling anyone the date was wrong.
 */
function isRealDate(year: number, month: number, day: number): boolean {
  const length = daysInMonth(year, month);
  if (length === undefined) return false;
  return day >= 1 && day <= length;
}

/** `YYYY-MM-DD` from the round's own `datetime-local`, or null. */
const dayOf = (roundDate: string | null | undefined): string | null =>
  parseSlotDate(String(roundDate).slice(0, 10));

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** `sep` → 9, `September` → 9, anything else → 0, which no month is. */
function monthNumber(name: string | undefined): number {
  const lower = String(name).toLowerCase();
  return MONTHS.findIndex((month) => month.startsWith(lower) && lower.length >= 3) + 1;
}

const asDate = (year: number, month: number, day: number): string | null =>
  isRealDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;

/**
 * The date column: `27-08-2026` as the header asks, and the other spellings
 * of the same day that Excel and habit produce. A two-digit year is refused
 * outright — guessing the century of an interview date is not this file's
 * business.
 */
export function parseSlotDate(raw: string): string | null {
  const text = cell(raw).replaceAll(/\s+/g, " ").trim();

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (iso !== null) return asDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (dayFirst !== null)
    return asDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));

  const named = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(text);
  if (named !== null) return asDate(Number(named[3]), monthNumber(named[2]), Number(named[1]));

  return null;
}

/**
 * `1pm`, `13:42`, `1:30 pm`, `2026-09-01 10:30` — the ways the column gets
 * filled in — read into the one shape the round can store.
 *
 * `"no-date"` is not a failure of the file: the file is fine, the ROUND has
 * no date yet, and the coordinator is told that instead of being told the
 * time is wrong.
 */
export function parseScheduledAt(
  raw: string,
  roundDate: string | null | undefined,
): { readonly value: string } | "unreadable" | "no-date" {
  const text = cell(raw);
  const match =
    /^(?:(\d{4})-(\d{1,2})-(\d{1,2})[T ])?(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(
      text.replaceAll(/\s+/g, " ").trim(),
    );
  if (match === null) return "unreadable";

  const [, year, month, day, rawHour = "", rawMinute, meridiem] = match;
  let hour = Number(rawHour);
  const minute = rawMinute === undefined ? 0 : Number(rawMinute);
  if (minute > 59) return "unreadable";

  if (meridiem === undefined) {
    // A bare number is not a time: `1` could be one o'clock or a typo, and a
    // guess here books an interview at the wrong hour.
    if (rawMinute === undefined) return "unreadable";
    if (hour > 23) return "unreadable";
  } else {
    if (hour < 1 || hour > 12) return "unreadable";
    const afternoon = meridiem.toLowerCase().startsWith("p");
    hour = afternoon ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour;
  }

  let date: string | null;
  if (year === undefined || month === undefined || day === undefined) {
    date = dayOf(roundDate);
    if (date === null) return "no-date";
  } else {
    if (!isRealDate(Number(year), Number(month), Number(day))) return "unreadable";
    date = `${year}-${pad(Number(month))}-${pad(Number(day))}`;
  }

  return { value: `${date}T${pad(hour)}:${pad(minute)}` };
}

/**
 * The header, reduced to the column NAMES: the `(dd-mm-yyyy)` hint is an
 * instruction to the reader, not part of the column, so a file that lost it
 * (or kept it) is the same file.
 */
const headerNames = (line: string): string =>
  line
    .replaceAll(INVISIBLE, "")
    .split(",")
    .map((column) =>
      cell(column)
        .toLowerCase()
        .replaceAll(/\(.*?\)/g, "")
        .replaceAll(/\s/g, ""),
    )
    .join(",");

export function parseMeetingSlotsCsv(
  text: string,
  context: MeetingSlotsContext = {},
): ParsedMeetingSlots {
  // split() always yields at least one element, so the first is a string —
  // stated with `slice(0, 1)` and a test-reachable fallback rather than an
  // unreachable `??` branch the coverage gate can never see taken.
  const lines = text.split(/\r?\n/);
  const header = headerNames(lines.slice(0, 1).join(""));
  const legacy = header === headerNames(LEGACY_HEADER);

  if (!legacy && header !== headerNames(MEETING_SLOTS_HEADER)) {
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
    const [rollNumber = "", meetingLink = "", third = "", fourth = ""] = line.split(",").map(cell);
    // The legacy file put the whole stamp in one column; the new one splits
    // it, which is what a coordinator filling in a spreadsheet expects.
    const dateCell = legacy ? "" : third;
    const timeCell = legacy ? third : fourth;

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

    // The date and the time are checked before the row is kept: a stamp
    // Postgres cannot store used to fail at WRITE time, where the only
    // wording available accused the student of not being in the round.
    let when: string | null = null;
    if (dateCell !== "" && timeCell === "") {
      problems.push(
        `Line ${lineNumber}: ${dateCell} has no time against it. Add the time (${TIME_HINT}), or clear the date to use the round's own time.`,
      );
      return;
    }
    if (dateCell !== "") {
      const day = parseSlotDate(dateCell);
      if (day === null) {
        problems.push(
          `Line ${lineNumber}: "${dateCell}" is not a date. Write it as dd-mm-yyyy (${DATE_HINT}).`,
        );
        return;
      }
      // `day` is a real date, so "no-date" cannot come back — one string
      // check covers every way the time can be unusable.
      const read = parseScheduledAt(timeCell, day);
      if (typeof read === "string") {
        problems.push(`Line ${lineNumber}: "${timeCell}" is not a time. ${TIME_ADVICE}`);
        return;
      }
      when = read.value;
    } else if (timeCell !== "") {
      const read = parseScheduledAt(timeCell, context.roundDate);
      if (read === "unreadable") {
        problems.push(`Line ${lineNumber}: "${timeCell}" is not a time. ${TIME_ADVICE}`);
        return;
      }
      if (read === "no-date") {
        problems.push(
          `Line ${lineNumber}: "${timeCell}" has no date against it. Fill in the date column (${DATE_HINT}), or set the round's date above.`,
        );
        return;
      }
      when = read.value;
    }

    slots.push({
      rollNumber,
      meetingLink,
      scheduledAt: when,
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
/**
 * A stored slot, written back into the two columns the file now carries — in
 * the format the header asks for, so a downloaded file can be re-uploaded.
 */
function splitDatetimeLocal(value: string | null): readonly [string, string] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  if (match === null) return ["", ""];
  const [, year = "", month = "", day = "", hour = "", minute = ""] = match;
  return [`${day}-${month}-${year}`, `${hour}:${minute}`];
}

export function buildMeetingSlotsTemplate(
  participants: readonly {
    readonly rollNumber: string;
    readonly meetingLink?: string | null;
    readonly scheduledAt?: string | null;
  }[],
): string {
  const rows = participants
    .filter((participant) => isRealRollNumber(participant.rollNumber))
    .map((participant) => {
      const [date, time] = splitDatetimeLocal(participant.scheduledAt ?? null);
      return `${cell(participant.rollNumber)},${participant.meetingLink ?? ""},${date},${time}`;
    });

  return [MEETING_SLOTS_HEADER, ...rows, ""].join("\n");
}
