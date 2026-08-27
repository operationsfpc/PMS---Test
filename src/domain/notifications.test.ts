import { describe, expect, it } from "vitest";
import {
  condenseNotifications,
  filterNotifications,
  linkifyBody,
  type NotificationItem,
  notificationCarriesOfferLetter,
  sortNotifications,
} from "./notifications";

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

  it("leaves two notes born in the same instant in their given order", () => {
    const sorted = sortNotifications([
      note({ id: "a", createdAt: "2026-08-19T10:00:00Z" }),
      note({ id: "b", createdAt: "2026-08-19T10:00:00Z" }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["a", "b"]);
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

/**
 * G3 (UAT 2026-08-20, Q6 answer a): the notifications page is reachable from
 * the sidebar and carries a full, FILTERABLE log. The filter is a read-state
 * lens over the same sorted list — it never reorders and never deletes.
 */
describe("filterNotifications", () => {
  const notes = [
    { id: "a", createdAt: "2026-08-20T10:00:00Z", read: false },
    { id: "b", createdAt: "2026-08-19T10:00:00Z", read: true },
    { id: "c", createdAt: "2026-08-18T10:00:00Z", read: false },
  ];

  it("shows everything under 'all'", () => {
    expect(filterNotifications(notes, "all").map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("shows only unread under 'unread'", () => {
    expect(filterNotifications(notes, "unread").map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("shows only read under 'read'", () => {
    expect(filterNotifications(notes, "read").map((n) => n.id)).toEqual(["b"]);
  });
});

/**
 * Spec C (2026-08-21, approved "go" 2026-08-24): bodies like
 * "Join at: https://meet.google.com/xyz" rendered as dead text. The split is
 * pure so both renderers (notifications page, dashboard panel) agree.
 */
describe("linkifyBody", () => {
  it("splits text and URLs", () => {
    expect(linkifyBody("Join at: https://meet.google.com/xyz now")).toEqual([
      { kind: "text", text: "Join at: " },
      { kind: "link", text: "https://meet.google.com/xyz" },
      { kind: "text", text: " now" },
    ]);
  });

  it("keeps trailing punctuation out of the link, so it does not 404", () => {
    expect(linkifyBody("See https://fpc.workers.dev/.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "https://fpc.workers.dev/" },
      { kind: "text", text: "." },
    ]);
  });

  it("returns plain text untouched, as one segment", () => {
    expect(linkifyBody("You are shortlisted.")).toEqual([
      { kind: "text", text: "You are shortlisted." },
    ]);
  });

  it("handles several links and http as well as https", () => {
    const segments = linkifyBody("A http://a.example and B https://b.example");
    expect(segments.filter((s) => s.kind === "link").map((s) => s.text)).toEqual([
      "http://a.example",
      "https://b.example",
    ]);
  });

  it("returns nothing for an empty body", () => {
    expect(linkifyBody("")).toEqual([]);
  });
});

describe("linkifyBody — a body that IS a link", () => {
  it("starts with the link when the body does", () => {
    expect(linkifyBody("https://a.example rest")).toEqual([
      { kind: "link", text: "https://a.example" },
      { kind: "text", text: " rest" },
    ]);
  });
});

/**
 * UAT 2026-08-27 — `docs/inbox/WhatsApp Image 2026-08-27 at 18.18.49 (1).jpeg`:
 * "Congratulations — XYZ has made you an internship offer." and nowhere to
 * open the offer letter the CPC had attached. 0062 always intended the student
 * to see it ("staff-who-can-read-the-offer + the student"); no student screen
 * ever read the column.
 */
describe("notificationCarriesOfferLetter", () => {
  it("is true for the offer notification — the one the letter belongs to", () => {
    expect(notificationCarriesOfferLetter("offer")).toBe(true);
  });

  /**
   * A student holding an offer from a drive is still sent round schedules for
   * it. Hanging the letter off every notification for that drive would put
   * "View offer letter" under "You cleared Round 3", which is a different
   * message wearing the offer's clothes.
   */
  it("is false for every other kind, including ones about the same drive", () => {
    expect(notificationCarriesOfferLetter("round_scheduled")).toBe(false);
    expect(notificationCarriesOfferLetter("round_cleared")).toBe(false);
    expect(notificationCarriesOfferLetter("shortlisted")).toBe(false);
    expect(notificationCarriesOfferLetter("meeting_link")).toBe(false);
    expect(notificationCarriesOfferLetter("")).toBe(false);
  });
});
