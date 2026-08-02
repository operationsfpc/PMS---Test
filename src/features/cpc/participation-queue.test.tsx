// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParticipationQueue, type ParticipationQueueView } from "./participation-queue";

/**
 * The coordinator's approvals.
 *
 * Approving an opt-out is irreversible for the student, so the screen shows
 * their stated reason and says what approval will do. Self-placed offers need
 * approval because there is no drive to corroborate them (A18).
 */
const OPT_OUTS = [
  {
    id: "r1",
    studentName: "Priya Ramesh",
    rollNumber: "21CSE1042",
    reason: "Joining family business",
  },
];

const SELF_PLACED = [
  {
    id: "o1",
    studentName: "Arjun Menon",
    rollNumber: "21CSE9001",
    companyName: "Freshworks",
    ctcLpa: 12,
  },
];

function view(overrides: Partial<ParticipationQueueView> = {}): ParticipationQueueView {
  return {
    pending: async () => ({ optOuts: OPT_OUTS, selfPlacements: SELF_PLACED }),
    approveOptOut: async () => undefined,
    rejectOptOut: async () => undefined,
    approveSelfPlacement: async () => undefined,
    ...overrides,
  };
}

describe("ParticipationQueue", () => {
  it("shows each opt-out request with the student's stated reason", async () => {
    render(<ParticipationQueue view={view()} />);

    expect(await screen.findByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByText(/joining family business/i)).toBeDefined();
  });

  it("says approval is irreversible before the coordinator clicks", async () => {
    render(<ParticipationQueue view={view()} />);

    expect(await screen.findByText(/cannot be undone/i)).toBeDefined();
  });

  it("approves an opt-out", async () => {
    const approveOptOut = vi.fn();
    const user = userEvent.setup();
    render(<ParticipationQueue view={view({ approveOptOut })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.click(within(row).getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(approveOptOut).toHaveBeenCalledWith("r1"));
  });

  it("rejects an opt-out, which leaves the student active", async () => {
    const rejectOptOut = vi.fn();
    const user = userEvent.setup();
    render(<ParticipationQueue view={view({ rejectOptOut })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.click(within(row).getByRole("button", { name: /reject/i }));

    await waitFor(() => expect(rejectOptOut).toHaveBeenCalledWith("r1"));
  });

  it("approves a self-placed offer", async () => {
    const approveSelfPlacement = vi.fn();
    const user = userEvent.setup();
    render(<ParticipationQueue view={view({ approveSelfPlacement })} />);

    const row = (await screen.findByText("Arjun Menon")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.click(within(row).getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(approveSelfPlacement).toHaveBeenCalledWith("o1"));
  });

  it("says so plainly when there is nothing waiting", async () => {
    render(
      <ParticipationQueue
        view={view({ pending: async () => ({ optOuts: [], selfPlacements: [] }) })}
      />,
    );

    expect(await screen.findByText(/nothing waiting/i)).toBeDefined();
  });

  it("surfaces a failure instead of pretending it worked", async () => {
    const user = userEvent.setup();
    render(
      <ParticipationQueue
        view={view({
          approveOptOut: async () => {
            throw new Error("Only a placement coordinator may approve this.");
          },
        })}
      />,
    );

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.click(within(row).getByRole("button", { name: /approve/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/placement coordinator/i);
  });
});
