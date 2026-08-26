import { describe, expect, it } from "vitest";
import {
  compareNewestFirst,
  compareOldestFirst,
  type DriveOrder,
  daysPending,
  describeRaisedOn,
  isExpiredDrive,
  isPendingTooLong,
  orderDrives,
  PENDING_FLAG_DAYS,
  partitionExpired,
} from "./drive-aging";

/**
 * UAT 2026-08-20, G1: the Yet-to-publish list carried no date at all, so
 * nobody could tell how long a submission had been sitting. These rules give
 * every drive an age, a flag when it has waited too long, and an "expired"
 * verdict once its application deadline has passed.
 */
const now = new Date("2026-08-20T12:00:00+05:30");

describe("daysPending", () => {
  it("counts whole days since the drive was raised", () => {
    expect(daysPending("2026-08-15T10:00:00+05:30", now)).toBe(5);
  });

  it("is zero on the day it was raised", () => {
    expect(daysPending("2026-08-20T09:00:00+05:30", now)).toBe(0);
  });

  it("is null when the raised date was never recorded", () => {
    expect(daysPending(null, now)).toBeNull();
  });
});

describe("isPendingTooLong", () => {
  it(`flags a drive older than ${PENDING_FLAG_DAYS} days`, () => {
    expect(isPendingTooLong("2026-08-16T10:00:00+05:30", now)).toBe(true);
  });

  it(`does not flag one at exactly ${PENDING_FLAG_DAYS} days`, () => {
    // The threshold is "sitting too long", not "sitting a while": the flag
    // fires the day AFTER the threshold, so a three-day-old drive is not
    // already wearing a reproach.
    expect(isPendingTooLong("2026-08-17T12:00:00+05:30", now)).toBe(false);
  });

  it("never flags a drive with no recorded date", () => {
    expect(isPendingTooLong(null, now)).toBe(false);
  });
});

describe("describeRaisedOn", () => {
  it("names the raised date in Asia/Kolkata", () => {
    expect(describeRaisedOn("2026-08-18T20:00:00Z")).toBe("Raised on 19 Aug 2026");
  });

  it("is null when there is nothing to describe", () => {
    expect(describeRaisedOn(null)).toBeNull();
  });
});

describe("compareOldestFirst", () => {
  it("puts the oldest submission first — the natural order for clearing a backlog", () => {
    const drives = [
      { createdAt: "2026-08-19T10:00:00Z" },
      { createdAt: "2026-08-15T10:00:00Z" },
      { createdAt: null },
      { createdAt: "2026-08-17T10:00:00Z" },
    ];
    const sorted = [...drives].sort(compareOldestFirst);
    expect(sorted.map((d) => d.createdAt)).toEqual([
      "2026-08-15T10:00:00Z",
      "2026-08-17T10:00:00Z",
      "2026-08-19T10:00:00Z",
      // An undated drive cannot claim to be the oldest; it sinks.
      null,
    ]);
  });
});

describe("isExpiredDrive", () => {
  it("expires a live drive whose application deadline has passed", () => {
    expect(
      isExpiredDrive({ status: "live", applicationEnd: "2026-08-10T18:00:00+05:30" }, now),
    ).toBe(true);
  });

  it("expires an applications-closed drive past its deadline", () => {
    expect(
      isExpiredDrive(
        { status: "applications_closed", applicationEnd: "2026-08-10T18:00:00+05:30" },
        now,
      ),
    ).toBe(true);
  });

  it("does not expire a drive whose window is still open", () => {
    expect(
      isExpiredDrive({ status: "live", applicationEnd: "2026-08-25T18:00:00+05:30" }, now),
    ).toBe(false);
  });

  it("does not expire a drive with no deadline at all", () => {
    expect(isExpiredDrive({ status: "approved", applicationEnd: null }, now)).toBe(false);
  });

  it("never expires a drive already in rounds — the deadline passing is what STARTED the rounds", () => {
    expect(
      isExpiredDrive({ status: "in_rounds", applicationEnd: "2026-08-10T18:00:00+05:30" }, now),
    ).toBe(false);
  });

  it("never expires a completed or rejected drive — they are terminal, not stale", () => {
    expect(
      isExpiredDrive({ status: "completed", applicationEnd: "2026-08-10T18:00:00+05:30" }, now),
    ).toBe(false);
    expect(
      isExpiredDrive({ status: "rejected", applicationEnd: "2026-08-10T18:00:00+05:30" }, now),
    ).toBe(false);
  });
});

