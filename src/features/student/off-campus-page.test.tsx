// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OffCampusPage } from "./off-campus-page";
import type { ParticipationView } from "./participation-contract";

/**
 * Recording an offer the student found themselves — its own screen since F2
 * (UAT 2026-08-06).
 *
 * It is a separate statistic and never touches on-campus eligibility. Students
 * ask about that constantly, so the screen states it rather than waiting to be
 * asked.
 */
function view(overrides: Partial<ParticipationView> = {}): ParticipationView {
  return {
    status: async () => ({
      participationStatus: "active",
      optOutRequests: [],
      selfPlacements: [],
    }),
    requestOptOut: async () => undefined,
    recordSelfPlacement: async () => undefined,
    ...overrides,
  };
}

const placement = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  companyName: "Freshworks",
  roleTitle: "SDE",
  ctcLpa: 12,
  submittedAt: "2026-08-01T00:00:00Z",
  status: "pending" as const,
  decisionReason: null,
  ...over,
});

describe("OffCampusPage", () => {
  it("records an off-campus offer with company and CTC", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup();
    render(<OffCampusPage view={view({ recordSelfPlacement })} />);

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.type(screen.getByLabelText(/role/i), "SDE");
    await user.type(screen.getByLabelText(/ctc/i), "12");
    await user.upload(
      screen.getByLabelText(/offer letter/i),
      new File(["offer"], "offer.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    await waitFor(() =>
      expect(recordSelfPlacement).toHaveBeenCalledWith(
        expect.objectContaining({ companyName: "Freshworks", roleTitle: "SDE", ctcLpa: 12 }),
      ),
    );
  });

  it("states that an off-campus offer does not affect on-campus eligibility", async () => {
    render(<OffCampusPage view={view()} />);

    expect(await screen.findByText(/does not affect/i)).toBeDefined();
  });

  it("will not record one without the offer letter", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ recordSelfPlacement })} />);

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.type(screen.getByLabelText(/ctc/i), "7.5");
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    expect(recordSelfPlacement).not.toHaveBeenCalled();
    expect(await screen.findByText(/upload your offer letter/i)).toBeDefined();
  });

  it("sends the offer letter with the offer", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ recordSelfPlacement })} />);

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.type(screen.getByLabelText(/ctc/i), "7.5");
    await user.upload(
      screen.getByLabelText(/offer letter/i),
      new File(["offer"], "offer.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    await waitFor(() => expect(recordSelfPlacement).toHaveBeenCalled());
    expect(recordSelfPlacement.mock.calls[0]?.[0].offerLetter).toBeInstanceOf(File);
  });

  it("says the coordinator has to verify it, so nobody expects it to count yet", async () => {
    render(<OffCampusPage view={view()} />);

    expect(await screen.findByText(/verified by your.*coordinator/i)).toBeDefined();
  });

  it("refuses a CTC that is not a number rather than sending nonsense", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ recordSelfPlacement })} />);

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    expect(recordSelfPlacement).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeDefined();
  });

  /** F2: this screen is about one decision. */
  it("says nothing about opting out", async () => {
    render(<OffCampusPage view={view()} />);

    await screen.findByText(/does not affect/i);
    expect(screen.queryByLabelText(/why are you opting out/i)).toBeNull();
  });
});

/**
 * F3 (UAT 2026-08-06): "After the approval of the Self offer letter, the
 * student is not able to go back to check the submission and approval status
 * of it. It should be shown."
 */
describe("OffCampusPage — what happened to my offer", () => {
  it("lists an offer still waiting, with what was submitted", async () => {
    render(
      <OffCampusPage
        view={view({
          status: async () => ({
            participationStatus: "active",
            optOutRequests: [],
            selfPlacements: [placement()],
          }),
        })}
      />,
    );

    expect(await screen.findByText("Freshworks")).toBeDefined();
    expect(screen.getByText(/waiting for your placement coordinator/i)).toBeDefined();
  });

  it("keeps an APPROVED offer on the screen, which is the whole complaint", async () => {
    render(
      <OffCampusPage
        view={view({
          status: async () => ({
            participationStatus: "active",
            optOutRequests: [],
            selfPlacements: [placement({ status: "verified" })],
          }),
        })}
      />,
    );

    expect(await screen.findByText("Freshworks")).toBeDefined();
    expect(screen.getByText(/^approved$/i)).toBeDefined();
  });

  it("shows a declined offer with the coordinator's reason", async () => {
    render(
      <OffCampusPage
        view={view({
          status: async () => ({
            participationStatus: "active",
            optOutRequests: [],
            selfPlacements: [
              placement({ status: "rejected", decisionReason: "The letter has no CTC on it." }),
            ],
          }),
        })}
      />,
    );

    expect(await screen.findByText(/^declined$/i)).toBeDefined();
    expect(screen.getByText(/the letter has no ctc on it/i)).toBeDefined();
  });

  it("still lets a student record another offer after one was declined", async () => {
    render(
      <OffCampusPage
        view={view({
          status: async () => ({
            participationStatus: "active",
            optOutRequests: [],
            selfPlacements: [placement({ status: "rejected", decisionReason: "Unreadable." })],
          }),
        })}
      />,
    );

    expect(await screen.findByRole("button", { name: /record.*offer/i })).toBeDefined();
  });

  /** Opting out is usually BECAUSE they took an outside job (PRD §16.2). */
  it("still records an offer for a student who has opted out", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <OffCampusPage
        view={view({
          recordSelfPlacement,
          status: async () => ({
            participationStatus: "opted_out",
            optOutRequests: [],
            selfPlacements: [],
          }),
        })}
      />,
    );

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.type(screen.getByLabelText(/ctc/i), "9");
    await user.upload(
      screen.getByLabelText(/offer letter/i),
      new File(["offer"], "offer.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    await waitFor(() => expect(recordSelfPlacement).toHaveBeenCalled());
  });
});
