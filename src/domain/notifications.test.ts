import { describe, expect, it } from "vitest";
import { condenseNotifications, type NotificationItem, sortNotifications } from "./notifications";

/**
 * E1/E2 (UAT 2026-08-19): "Show the top 3–5 notifications with a Read More
 * link", and "marking a notification as read should move it down the list
 * rather than permanently deleting it".
 *
 * The testers reported new notifications "replacing" old ones (E4). The data
 * layer stacks correctly — what they saw was a panel with no order and no
 * boundary, where a new arrival visually displaced everything. Order and a
 * stated boundary are the fix.
 */

const note = (
  over: Partial<NotificationItem> & Pick<NotificationItem, "id">,
): NotificationItem => ({
  createdAt: "2026-08-19T10:00:00Z",
  read: false,
  ...over,
});

describe("sortNotifications", () => {
  it("puts unread before read, whatever their ages", () => {
    const sorted = sortNotifications([
      note({ id: "old-unread", createdAt: "2026-08-01T00:00:00Z", read: false }),
      note({ id: "new-read", createdAt: "2026-08-19T00:00:00Z", read: true }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["old-unread", "new-read"]);
  });

  it("orders newest first within the unread", () => {
    const sorted = sortNotifications([
      note({ id: "older", createdAt: "2026-08-10T00:00:00Z" }),
      note({ id: "newer", createdAt: "2026-08-19T00:00:00Z" }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["newer", "older"]);
  });

  it("orders newest first within the read as well", () => {
    const sorted = sortNotifications([
      note({ id: "read-old", createdAt: "2026-08-01T00:00:00Z", read: true }),
      note({ id: "read-new", createdAt: "2026-08-15T00:00:00Z", read: true }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["read-new", "read-old"]);
  });

  it("marking a note read sinks it below the unread — E2, nothing is deleted", () => {
    const a = note({ id: "a", createdAt: "2026-08-19T00:00:00Z" });
    const b = note({ id: "b", createdAt: "2026-08-18T00:00:00Z" });
    const after = sortNotifications([{ ...a, read: true }, b]);
    expect(after.map((n) => n.id)).toEqual(["b", "a"]);
    expect(after).toHaveLength(2);
  });

  it("does not mutate its input", () => {
    const input = [note({ id: "z", read: true }), note({ id: "a" })];
    sortNotifications(input);
    expect(input.map((n) => n.id)).toEqual(["z", "a"]);
  });
});

describe("condenseNotifications", () => {
  const five = [
    note({ id: "1", createdAt: "2026-08-19T05:00:00Z" }),
    note({ id: "2", createdAt: "2026-08-19T04:00:00Z" }),
    note({ id: "3", createdAt: "2026-08-19T03:00:00Z", read: true }),
    note({ id: "4", createdAt: "2026-08-19T02:00:00Z", read: true }),
    note({ id: "5", createdAt: "2026-08-19T01:00:00Z", read: true }),
  ];

  it("shows at most the limit, sorted", () => {
    const { shown, hidden } = condenseNotifications(five, 3);
    expect(shown.map((n) => n.id)).toEqual(["1", "2", "3"]);
    expect(hidden).toBe(2);
  });

  it("shows everything when there are fewer than the limit", () => {
    const { shown, hidden } = condenseNotifications(five.slice(0, 2), 3);
    expect(shown).toHaveLength(2);
    expect(hidden).toBe(0);
  });

  it("a new arrival STACKS above the rest — nothing disappears from the total (E4)", () => {
    const arrived = [note({ id: "fresh", createdAt: "2026-08-19T09:00:00Z" }), ...five];
    const { shown, hidden } = condenseNotifications(arrived, 3);
    expect(shown[0]?.id).toBe("fresh");
    expect(shown.length + hidden).toBe(arrived.length);
  });
});
