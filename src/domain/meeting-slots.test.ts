import { describe, expect, it } from "vitest";
import {
  buildMeetingSlotsTemplate,
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
    expect(problems[0]).toMatch(/roll_number,meeting_link,scheduled_at/);
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
    expect(problems[0]).toMatch(/roll_number,meeting_link,scheduled_at/);
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
      "roll_number,meeting_link,scheduled_at\n" +
        "BCA2023156,,\n" +
        "124,https://meet.google.com/abc,2026-09-01T10:30\n",
    );
  });

  it("round-trips: what the template produces, the parser accepts", () => {
    const csv = buildMeetingSlotsTemplate([
      { rollNumber: "124", meetingLink: "https://meet.google.com/abc", scheduledAt: null },
    ]);
    const { slots, problems } = parseMeetingSlotsCsv(csv);

    expect(problems).toEqual([]);
    expect(slots[0]?.rollNumber).toBe("124");
  });

  it("still hands back the header when the round has nobody in it yet", () => {
    expect(buildMeetingSlotsTemplate([])).toBe("roll_number,meeting_link,scheduled_at\n");
  });

  it("leaves a roll number the database never recorded out — it could never match", () => {
    expect(
      buildMeetingSlotsTemplate([{ rollNumber: "—", meetingLink: null, scheduledAt: null }]),
    ).toBe("roll_number,meeting_link,scheduled_at\n");
  });
});
