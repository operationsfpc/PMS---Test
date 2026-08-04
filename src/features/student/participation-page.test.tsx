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
    // Mandatory since UAT 2026-08-05; the request is refused without it.
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
    await user.upload(
      screen.getByLabelText(/signed declaration/i),
      new File(["signed"], "declaration.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: /request opt-out/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/already waiting/i);
  });
});

/**
 * Evidence, required from UAT 2026-08-05.
 *
 * Both of these decisions are irreversible in practice, so neither may rest on
 * a student's word alone. The refusal comes from the domain, so the screen and
 * the database refuse for the same reason and say the same thing.
 */
describe("ParticipationPage — evidence", () => {
  const file = (name = "offer.pdf") => new File(["evidence"], name, { type: "application/pdf" });

  it("will not send an opt-out without the signed declaration", async () => {
    const requestOptOut = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<ParticipationPage view={view({ requestOptOut })} />);

    await user.type(await screen.findByLabelText(/why are you opting out/i), "Higher studies");
    await user.click(screen.getByRole("button", { name: /request opt-out/i }));

    expect(requestOptOut).not.toHaveBeenCalled();
    expect(await screen.findByText(/handwritten declaration/i)).toBeDefined();
  });

  it("says what the declaration has to be, before the student goes looking", async () => {
    render(<ParticipationPage view={view()} />);

    expect(await screen.findByText(/handwritten and signed/i)).toBeDefined();
  });

  it("sends the declaration with the request", async () => {
    const requestOptOut = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<ParticipationPage view={view({ requestOptOut })} />);

    await user.type(await screen.findByLabelText(/why are you opting out/i), "Higher studies");
    await user.upload(screen.getByLabelText(/signed declaration/i), file("declaration.jpg"));
    await user.click(screen.getByRole("button", { name: /request opt-out/i }));

    await waitFor(() => expect(requestOptOut).toHaveBeenCalled());
    expect(requestOptOut.mock.calls[0]?.[0]).toMatchObject({ reason: "Higher studies" });
    expect(requestOptOut.mock.calls[0]?.[0].declaration).toBeInstanceOf(File);
  });

  it("will not record an off-campus offer without the offer letter", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<ParticipationPage view={view({ recordSelfPlacement })} />);

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.type(screen.getByLabelText(/ctc/i), "7.5");
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    expect(recordSelfPlacement).not.toHaveBeenCalled();
    expect(await screen.findByText(/upload your offer letter/i)).toBeDefined();
  });

  it("sends the offer letter with the offer", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<ParticipationPage view={view({ recordSelfPlacement })} />);

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.type(screen.getByLabelText(/ctc/i), "7.5");
    await user.upload(screen.getByLabelText(/offer letter/i), file());
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    await waitFor(() => expect(recordSelfPlacement).toHaveBeenCalled());
    expect(recordSelfPlacement.mock.calls[0]?.[0].offerLetter).toBeInstanceOf(File);
  });

  it("says the coordinator has to verify it, so nobody expects it to count yet", async () => {
    render(<ParticipationPage view={view()} />);

    expect(await screen.findByText(/verified by your.*coordinator/i)).toBeDefined();
  });
});
