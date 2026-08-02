// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParticipationPage, type ParticipationView } from "./participation-page";

/**
 * The student's own participation.
 *
 * Opting out is irreversible, so the screen must say so before the click, not
 * after. Self-placement is a separate statistic and never affects on-campus
 * eligibility - students ask about this constantly, so the screen states it.
 */
function view(overrides: Partial<ParticipationView> = {}): ParticipationView {
  return {
    status: async () => ({
      participationStatus: "active",
      hasPendingRequest: false,
      selfPlacements: [],
    }),
    requestOptOut: async () => undefined,
    recordSelfPlacement: async () => undefined,
    ...overrides,
  };
}

describe("ParticipationPage", () => {
  it("warns that opting out is irreversible before anything is clicked", async () => {
    render(<ParticipationPage view={view()} />);

    expect(await screen.findByText(/cannot be reversed/i)).toBeDefined();
  });

  it("requires a reason, and sends it with the request", async () => {
    const requestOptOut = vi.fn();
    const user = userEvent.setup();
    render(<ParticipationPage view={view({ requestOptOut })} />);

    await user.click(await screen.findByRole("button", { name: /request opt-out/i }));
    expect(requestOptOut).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/why are you opting out/i), "Joining family business");
    await user.click(screen.getByRole("button", { name: /request opt-out/i }));

    await waitFor(() => expect(requestOptOut).toHaveBeenCalledWith("Joining family business"));
  });

  it("tells a student whose request is pending that it is waiting, and offers no second one", async () => {
    render(
      <ParticipationPage
        view={view({
          status: async () => ({
            participationStatus: "active",
            hasPendingRequest: true,
            selfPlacements: [],
          }),
        })}
      />,
    );

    expect(await screen.findByText(/waiting for approval/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /request opt-out/i })).toBeNull();
  });

  it("tells an opted-out student it is done, without offering to undo it", async () => {
    render(
      <ParticipationPage
        view={view({
          status: async () => ({
            participationStatus: "opted_out",
            hasPendingRequest: false,
            selfPlacements: [],
          }),
        })}
      />,
    );

    expect(await screen.findByText(/you have opted out/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /request opt-out/i })).toBeNull();
  });

  it("records a self-placement with company and CTC", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup();
    render(<ParticipationPage view={view({ recordSelfPlacement })} />);

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.type(screen.getByLabelText(/role/i), "SDE");
    await user.type(screen.getByLabelText(/ctc/i), "12");
    await user.click(screen.getByRole("button", { name: /submit off-campus offer/i }));

    await waitFor(() =>
      expect(recordSelfPlacement).toHaveBeenCalledWith({
        companyName: "Freshworks",
        roleTitle: "SDE",
        ctcLpa: 12,
      }),
    );
  });

  it("states that an off-campus offer does not affect on-campus eligibility", async () => {
    render(<ParticipationPage view={view()} />);

    expect(await screen.findByText(/does not affect/i)).toBeDefined();
  });

  it("lists off-campus offers already recorded, with their approval state", async () => {
    render(
      <ParticipationPage
        view={view({
          status: async () => ({
            participationStatus: "active",
            hasPendingRequest: false,
            selfPlacements: [{ id: "o1", companyName: "Freshworks", ctcLpa: 12, approved: false }],
          }),
        })}
      />,
    );

    expect(await screen.findByText("Freshworks")).toBeDefined();
    expect(screen.getByText(/awaiting approval/i)).toBeDefined();
  });

  it("surfaces a failure instead of pretending it worked", async () => {
    const user = userEvent.setup();
    render(
      <ParticipationPage
        view={view({
          requestOptOut: async () => {
            throw new Error("Your opt-out request is already waiting for approval.");
          },
        })}
      />,
    );

    await user.type(await screen.findByLabelText(/why are you opting out/i), "Higher studies");
    await user.click(screen.getByRole("button", { name: /request opt-out/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/already waiting/i);
  });
});
