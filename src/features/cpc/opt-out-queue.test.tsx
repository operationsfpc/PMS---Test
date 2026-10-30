// @vitest-environment jsdom
import { render as renderRaw, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { OptOutQueue } from "./opt-out-queue";
import type { ParticipationQueueView } from "./participation-queue-contract";

/** Each name now links to the student's record, so the screen needs a router. */
const render = (ui: React.ReactElement) => renderRaw(<MemoryRouter>{ui}</MemoryRouter>);

/**
 * Approving or declining an opt-out. Its own screen since F2 (UAT 2026-08-06).
 *
 * Approval is irreversible for the student and removes them from every future
 * drive, so the consequence is on the screen rather than in the coordinator's
 * memory. A decline needs a reason, because that reason is the only thing the
 * student is ever told (F1).
 */
const request = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  studentId: "s1",
  studentName: "Priya Ramesh",
  rollNumber: "21CSE1042",
  college: "PSG College of Technology",
  reason: "Joining the family business",
  declarationUrl: "https://signed/declaration.pdf",
  ...over,
});

function view(overrides: Partial<ParticipationQueueView> = {}): ParticipationQueueView {
  return {
    pending: async () => ({ optOuts: [request()], selfPlacements: [] }),
    approveOptOut: async () => undefined,
    declineOptOut: async () => undefined,
    approveSelfPlacement: async () => undefined,
    declineSelfPlacement: async () => undefined,
    ...overrides,
  };
}

