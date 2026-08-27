import { describe, expect, it } from "vitest";
import {
  buildMeetingSlotsTemplate,
  MEETING_SLOTS_HEADER,
  matchMeetingSlots,
  normaliseRollNumber,
  parseMeetingSlotsCsv,
} from "./meeting-slots";

/**
 * F5 (UAT 2026-08-19): "Allow a meeting link to be sent per student, or via
 * bulk upload with individual time slots per student."
 *
 * The CSV: roll_number, meeting_link, scheduled_at — header row required, so
 * a file with the columns swapped is refused rather than silently mis-read.
 */
describe("parseMeetingSlotsCsv", () => {
  const HEADER = "roll_number,meeting_link,scheduled_at";

  it("parses a well-formed file", () => {
    const { slots, problems } = parseMeetingSlotsCsv(
      `${HEADER}\n21CSE1042,https://meet.google.com/abc,2026-09-01T10:30\n21CSE9001,https://meet.google.com/def,2026-09-01T11:00`,
    );

    expect(problems).toEqual([]);
    expect(slots).toEqual([
      {
        rollNumber: "21CSE1042",
        meetingLink: "https://meet.google.com/abc",
        scheduledAt: "2026-09-01T10:30",
      },
      {
        rollNumber: "21CSE9001",
        meetingLink: "https://meet.google.com/def",
        scheduledAt: "2026-09-01T11:00",
      },
    ]);
  });

  it("refuses a file whose header is not the expected one", () => {
    const { slots, problems } = parseMeetingSlotsCsv("name,link\nPriya,https://x");
    expect(slots).toEqual([]);
    expect(problems[0]).toContain(MEETING_SLOTS_HEADER);
  });

  it("allows an empty time — the link may be all the recruiter gave", () => {
    const { slots, problems } = parseMeetingSlotsCsv(
      `${HEADER}\n21CSE1042,https://meet.google.com/abc,`,
    );
    expect(problems).toEqual([]);
    expect(slots[0]?.scheduledAt).toBeNull();
  });

  it("names the line that carries no roll number instead of dropping it silently", () => {
    const { problems } = parseMeetingSlotsCsv(`${HEADER}\n,https://meet.google.com/abc,`);
    expect(problems[0]).toMatch(/line 2/i);
  });

  it("names the line whose link is not a URL", () => {
    const { problems } = parseMeetingSlotsCsv(`${HEADER}\n21CSE1042,meet please,`);
    expect(problems[0]).toMatch(/line 2/i);
    expect(problems[0]).toMatch(/link/i);
  });

  it("skips blank lines rather than reporting them", () => {
    const { slots, problems } = parseMeetingSlotsCsv(
      `${HEADER}\n21CSE1042,https://meet.google.com/abc,\n\n`,
    );
    expect(problems).toEqual([]);
    expect(slots).toHaveLength(1);
  });
});

/** An empty file is a wrong header, reported the same way. */
describe("parseMeetingSlotsCsv — an empty file", () => {
  it("refuses it, naming the expected header", () => {
    const { slots, problems } = parseMeetingSlotsCsv("");
    expect(slots).toEqual([]);
    expect(problems[0]).toContain(MEETING_SLOTS_HEADER);
  });
});

/**
 * UAT 2026-08-26 (live): the upload answered "No participant in this round
 * carries these roll numbers: 124, BCA2023156" while the screen underneath
 * listed exactly those two roll numbers. Whatever the cause, the screen and
 * the matcher must not be able to disagree — so matching is done here,
 * against the participants the screen is showing, and roll numbers are
 * compared as people write them, not as bytes.
 */
describe("normaliseRollNumber", () => {
  it("ignores case, padding and stray spacing", () => {
    expect(normaliseRollNumber(" bca2023156 ")).toBe("BCA2023156");
    expect(normaliseRollNumber("BCA 2023156")).toBe("BCA2023156");
  });

  it("strips the quotes and the byte-order mark Excel leaves behind", () => {
    expect(normaliseRollNumber('"124"')).toBe("124");
    expect(normaliseRollNumber("\uFEFF124")).toBe("124");
    expect(normaliseRollNumber("\u200b124")).toBe("124");
  });

  it("survives a missing value without throwing", () => {
    expect(normaliseRollNumber("")).toBe("");
  });
});

