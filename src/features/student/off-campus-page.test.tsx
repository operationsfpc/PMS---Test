// @vitest-environment jsdom
import { toYmd } from "@domain/drive-date-filter";
import { defaultReviewDate } from "@domain/holds";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OffCampusPage } from "./off-campus-page";
import type { ParticipationView } from "./participation-contract";

/**
 * Recording an offer the student found themselves — its own screen since F2
 * (UAT 2026-08-06).
 *
 * Since 0130 the screen has two shapes. An active student's offer travels with
 * a self-placement hold request (offer letter + handwritten declaration) that a
 * Campus Manager confirms; an opted-out student has no drives left to hold, so
 * their offer is recorded for the statistic alone.
 */
function view(
  overrides: Partial<ParticipationView> = {},
  participationStatus: "active" | "opted_out" | "on_hold" | "disbarred" = "active",
): ParticipationView {
  return {
    status: async () => ({
      participationStatus,
      optOutRequests: [],
      selfPlacements: [],
    }),
    requestOptOut: async () => undefined,
    recordSelfPlacement: async () => undefined,
    requestSelfPlacedHold: async () => undefined,
    statusHistory: async () => [],
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

const offer = () => new File(["offer"], "offer.pdf", { type: "application/pdf" });
const declaration = () => new File(["signed"], "declaration.jpg", { type: "image/jpeg" });

/** Fills what both shapes share. */
async function fillOffer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/company/i), "Freshworks");
  await user.type(screen.getByLabelText(/role/i), "SDE");
  await user.type(screen.getByLabelText(/ctc/i), "12");
  await user.upload(screen.getByLabelText(/offer letter/i), offer());
}

/**
 * The offer-only shape: a student who has opted out has no drives to hold, so
 * this is the flow that has always existed.
 */
describe("OffCampusPage — recording an offer", () => {
  it("records an off-campus offer with company and CTC", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup();
    render(<OffCampusPage view={view({ recordSelfPlacement }, "opted_out")} />);

    await fillOffer(user);
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    await waitFor(() =>
      expect(recordSelfPlacement).toHaveBeenCalledWith(
        expect.objectContaining({ companyName: "Freshworks", roleTitle: "SDE", ctcLpa: 12 }),
      ),
    );
  });

  it("states that an off-campus offer does not affect on-campus eligibility", async () => {
    render(<OffCampusPage view={view({}, "opted_out")} />);

    expect(await screen.findByText(/does not affect/i)).toBeDefined();
  });

  it("will not record one without the offer letter", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ recordSelfPlacement }, "opted_out")} />);

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.type(screen.getByLabelText(/ctc/i), "7.5");
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    expect(recordSelfPlacement).not.toHaveBeenCalled();
    expect(await screen.findByText(/upload your offer letter/i)).toBeDefined();
  });

  it("sends the offer letter with the offer", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ recordSelfPlacement }, "opted_out")} />);

    await fillOffer(user);
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    await waitFor(() => expect(recordSelfPlacement).toHaveBeenCalled());
    expect(recordSelfPlacement.mock.calls[0]?.[0].offerLetter).toBeInstanceOf(File);
  });

  it("says the coordinator has to verify it, so nobody expects it to count yet", async () => {
    render(<OffCampusPage view={view({}, "opted_out")} />);

    expect(await screen.findByText(/verified by your.*coordinator/i)).toBeDefined();
  });

  it("refuses a CTC that is not a number rather than sending nonsense", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ recordSelfPlacement }, "opted_out")} />);

    await user.type(await screen.findByLabelText(/company/i), "Freshworks");
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    expect(recordSelfPlacement).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("loads the button and refuses a second click while the offer is being recorded", async () => {
    let release: () => void = () => {};
    const recordSelfPlacement = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ recordSelfPlacement }, "opted_out")} />);

    await fillOffer(user);

    const button = screen.getByRole("button", { name: /record.*offer/i }) as HTMLButtonElement;
    await user.click(button);

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);

    await user.click(button);
    expect(recordSelfPlacement).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("false"));
  });

  /** F2: this screen is about one decision. */
  it("says nothing about opting out", async () => {
    render(<OffCampusPage view={view({}, "opted_out")} />);

    await screen.findByText(/does not affect/i);
    expect(screen.queryByLabelText(/why are you opting out/i)).toBeNull();
  });

  /**
   * Deliberately still open (PRD §16.2): a student who withdrew and then found
   * their own job is exactly the self-placement statistic.
   */
  it("still records an offer for a student who has opted out", async () => {
    const recordSelfPlacement = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ recordSelfPlacement }, "opted_out")} />);

    await fillOffer(user);
    await user.click(screen.getByRole("button", { name: /record.*offer/i }));

    await waitFor(() => expect(recordSelfPlacement).toHaveBeenCalled());
  });
});