describe("partitionExpired", () => {
  it("splits a list into active and expired, preserving order", () => {
    const drives = [
      { id: "a", status: "live", applicationEnd: "2026-08-25T18:00:00+05:30" },
      { id: "b", status: "live", applicationEnd: "2026-08-10T18:00:00+05:30" },
      { id: "c", status: "applications_closed", applicationEnd: "2026-08-01T18:00:00+05:30" },
      { id: "d", status: "approved", applicationEnd: null },
    ] as const;

    const { active, expired } = partitionExpired(drives, now);
    expect(active.map((d) => d.id)).toEqual(["a", "d"]);
    expect(expired.map((d) => d.id)).toEqual(["b", "c"]);
  });
});

describe("malformed dates are answered honestly, never with NaN", () => {
  it("daysPending refuses to count from garbage", () => {
    expect(daysPending("not-a-date", now)).toBeNull();
  });

  it("describeRaisedOn says nothing about garbage", () => {
    expect(describeRaisedOn("not-a-date")).toBeNull();
  });

  it("compareOldestFirst treats two undated drives as equals, and sinks only the undated one", () => {
    expect(compareOldestFirst({ createdAt: null }, { createdAt: null })).toBe(0);
    expect(compareOldestFirst({ createdAt: "2026-08-01" }, { createdAt: null })).toBe(-1);
    expect(compareOldestFirst({ createdAt: "2026-08-01" }, { createdAt: "2026-08-01" })).toBe(0);
  });
});

/**
 * 2026-08-26 (Karthik): "change the default sort order to Newest First across
 * all sections."
 *
 * Newest-first is NOT oldest-first reversed. Reversing floats the undated
 * drives to the TOP - `compareOldestFirst` sinks them deliberately, because a
 * drive with no recorded date cannot claim to be the oldest, and reversing
 * that judgement makes it claim to be the newest instead. With newest-first
 * now the default everywhere, that would have put every undated drive at the
 * head of every list on the system.
 */
describe("compareNewestFirst", () => {
  it("puts the newest submission first and still sinks the undated", () => {
    const drives = [
      { createdAt: "2026-08-15T10:00:00Z" },
      { createdAt: null },
      { createdAt: "2026-08-19T10:00:00Z" },
      { createdAt: "2026-08-17T10:00:00Z" },
    ];
    const sorted = [...drives].sort(compareNewestFirst);
    expect(sorted.map((d) => d.createdAt)).toEqual([
      "2026-08-19T10:00:00Z",
      "2026-08-17T10:00:00Z",
      "2026-08-15T10:00:00Z",
      null,
    ]);
  });

  it("treats two undated drives as equals", () => {
    expect(compareNewestFirst({ createdAt: null }, { createdAt: null })).toBe(0);
    expect(compareNewestFirst({ createdAt: "2026-08-01" }, { createdAt: null })).toBe(-1);
    expect(compareNewestFirst({ createdAt: "2026-08-01" }, { createdAt: "2026-08-01" })).toBe(0);
  });
});

describe("orderDrives", () => {
  const drives = [
    { createdAt: "2026-08-15T10:00:00Z", id: "b" },
    { createdAt: null, id: "undated" },
    { createdAt: "2026-08-19T10:00:00Z", id: "c" },
  ];

  it.each([
    ["newest", ["c", "b", "undated"]],
    ["oldest", ["b", "c", "undated"]],
  ] as [DriveOrder, string[]][])("orders %s first", (order, expected) => {
    expect(orderDrives(drives, order).map((d) => d.id)).toEqual(expected);
  });

  it("does not disturb the list it was given", () => {
    const original = [...drives];
    orderDrives(drives, "newest");
    expect(drives).toEqual(original);
  });
});