describe("parseMeetingSlotsCsv — files that came out of Excel", () => {
  const HEADER = "roll_number,meeting_link,scheduled_at";

  it("accepts a header carrying a byte-order mark", () => {
    const { problems, slots } = parseMeetingSlotsCsv(
      `\uFEFF${HEADER}\n124,https://meet.google.com/abc,`,
    );
    expect(problems).toEqual([]);
    expect(slots).toHaveLength(1);
  });

  it("accepts quoted cells", () => {
    const { problems, slots } = parseMeetingSlotsCsv(
      `"roll_number","meeting_link","scheduled_at"\n"124","https://meet.google.com/abc","2026-09-01T10:30"`,
    );
    expect(problems).toEqual([]);
    expect(slots[0]).toEqual({
      rollNumber: "124",
      meetingLink: "https://meet.google.com/abc",
      scheduledAt: "2026-09-01T10:30",
    });
  });

  it("names a roll number listed twice rather than quietly keeping the last", () => {
    const { problems } = parseMeetingSlotsCsv(
      `${HEADER}\n124,https://meet.google.com/abc,\n124,https://meet.google.com/def,`,
    );
    expect(problems[0]).toMatch(/124/);
    expect(problems[0]).toMatch(/twice|more than once|duplicate/i);
  });
});

describe("matchMeetingSlots", () => {
  const PARTICIPANTS = [
    { applicationId: "app-1", rollNumber: "BCA2023156" },
    { applicationId: "app-2", rollNumber: "124" },
  ];

  it("matches the roll numbers the screen is showing", () => {
    const { assignments, unmatched } = matchMeetingSlots(
      [
        { rollNumber: "bca2023156", meetingLink: "https://meet.google.com/abc", scheduledAt: null },
        {
          rollNumber: " 124 ",
          meetingLink: "https://meet.google.com/def",
          scheduledAt: "2026-09-01T10:30",
        },
      ],
      PARTICIPANTS,
    );

    expect(unmatched).toEqual([]);
    expect(assignments).toEqual([
      {
        applicationId: "app-1",
        rollNumber: "bca2023156",
        meetingLink: "https://meet.google.com/abc",
        scheduledAt: null,
      },
      {
        applicationId: "app-2",
        rollNumber: " 124 ",
        meetingLink: "https://meet.google.com/def",
        scheduledAt: "2026-09-01T10:30",
      },
    ]);
  });

  it("reports a roll number nobody in the round carries, as written in the file", () => {
    const { assignments, unmatched } = matchMeetingSlots(
      [{ rollNumber: "21CSE9999", meetingLink: "https://meet.google.com/x", scheduledAt: null }],
      PARTICIPANTS,
    );

    expect(assignments).toEqual([]);
    expect(unmatched).toEqual(["21CSE9999"]);
  });

  it("never matches a participant whose roll number is missing on an empty cell", () => {
    const { unmatched } = matchMeetingSlots(
      [{ rollNumber: "—", meetingLink: "https://meet.google.com/x", scheduledAt: null }],
      [{ applicationId: "app-3", rollNumber: "—" }],
    );
    expect(unmatched).toEqual(["—"]);
  });
});

/**
 * UAT 2026-08-27 (live): a file whose `scheduled_at` column read `1pm` was
 * answered with "No participant in this round carries these roll numbers:
 * BCA2023156, 124. 0 links assigned." — both roll numbers were in the round.
 * The time was the problem; the message blamed the students.
 *
 * The time column is now judged HERE, before anything is sent, and what
 * leaves the parser is always a `datetime-local` value the round can store.
 */