/**
 * 0130: the student files the offer and asks for the hold in one act. Nothing
 * closes until a Campus Manager confirms, and the two documents are what they
 * decide on.
 */
describe("OffCampusPage — asking for a self-placement hold", () => {
  it("asks for the declaration without asking the student for reason or review dates", async () => {
    render(<OffCampusPage view={view()} />);

    expect(await screen.findByLabelText(/signed declaration/i)).toBeDefined();
    expect(screen.queryByLabelText(/why hold your placements/i)).toBeNull();
    expect(screen.queryByLabelText(/^from$/i)).toBeNull();
    expect(screen.queryByLabelText(/review by/i)).toBeNull();
  });

  it("says the drives stay open until the Campus Manager confirms", async () => {
    render(<OffCampusPage view={view()} />);

    expect(await screen.findByText(/until they confirm it/i)).toBeDefined();
  });

  it("sends both documents and auto-generates the reason and window", async () => {
    const requestSelfPlacedHold = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ requestSelfPlacedHold })} />);

    await fillOffer(user);
    await user.upload(screen.getByLabelText(/signed declaration/i), declaration());
    await user.click(screen.getByRole("button", { name: /send hold request/i }));

    await waitFor(() =>
      expect(requestSelfPlacedHold).toHaveBeenCalledWith(
        expect.objectContaining({
          companyName: "Freshworks",
          roleTitle: "SDE",
          ctcLpa: 12,
          reason: "Offer from Freshworks (SDE)",
          startsAt: toYmd(new Date()),
          endsAt: defaultReviewDate(new Date()),
          offerLetter: expect.any(File),
          declaration: expect.any(File),
        }),
      ),
    );
    // The offer-only path must not have fired as well: one submission, one request.
    expect(screen.queryByText(/verified by your/i)).toBeNull();
  });

  it("says the request is with the Campus Manager after it is sent", async () => {
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view()} />);

    await fillOffer(user);
    await user.upload(screen.getByLabelText(/signed declaration/i), declaration());
    await user.click(screen.getByRole("button", { name: /send hold request/i }));

    expect(await screen.findByText(/with your Campus Manager/i)).toBeDefined();
  });

  it("will not send without the handwritten declaration", async () => {
    const requestSelfPlacedHold = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<OffCampusPage view={view({ requestSelfPlacedHold })} />);

    await fillOffer(user);
    await user.click(screen.getByRole("button", { name: /send hold request/i }));

    expect(requestSelfPlacedHold).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/handwritten declaration/i);
  });

  it("will not offer the hold request to a student already out of placements", async () => {
    render(<OffCampusPage view={view({}, "opted_out")} />);

    await screen.findByLabelText(/offer letter/i);
    expect(screen.queryByLabelText(/signed declaration/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /send hold request/i })).toBeNull();
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

  it("still lets a student ask again after one was declined", async () => {
    render(
      <OffCampusPage
        view={view(
          {
            status: async () => ({
              participationStatus: "opted_out",
              optOutRequests: [],
              selfPlacements: [placement({ status: "rejected", decisionReason: "Unreadable." })],
            }),
          },
          "opted_out",
        )}
      />,
    );

    expect(await screen.findByRole("button", { name: /record.*offer/i })).toBeDefined();
  });
});