describe("OptOutQueue", () => {
  it("names the student and shows the reason they gave", async () => {
    render(<OptOutQueue view={view()} />);

    expect(await screen.findByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByText(/joining the family business/i)).toBeDefined();
  });

  /**
   * 2026-10-30: a reason can be thousands of characters of pasted noise, which
   * used to print whole and take the queue with it. The row now holds a
   * preview and the full text opens in a popup.
   */
  it("folds a long reason into a popup instead of printing it whole", async () => {
    const long = "jk;kfdgghghjklhljk;".repeat(120);
    const user = userEvent.setup();
    render(
      <OptOutQueue
        view={view({
          pending: async () => ({ optOuts: [request({ reason: long })], selfPlacements: [] }),
        })}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: /read the full reason — Priya Ramesh/i,
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: /opt-out reason/i });
    expect(dialog.textContent).toContain(long);

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /** A reason that fits stays in the row: not every explanation is a document. */
  it("keeps a short reason inline, with nothing to open", async () => {
    render(<OptOutQueue view={view()} />);

    await screen.findByText(/joining the family business/i);
    expect(screen.queryByRole("button", { name: /read the full reason/i })).toBeNull();
  });

  /** These queues run across every campus, so a name alone is not enough. */
  it("names the college the student belongs to", async () => {
    render(<OptOutQueue view={view()} />);

    expect(await screen.findByText(/PSG College of Technology/i)).toBeDefined();
  });

  it("says that approving cannot be undone", async () => {
    render(<OptOutQueue view={view()} />);

    expect(await screen.findByText(/cannot be undone/i)).toBeDefined();
  });

  it("links to the signed declaration, so nobody rubber-stamps evidence they cannot open", async () => {
    render(<OptOutQueue view={view()} />);

    const link = await screen.findByRole("link", { name: /signed declaration/i });
    expect(link.getAttribute("href")).toBe("https://signed/declaration.pdf");
  });

  it("says so when the declaration cannot be opened at all", async () => {
    render(
      <OptOutQueue
        view={view({
          pending: async () => ({
            optOuts: [request({ declarationUrl: null })],
            selfPlacements: [],
          }),
        })}
      />,
    );

    expect(await screen.findByText(/no signed declaration/i)).toBeDefined();
    // 2026-10-18: the row said the declaration was missing and still offered an
    // irreversible Approve beside the sentence.
    expect((screen.getByRole("button", { name: /approve/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("approves the request the coordinator pressed", async () => {
    const approveOptOut = vi.fn();
    const user = userEvent.setup();
    render(<OptOutQueue view={view({ approveOptOut })} />);

    await user.click(await screen.findByRole("button", { name: /approve/i }));

    await waitFor(() => expect(approveOptOut).toHaveBeenCalledWith("r1"));
  });

  /**
   * 2026-10-17: a decision used to leave nothing but one fewer row, which reads
   * as a page that did nothing. The consequence, not the click, is what gets
   * said — and it is said about the student the row named.
   */
  it("says what approving did, instead of only removing the row", async () => {
    const user = userEvent.setup();
    render(<OptOutQueue view={view()} />);

    await user.click(await screen.findByRole("button", { name: /approve/i }));

    expect((await screen.findByRole("status")).textContent).toMatch(
      /Priya Ramesh is opted out — they will be left off every future drive/i,
    );
  });

  it("says nothing is waiting rather than showing an empty list", async () => {
    render(
      <OptOutQueue view={view({ pending: async () => ({ optOuts: [], selfPlacements: [] }) })} />,
    );

    expect(await screen.findByText(/nothing waiting/i)).toBeDefined();
  });

  /**
   * 2026-10-18: a rejected reload used to leave the screen reading "Loading…"
   * forever with no reason, because the shell only guarded the decision.
   */
  it("shows a failed load as a failure, never as an empty queue", async () => {
    render(
      <OptOutQueue
        view={view({
          pending: async () => {
            throw new Error("Could not reach the requests.");
          },
        })}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not reach/i);
    expect(screen.queryByText(/nothing waiting/i)).toBeNull();
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  /** F2: this screen decides one kind of request. */
  it("shows no off-campus offers", async () => {
    render(
      <OptOutQueue
        view={view({
          pending: async () => ({
            optOuts: [request()],
            selfPlacements: [
              {
                id: "sp1",
                studentId: "s2",
                studentName: "Arjun",
                rollNumber: "21CSE1043",
                college: "Coimbatore Institute of Technology",
                companyName: "Freshworks",
                ctcLpa: 12,
                offerLetterUrl: null,
              },
            ],
          }),
        })}
      />,
    );

    await screen.findByText("Priya Ramesh");
    expect(screen.queryByText("Freshworks")).toBeNull();
  });

  it("surfaces a failure instead of quietly doing nothing", async () => {
    const user = userEvent.setup();
    render(
      <OptOutQueue
        view={view({
          approveOptOut: async () => {
            throw new Error("Only a placement coordinator may approve this.");
          },
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /approve/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/only a placement coordinator/i);
  });
});

/**
 * F1 (UAT 2026-08-06): "central placement coordinator should have - decline
 * button with reason."
 */
describe("OptOutQueue — declining", () => {
  it("offers a decline button", async () => {
    render(<OptOutQueue view={view()} />);

    expect(await screen.findByRole("button", { name: /decline/i })).toBeDefined();
  });

  it("asks why before it will decline anything", async () => {
    const declineOptOut = vi.fn();
    const user = userEvent.setup();
    render(<OptOutQueue view={view({ declineOptOut })} />);

    await user.click(await screen.findByRole("button", { name: /^decline$/i }));
    await user.click(screen.getByRole("button", { name: /send decline/i }));

    expect(declineOptOut).not.toHaveBeenCalled();
    expect(await screen.findByText(/give a reason/i)).toBeDefined();
  });

  it("sends the reason with the decline", async () => {
    const declineOptOut = vi.fn();
    const user = userEvent.setup();
    render(<OptOutQueue view={view({ declineOptOut })} />);

    await user.click(await screen.findByRole("button", { name: /^decline$/i }));
    await user.type(
      screen.getByLabelText(/why are you declining/i),
      "Your declaration was not signed.",
    );
    await user.click(screen.getByRole("button", { name: /send decline/i }));

    await waitFor(() =>
      expect(declineOptOut).toHaveBeenCalledWith("r1", "Your declaration was not signed."),
    );
  });

  it("says the student will read the reason, so it is not written for the file", async () => {
    const user = userEvent.setup();
    render(<OptOutQueue view={view()} />);

    await user.click(await screen.findByRole("button", { name: /^decline$/i }));

    expect(screen.getByText(/the student is shown/i)).toBeDefined();
  });

  it("lets the coordinator back out without declining", async () => {
    const declineOptOut = vi.fn();
    const user = userEvent.setup();
    render(<OptOutQueue view={view({ declineOptOut })} />);

    await user.click(await screen.findByRole("button", { name: /^decline$/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(declineOptOut).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/why are you declining/i)).toBeNull();
  });

  /**
   * F1: "This should not have an edit button." A coordinator may approve or
   * decline what the student submitted. They may not rewrite it.
   */
  it("offers no way to edit what the student submitted", async () => {
    render(<OptOutQueue view={view()} />);

    await screen.findByText("Priya Ramesh");
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });
});