describe("parseMeetingSlotsCsv — the time column", () => {
  const HEADER = "roll_number,meeting_link,scheduled_at";
  const row = (time: string) => `${HEADER}\n124,https://meet.google.com/abc,${time}`;
  const ROUND_DAY = { roundDate: "2026-08-27" };

  it("still reads the three-column file that was downloaded before the date column existed", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("2026-09-01T10:30"), ROUND_DAY);
    expect(problems).toEqual([]);
    expect(slots[0]?.scheduledAt).toBe("2026-09-01T10:30");
  });

  it("reads a clock time against the round's own day", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("1pm"), ROUND_DAY);
    expect(problems).toEqual([]);
    expect(slots[0]?.scheduledAt).toBe("2026-08-27T13:00");
  });

  it("reads the ways people write a clock time", () => {
    const at = (time: string) => parseMeetingSlotsCsv(row(time), ROUND_DAY).slots[0]?.scheduledAt;
    expect(at("1 PM")).toBe("2026-08-27T13:00");
    expect(at("9am")).toBe("2026-08-27T09:00");
    expect(at("1:30 pm")).toBe("2026-08-27T13:30");
    expect(at("12am")).toBe("2026-08-27T00:00");
    expect(at("12pm")).toBe("2026-08-27T12:00");
    expect(at("09:05")).toBe("2026-08-27T09:05");
    expect(at("9:05")).toBe("2026-08-27T09:05");
    expect(at("13:42")).toBe("2026-08-27T13:42");
  });

  it("reads a full date and time, with a space or a T between them", () => {
    const at = (time: string) => parseMeetingSlotsCsv(row(time), ROUND_DAY).slots[0]?.scheduledAt;
    expect(at("2026-09-01T10:30")).toBe("2026-09-01T10:30");
    expect(at("2026-09-01 10:30")).toBe("2026-09-01T10:30");
    expect(at("2026-09-01 10:30:00")).toBe("2026-09-01T10:30");
    expect(at("2026-09-01 1:30 pm")).toBe("2026-09-01T13:30");
  });

  it("names the line whose time cannot be read, and says what to write", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("after lunch"), ROUND_DAY);
    expect(slots).toEqual([]);
    expect(problems[0]).toMatch(/line 2/i);
    expect(problems[0]).toMatch(/after lunch/);
    expect(problems[0]).toMatch(/13:00|1:00 pm/);
  });

  it("refuses a clock that does not exist rather than rolling it over", () => {
    expect(parseMeetingSlotsCsv(row("25:00"), ROUND_DAY).problems[0]).toMatch(/line 2/i);
    expect(parseMeetingSlotsCsv(row("10:75"), ROUND_DAY).problems[0]).toMatch(/line 2/i);
    expect(parseMeetingSlotsCsv(row("13pm"), ROUND_DAY).problems[0]).toMatch(/line 2/i);
    // A bare number is not a time: 13 could be an hour or a typo, and a guess
    // books an interview at the wrong hour.
    expect(parseMeetingSlotsCsv(row("13"), ROUND_DAY).problems[0]).toMatch(/line 2/i);
    expect(parseMeetingSlotsCsv(row("2026-02-30 10:00"), ROUND_DAY).problems[0]).toMatch(/line 2/i);
  });

  it("asks for the round's date when a time on its own has no day to sit on", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("1pm"));
    expect(slots).toEqual([]);
    expect(problems[0]).toMatch(/line 2/i);
    expect(problems[0]).toMatch(/date/i);
  });

  it("still accepts a blank time, and still refuses a bad link first", () => {
    expect(parseMeetingSlotsCsv(row(""), ROUND_DAY).slots[0]?.scheduledAt).toBeNull();
    expect(parseMeetingSlotsCsv(`${HEADER}\n124,meet please,1pm`, ROUND_DAY).problems[0]).toMatch(
      /link/i,
    );
  });
});

/**
 * Karthik, 2026-08-27: "in addition to roll number and link, we also need a
 * date and time — suggest a format in the header of the CSV template."
 *
 * So the date is its own column, and the header carries the format it wants,
 * because the header is the only instruction the file can carry into Excel.
 * The column is still READ generously: a coordinator who writes 27/08/2026 or
 * 2026-08-27 has not made a mistake worth a rejection.
 */
