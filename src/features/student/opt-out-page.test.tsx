// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OptOutPage } from "./opt-out-page";
import type { ParticipationView } from "./participation-contract";

/**
 * Opting out — its own screen since F2 (UAT 2026-08-06).
 *
 * It is irreversible, so the screen says so before the click rather than in a
 * confirmation the student has already decided to dismiss. Nothing about
 * off-campus offers appears here: they are a different decision with different
 * consequences, and one page carrying both is what got them confused.
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

describe("OptOutPage", () => {
  it("warns that opting out is irreversible before anything is clicked", async () => {
    render(<OptOutPage view={view()} />);

    expect(await screen.findByText(/cannot be reversed/i)).toBeDefined();
  });

  it("requires a reason, and sends it with the request", async () => {
    const requestOptOut = vi.fn();
    const user = userEvent.setup();
    render(<OptOutPage view={view({ requestOptOut })} />);

    await user.click(await screen.findByRole("button", { name: /request opt-out/i }));
    expect(requestOptOut).not.toHaveBeenCalled();
    expect(await screen.findByText(/give a reason for opting out/i)).toBeDefined();

    await user.type(screen.getByLabelText(/why are you opting out/i), "Joining family business");
    await user.upload(
      screen.getByLabelText(/signed declaration/i),
      new File(["signed"], "declaration.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: /request opt-out/i }));

    await waitFor(() =>
      expect(requestOptOut).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "Joining family business" }),
      ),
    );
  });

  it("will not send an opt-out without the signed declaration", async () => {
    const requestOptOut = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OptOutPage view={view({ requestOptOut })} />);

    await user.type(await screen.findByLabelText(/why are you opting out/i), "Higher studies");
    await user.click(screen.getByRole("button", { name: /request opt-out/i }));

    expect(requestOptOut).not.toHaveBeenCalled();
    expect(await screen.findByText(/handwritten declaration/i)).toBeDefined();
  });

  it("says what the declaration has to be, before the student goes looking", async () => {
    render(<OptOutPage view={view()} />);

    expect(await screen.findByText(/handwritten and signed/i)).toBeDefined();
  });

  it("sends the declaration with the request", async () => {
    const requestOptOut = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OptOutPage view={view({ requestOptOut })} />);

    await user.type(await screen.findByLabelText(/why are you opting out/i), "Higher studies");
    await user.upload(
      screen.getByLabelText(/signed declaration/i),
      new File(["e"], "declaration.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: /request opt-out/i }));

    await waitFor(() => expect(requestOptOut).toHaveBeenCalled());
    expect(requestOptOut.mock.calls[0]?.[0].declaration).toBeInstanceOf(File);
  });

  it("offers no second request while one is waiting", async () => {
    render(
      <OptOutPage
        view={view({
          status: async () => ({
            participationStatus: "active",
            optOutRequests: [
              {
                id: "r1",
                reason: "Higher studies",
                submittedAt: "2026-08-01T00:00:00Z",
                status: "pending",
                decisionReason: null,
              },
            ],
            selfPlacements: [],
          }),
        })}
      />,
    );

    expect(await screen.findByText(/waiting for your placement coordinator/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /request opt-out/i })).toBeNull();
  });

  it("tells an opted-out student it is done, without offering to undo it", async () => {
    render(
      <OptOutPage
        view={view({
          status: async () => ({
            participationStatus: "opted_out",
            optOutRequests: [],
            selfPlacements: [],
          }),
        })}
      />,
    );

    expect(await screen.findByText(/you have opted out/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /request opt-out/i })).toBeNull();
  });

  it("surfaces a failure instead of pretending it worked", async () => {
    const user = userEvent.setup();
    render(
      <OptOutPage
        view={view({
          requestOptOut: async () => {
            throw new Error("Your opt-out request is already waiting for approval.");
          },
        })}
      />,
    );

    await user.type(await screen.findByLabelText(/why are you opting out/i), "Higher studies");
    await user.upload(
      screen.getByLabelText(/signed declaration/i),
      new File(["signed"], "declaration.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: /request opt-out/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/already waiting/i);
  });

  /** F2: this screen is about one decision. */
  it("says nothing about off-campus offers", async () => {
    render(<OptOutPage view={view()} />);

    await screen.findByText(/cannot be reversed/i);
    expect(screen.queryByLabelText(/offer letter/i)).toBeNull();
  });
});

/**
 * F3 (UAT 2026-08-06): "the student is not able to go back to check the
 * submission and approval status of it. It should be shown."
 *
 * The request used to vanish the moment it was decided.
 */
describe("OptOutPage — what happened to my request", () => {
  const withRequest = (
    status: "pending" | "verified" | "rejected",
    decisionReason: string | null,
  ) =>
    view({
      status: async () => ({
        participationStatus: status === "verified" ? "opted_out" : "active",
        optOutRequests: [
          {
            id: "r1",
            reason: "Joining the family business",
            submittedAt: "2026-08-01T00:00:00Z",
            status,
            decisionReason,
          },
        ],
        selfPlacements: [],
      }),
    });

  it("keeps the request visible after it is approved", async () => {
    render(<OptOutPage view={withRequest("verified", null)} />);

    expect(await screen.findByText(/joining the family business/i)).toBeDefined();
    expect(screen.getByText(/^approved$/i)).toBeDefined();
  });

  it("keeps it visible after it is declined, with the coordinator's reason", async () => {
    render(<OptOutPage view={withRequest("rejected", "Your declaration was not signed.")} />);

    expect(await screen.findByText(/^declined$/i)).toBeDefined();
    expect(screen.getByText(/your declaration was not signed/i)).toBeDefined();
  });

  /** A decline is not the end: they may fix the declaration and ask again. */
  it("lets a student who was declined ask again", async () => {
    render(<OptOutPage view={withRequest("rejected", "Your declaration was not signed.")} />);

    expect(await screen.findByRole("button", { name: /request opt-out/i })).toBeDefined();
  });

  it("says so plainly when a decline carries no reason at all", async () => {
    render(<OptOutPage view={withRequest("rejected", null)} />);

    expect(await screen.findByText(/no reason was recorded/i)).toBeDefined();
  });
});
