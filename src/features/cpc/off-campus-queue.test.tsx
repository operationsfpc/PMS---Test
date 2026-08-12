// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OffCampusQueue } from "./off-campus-queue";
import type { ParticipationQueueView } from "./participation-queue-contract";

/**
 * Verifying an offer a student found themselves. Its own screen since F2 (UAT
 * 2026-08-06).
 *
 * Approving creates the `offers` row, and it becomes a number the college
 * reports. There is no drive to corroborate it, so the letter is the only
 * evidence there is.
 */
const placement = (over: Record<string, unknown> = {}) => ({
  id: "sp1",
  studentName: "Arjun Kumar",
  rollNumber: "21CSE1043",
  companyName: "Freshworks",
  ctcLpa: 12,
  offerLetterUrl: "https://signed/offer.pdf",
  ...over,
});

function view(overrides: Partial<ParticipationQueueView> = {}): ParticipationQueueView {
  return {
    pending: async () => ({ optOuts: [], selfPlacements: [placement()] }),
    approveOptOut: async () => undefined,
    declineOptOut: async () => undefined,
    approveSelfPlacement: async () => undefined,
    declineSelfPlacement: async () => undefined,
    ...overrides,
  };
}

describe("OffCampusQueue", () => {
  it("names the student, the company and the package", async () => {
    render(<OffCampusQueue view={view()} />);

    expect(await screen.findByText("Arjun Kumar")).toBeDefined();
    expect(screen.getByText(/freshworks/i)).toBeDefined();
    expect(screen.getByText(/12 LPA/)).toBeDefined();
  });

  it("links to the offer letter", async () => {
    render(<OffCampusQueue view={view()} />);

    const link = await screen.findByRole("link", { name: /offer letter/i });
    expect(link.getAttribute("href")).toBe("https://signed/offer.pdf");
  });

  it("says so when the offer letter cannot be opened at all", async () => {
    render(
      <OffCampusQueue
        view={view({
          pending: async () => ({
            optOuts: [],
            selfPlacements: [placement({ offerLetterUrl: null })],
          }),
        })}
      />,
    );

    expect(await screen.findByText(/no offer letter/i)).toBeDefined();
  });

  /**
   * D5/D6 (2026-08-12): an approved self-placed offer climbs the category
   * ladder, so the coordinator must say WHAT it is before approving — job or
   * internship, and which rung a job occupies. No classification, no approval.
   */
  it("refuses to approve until the coordinator classifies the offer", async () => {
    const approveSelfPlacement = vi.fn();
    const user = userEvent.setup();
    render(<OffCampusQueue view={view({ approveSelfPlacement })} />);

    const approve = await screen.findByRole("button", { name: /approve/i });
    await user.click(approve);

    expect(approveSelfPlacement).not.toHaveBeenCalled();
  });

  it("approves a job offer with the category the coordinator chose", async () => {
    const approveSelfPlacement = vi.fn();
    const user = userEvent.setup();
    render(<OffCampusQueue view={view({ approveSelfPlacement })} />);

    await user.selectOptions(await screen.findByLabelText(/offer type/i), "placement");
    await user.selectOptions(screen.getByLabelText(/category/i), "dream");
    await user.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(approveSelfPlacement).toHaveBeenCalledWith("sp1", {
        driveType: "placement",
        offerCategory: "dream",
      }),
    );
  });

  it("an internship needs no category and is recorded as one", async () => {
    const approveSelfPlacement = vi.fn();
    const user = userEvent.setup();
    render(<OffCampusQueue view={view({ approveSelfPlacement })} />);

    await user.selectOptions(await screen.findByLabelText(/offer type/i), "internship");
    await user.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(approveSelfPlacement).toHaveBeenCalledWith("sp1", {
        driveType: "internship",
        offerCategory: null,
      }),
    );
  });

  it("tells the coordinator the approval now affects on-campus eligibility", async () => {
    render(<OffCampusQueue view={view()} />);

    expect(await screen.findByText(/category ladder/i)).toBeDefined();
    expect(screen.queryByText(/never affects on-campus eligibility/i)).toBeNull();
  });

  it("says nothing is waiting rather than showing an empty list", async () => {
    render(
      <OffCampusQueue
        view={view({ pending: async () => ({ optOuts: [], selfPlacements: [] }) })}
      />,
    );

    expect(await screen.findByText(/nothing waiting/i)).toBeDefined();
  });

  /** F2: this screen decides one kind of request. */
  it("shows no opt-out requests", async () => {
    render(
      <OffCampusQueue
        view={view({
          pending: async () => ({
            optOuts: [
              {
                id: "r1",
                studentName: "Priya Ramesh",
                rollNumber: "21CSE1042",
                reason: "Family business",
                declarationUrl: null,
              },
            ],
            selfPlacements: [placement()],
          }),
        })}
      />,
    );

    await screen.findByText("Arjun Kumar");
    expect(screen.queryByText("Priya Ramesh")).toBeNull();
  });

  it("surfaces a failure instead of quietly doing nothing", async () => {
    const user = userEvent.setup();
    render(
      <OffCampusQueue
        view={view({
          approveSelfPlacement: async () => {
            throw new Error("The offer was not recorded. Please retry.");
          },
        })}
      />,
    );

    // D6: Approve is disabled until the offer is classified, so the failure
    // path starts the same way a real approval does.
    await user.selectOptions(await screen.findByLabelText(/offer type/i), "placement");
    await user.selectOptions(screen.getByLabelText(/category/i), "dream");
    await user.click(screen.getByRole("button", { name: /approve/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/not recorded/i);
  });
});

/** F1 (UAT 2026-08-06): decline, with a reason, and the student is told. */
describe("OffCampusQueue — declining", () => {
  it("asks why before it will decline anything", async () => {
    const declineSelfPlacement = vi.fn();
    const user = userEvent.setup();
    render(<OffCampusQueue view={view({ declineSelfPlacement })} />);

    await user.click(await screen.findByRole("button", { name: /^decline$/i }));
    await user.click(screen.getByRole("button", { name: /send decline/i }));

    expect(declineSelfPlacement).not.toHaveBeenCalled();
    expect(await screen.findByText(/give a reason/i)).toBeDefined();
  });

  it("sends the reason with the decline", async () => {
    const declineSelfPlacement = vi.fn();
    const user = userEvent.setup();
    render(<OffCampusQueue view={view({ declineSelfPlacement })} />);

    await user.click(await screen.findByRole("button", { name: /^decline$/i }));
    await user.type(
      screen.getByLabelText(/why are you declining/i),
      "The letter has no CTC on it.",
    );
    await user.click(screen.getByRole("button", { name: /send decline/i }));

    await waitFor(() =>
      expect(declineSelfPlacement).toHaveBeenCalledWith("sp1", "The letter has no CTC on it."),
    );
  });

  /** F1: "This should not have an edit button." */
  it("offers no way to edit what the student submitted", async () => {
    render(<OffCampusQueue view={view()} />);

    await screen.findByText("Arjun Kumar");
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });
});