describe("parseMeetingSlotsCsv — the date column", () => {
  const HEADER = MEETING_SLOTS_HEADER;
  const row = (date: string, time: string) =>
    `${HEADER}\n124,https://meet.google.com/abc,${date},${time}`;

  it("announces the format it wants in the header itself", () => {
    expect(MEETING_SLOTS_HEADER).toBe("roll_number,meeting_link,date (dd-mm-yyyy),time (hh:mm)");
  });

  it("reads the date and the time as separate columns", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("01-09-2026", "10:30"));
    expect(problems).toEqual([]);
    expect(slots[0]?.scheduledAt).toBe("2026-09-01T10:30");
  });

  it("reads the day-first date however it is punctuated, and the ISO one too", () => {
    const at = (date: string) => parseMeetingSlotsCsv(row(date, "10:30")).slots[0]?.scheduledAt;
    expect(at("01-09-2026")).toBe("2026-09-01T10:30");
    expect(at("1-9-2026")).toBe("2026-09-01T10:30");
    expect(at("01/09/2026")).toBe("2026-09-01T10:30");
    expect(at("01.09.2026")).toBe("2026-09-01T10:30");
    expect(at("2026-09-01")).toBe("2026-09-01T10:30");
    expect(at("1 Sep 2026")).toBe("2026-09-01T10:30");
    expect(at("1 September 2026")).toBe("2026-09-01T10:30");
  });

  it("accepts the time in either clock", () => {
    const at = (time: string) =>
      parseMeetingSlotsCsv(row("01-09-2026", time)).slots[0]?.scheduledAt;
    expect(at("13:30")).toBe("2026-09-01T13:30");
    expect(at("1:30 pm")).toBe("2026-09-01T13:30");
    expect(at("1pm")).toBe("2026-09-01T13:00");
  });

  it("falls back to the round's own day when only a time is given", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("", "1pm"), {
      roundDate: "2026-08-27",
    });
    expect(problems).toEqual([]);
    expect(slots[0]?.scheduledAt).toBe("2026-08-27T13:00");
  });

  it("leaves the slot unset when both columns are blank", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("", ""));
    expect(problems).toEqual([]);
    expect(slots[0]?.scheduledAt).toBeNull();
  });

  it("names the line whose date cannot be read, and repeats the format", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("next Tuesday", "10:30"));
    expect(slots).toEqual([]);
    expect(problems[0]).toMatch(/line 2/i);
    expect(problems[0]).toMatch(/next Tuesday/);
    expect(problems[0]).toMatch(/dd-mm-yyyy/i);
  });

  it("refuses a day the calendar does not have", () => {
    const bad = (date: string) => parseMeetingSlotsCsv(row(date, "10:30")).problems[0];
    expect(bad("30-02-2026")).toMatch(/line 2/i);
    expect(bad("01-13-2026")).toMatch(/line 2/i);
    expect(bad("01-00-2026")).toMatch(/line 2/i);
    expect(bad("00-09-2026")).toMatch(/line 2/i);
  });

  it("knows which Februaries have a 29th", () => {
    const day = (date: string) => parseMeetingSlotsCsv(row(date, "10:30")).slots[0]?.scheduledAt;
    expect(day("29-02-2024")).toBe("2024-02-29T10:30");
    expect(day("29-02-2000")).toBe("2000-02-29T10:30");
    expect(day("29-02-2026")).toBeUndefined();
    expect(day("29-02-1900")).toBeUndefined();
  });

  it("names the line whose time cannot be read even when its date is fine", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("01-09-2026", "after lunch"));
    expect(slots).toEqual([]);
    expect(problems[0]).toMatch(/line 2/i);
    expect(problems[0]).toMatch(/after lunch/);
  });

  it("refuses a date whose month is a word it does not know", () => {
    expect(parseMeetingSlotsCsv(row("1 Smarch 2026", "10:30")).problems[0]).toMatch(/line 2/i);
    expect(parseMeetingSlotsCsv(row("1 Se 2026", "10:30")).problems[0]).toMatch(/line 2/i);
  });

  it("refuses a two-digit year rather than guessing the century", () => {
    expect(parseMeetingSlotsCsv(row("01-09-26", "10:30")).problems[0]).toMatch(/line 2/i);
  });

  it("asks for the time when a date was given without one", () => {
    const { slots, problems } = parseMeetingSlotsCsv(row("01-09-2026", ""));
    expect(slots).toEqual([]);
    expect(problems[0]).toMatch(/line 2/i);
    expect(problems[0]).toMatch(/time/i);
  });
});

describe("buildMeetingSlotsTemplate", () => {
  it("is a file the coordinator can fill in and upload back unedited", () => {
    const csv = buildMeetingSlotsTemplate([
      { rollNumber: "BCA2023156", meetingLink: null, scheduledAt: null },
      {
        rollNumber: "124",
        meetingLink: "https://meet.google.com/abc",
        scheduledAt: "2026-09-01T10:30",
      },
    ]);

    expect(csv).toBe(
      `${MEETING_SLOTS_HEADER}\n` +
        "BCA2023156,,,\n" +
        "124,https://meet.google.com/abc,01-09-2026,10:30\n",
    );
  });

  it("round-trips: what the template produces, the parser accepts", () => {
    const csv = buildMeetingSlotsTemplate([
      {
        rollNumber: "124",
        meetingLink: "https://meet.google.com/abc",
        scheduledAt: "2026-09-01T10:30",
      },
    ]);
    const { slots, problems } = parseMeetingSlotsCsv(csv);

    expect(problems).toEqual([]);
    expect(slots[0]?.rollNumber).toBe("124");
    expect(slots[0]?.scheduledAt).toBe("2026-09-01T10:30");
  });

  it("still hands back the header when the round has nobody in it yet", () => {
    expect(buildMeetingSlotsTemplate([])).toBe(`${MEETING_SLOTS_HEADER}\n`);
  });

  it("leaves a roll number the database never recorded out — it could never match", () => {
    expect(
      buildMeetingSlotsTemplate([{ rollNumber: "—", meetingLink: null, scheduledAt: null }]),
    ).toBe(`${MEETING_SLOTS_HEADER}\n`);
  });
});
