// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { NotificationsPage, type NotificationsView } from "./notifications-page";

/**
 * E1 (UAT 2026-08-19): the "Read More" destination — every notification the
 * student has, unread first, dated, nothing ever deleted by reading it.
 */
const NOTES = [
  {
    id: "n1",
    kind: "shortlisted",
    title: "You are shortlisted for Zoho",
    body: "Round 1 is next.",
    createdAt: "2026-08-10T10:00:00Z",
    read: true,
  },
  {
    id: "n2",
    kind: "round_cleared",
    title: "You cleared Round 1 of Zoho",
    body: "Well done.",
    createdAt: "2026-08-12T10:00:00Z",
    read: false,
  },
];

const view = (over: Partial<NotificationsView> = {}): NotificationsView => ({
  notifications: async () => NOTES,
  markRead: async () => {},
  ...over,
});

const show = (v: NotificationsView = view()) =>
  render(
    <MemoryRouter>
      <NotificationsPage view={v} />
    </MemoryRouter>,
  );

describe("NotificationsPage", () => {
  it("lists every notification, unread first, each with its date", async () => {
    show();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toMatch(/cleared round 1/i);
    expect(items[0]?.textContent).toMatch(/12 Aug 2026/);
    expect(items[1]?.textContent).toMatch(/shortlisted for zoho/i);
    expect(items[1]?.textContent).toMatch(/10 Aug 2026/);
  });

  it("marks one read on request and keeps it on the page", async () => {
    const markRead = vi.fn();
    const user = userEvent.setup();
    show(view({ markRead }));

    await user.click(await screen.findByRole("button", { name: /mark read/i }));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith("n2"));
    expect(screen.getByText(/you cleared round 1 of zoho/i)).toBeDefined();
  });

  it("says so plainly when there are none", async () => {
    show(view({ notifications: async () => [] }));

    expect(await screen.findByText(/no notifications yet/i)).toBeDefined();
  });
});

/**
 * G3 (UAT 2026-08-20): the log is FILTERABLE — a lens on read state, never a
 * deletion. The filter buttons say what they hold.
 */
describe("filtering the log", () => {
  it("narrows to unread on request", async () => {
    const user = userEvent.setup();
    show();

    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("radio", { name: /unread/i }));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toMatch(/cleared round 1/i);
  });

  it("narrows to read on request, and back to all", async () => {
    const user = userEvent.setup();
    show();

    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("radio", { name: /^read$/i }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")[0]?.textContent).toMatch(/shortlisted for zoho/i);

    await user.click(screen.getByRole("radio", { name: /^all$/i }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

/** Spec C (approved 2026-08-24): URLs in bodies are links, not dead text. */
describe("links in notification bodies", () => {
  it("renders a URL as a clickable link, opening in a new tab", async () => {
    render(
      <MemoryRouter>
        <NotificationsPage
          view={{
            notifications: async () => [
              {
                id: "n1",
                kind: "round_scheduled",
                title: "Round scheduled",
                body: "Join at: https://meet.google.com/xyz today",
                createdAt: "2026-08-24T09:00:00Z",
                read: false,
              },
            ],
            markRead: async () => undefined,
          }}
        />
      </MemoryRouter>,
    );

    const link = await screen.findByRole("link", { name: "https://meet.google.com/xyz" });
    expect(link.getAttribute("href")).toBe("https://meet.google.com/xyz");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

/**
 * 🔴 UAT 2026-08-27 — `docs/inbox/WhatsApp Image 2026-08-27 at 18.18.49 (1).jpeg`:
 * "Congratulations — XYZ has made you an internship offer." with no way to
 * open the offer letter the CPC had attached.
 */
describe("the offer letter, under the message it belongs to", () => {
  const OFFER = {
    id: "n9",
    kind: "offer",
    title: "Offer from XYZ",
    body: "Congratulations — XYZ has made you an internship offer.",
    createdAt: "2026-08-27T10:00:00Z",
    read: false,
    driveId: "d1",
    letterUrl: "https://signed.example/offer.pdf?token=abc",
    letterName: "XYZ-offer-letter.pdf",
  };

  it("offers the letter by its own filename, opening in a new tab", async () => {
    show(view({ notifications: async () => [OFFER] }));

    const link = await screen.findByRole<HTMLAnchorElement>("link", {
      name: /XYZ-offer-letter\.pdf/,
    });
    expect(link.href).toBe("https://signed.example/offer.pdf?token=abc");
    expect(link.target).toBe("_blank");
    // A signed URL handed to a third party is a leak with our name on it.
    expect(link.rel).toContain("noreferrer");
  });

  it("says nothing about a letter when none is attached", async () => {
    show(view({ notifications: async () => [{ ...OFFER, letterUrl: null, letterName: null }] }));

    await screen.findByText(/made you an internship offer/);
    expect(screen.queryByRole("link", { name: /offer letter/i })).toBeNull();
  });

  /** Both halves travel together (0051): a name with no URL opens nothing. */
  it("shows no link when the URL failed to sign, even though the name survived", async () => {
    show(view({ notifications: async () => [{ ...OFFER, letterUrl: null }] }));

    await screen.findByText(/made you an internship offer/);
    expect(screen.queryByRole("link", { name: /XYZ-offer-letter/ })).toBeNull();
  });
});
