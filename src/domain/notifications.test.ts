import { describe, expect, it } from "vitest";
import {
  cleanNotificationBody,
  condenseNotifications,
  extractNotificationMetadata,
  filterNotifications,
  formatRelativeTime,
  getNotificationCategory,
  isDocumentLink,
  linkifyBody,
  type NotificationItem,
  notificationCarriesOfferLetter,
  notificationLinkLabel,
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

  it("splits **bold** markers into bold segments", () => {
    expect(linkifyBody("Your **record** is ready.")).toEqual([
      { kind: "text", text: "Your " },
      { kind: "bold", text: "record" },
      { kind: "text", text: " is ready." },
    ]);
  });

  it("handles bold and URLs in the same body", () => {
    expect(linkifyBody("See **TCS** at https://tcs.example now.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "bold", text: "TCS" },
      { kind: "text", text: " at " },
      { kind: "link", text: "https://tcs.example" },
      { kind: "text", text: " now." },
    ]);
  });

  it("handles several bold runs", () => {
    expect(linkifyBody("**Name:** A124 • **Branch:** BCA")).toEqual([
      { kind: "bold", text: "Name:" },
      { kind: "text", text: " A124 • " },
      { kind: "bold", text: "Branch:" },
      { kind: "text", text: " BCA" },
    ]);
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

describe("getNotificationCategory", () => {
  it("categorises drive-related notifications", () => {
    expect(getNotificationCategory("drive_published")).toBe("drive");
    expect(getNotificationCategory("drive_deadline_reminder")).toBe("drive");
    expect(getNotificationCategory("application_confirmed")).toBe("drive");
  });

  it("categorises interview and round notifications", () => {
    expect(getNotificationCategory("round_scheduled")).toBe("interview");
    expect(getNotificationCategory("meeting_link")).toBe("interview");
    expect(getNotificationCategory("round_cleared")).toBe("interview");
    expect(getNotificationCategory("round_not_selected")).toBe("interview");
  });

  it("categorises offers", () => {
    expect(getNotificationCategory("offer")).toBe("offer");
    expect(getNotificationCategory("self_placement_decision")).toBe("offer");
  });

  it("categorises profile, srf and account notices", () => {
    expect(getNotificationCategory("srf_approved")).toBe("profile");
    expect(getNotificationCategory("srf_rejected")).toBe("profile");
    expect(getNotificationCategory("welcome")).toBe("profile");
  });
});

describe("extractNotificationMetadata", () => {
  it("extracts company, role, ctc and deadline from drive notifications", () => {
    const body = `A new drive is open.\n\n**Company:** Acme Corp\n**Role:** SDE\n**CTC Range:** 12 LPA\n**Application Deadline:** 15 Nov 2026`;
    const meta = extractNotificationMetadata(body);
    expect(meta.company).toBe("Acme Corp");
    expect(meta.role).toBe("SDE");
    expect(meta.ctc).toBe("12 LPA");
    expect(meta.deadline).toBe("15 Nov 2026");
  });

  it("extracts meeting link and venue", () => {
    const body = `Round 1. Join at: https://meet.google.com/abc-xyz. Venue: Hall A. Please report on time.`;
    const meta = extractNotificationMetadata(body);
    expect(meta.meetingLink).toBe("https://meet.google.com/abc-xyz");
    expect(meta.venue).toBe("Hall A");
  });
});

describe("cleanNotificationBody", () => {
  it("removes portal login reminders and Google sign-in boilerplate", () => {
    const body = `Drive details.\n\nLog in to the portal at https://pms.example to view full details.\n\nPlease sign in with your registered Google account to complete your profile.`;
    const cleaned = cleanNotificationBody(body);
    expect(cleaned).not.toMatch(/Log in to the portal/i);
    expect(cleaned).not.toMatch(/Please sign in with/i);
  });

  it("says the round triggers' legacy phrasing plainly", () => {
    const body =
      "Well done — you advance from Round 2 of Zoho. Soon you will get notified for round details. Please report on time.";
    expect(cleanNotificationBody(body)).toBe(
      "Well done! You cleared Round 2 of Zoho. We'll share the next round's details soon. Please be on time.",
    );
  });

  it("shortens the meeting-link lead-in without touching the URL", () => {
    expect(
      cleanNotificationBody(
        "Your meeting link: https://meet.google.com/xyz. Please report on time.",
      ),
    ).toBe("Meeting link: https://meet.google.com/xyz. Please be on time.");
  });
});

describe("notificationLinkLabel", () => {
  it("lets a short meeting URL print as itself", () => {
    expect(notificationLinkLabel("https://meet.google.com/xyz")).toBeNull();
    expect(isDocumentLink("https://meet.google.com/xyz")).toBe(false);
  });

  it("names a signed storage PDF instead of printing its token", () => {
    const url =
      "https://x.supabase.co/storage/v1/object/sign/job-descriptions/jd-1-offer%20letter.pdf?token=eyJhbGciOiJIUzI1NiJ9";
    expect(isDocumentLink(url)).toBe(true);
    expect(notificationLinkLabel(url)).toBe("View document");
  });

  it("names any other over-long URL", () => {
    expect(notificationLinkLabel(`https://example.com/${"a".repeat(60)}`)).toBe("Open link");
  });
});

describe("formatRelativeTime", () => {
  const base = new Date("2026-11-03T12:00:00Z").getTime();

  it("formats recent intervals cleanly without emojis", () => {
    expect(formatRelativeTime("2026-11-03T11:59:30Z", base)).toBe("Just now");
    expect(formatRelativeTime("2026-11-03T11:45:00Z", base)).toBe("15m ago");
    expect(formatRelativeTime("2026-11-03T09:00:00Z", base)).toBe("3h ago");
    expect(formatRelativeTime("2026-11-02T10:00:00Z", base)).toBe("Yesterday");
    expect(formatRelativeTime("2026-10-31T10:00:00Z", base)).toBe("3d ago");
  });
});
