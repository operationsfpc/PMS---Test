import { describe, expect, it } from "vitest";
import { parseMeetingSlotsCsv } from "./meeting-slots";

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
