// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SrfVerificationQueue } from "./srf-verification-queue";
import { VerificationError, type VerificationRepository } from "./verification-repository";

/**
 * The CPC queue against a real repository.
 *
 * Approval is what unlocks every drive a student can ever see, so the tests
 * pin that a decision actually reaches the repository, and that a refusal is
 * shown rather than swallowed.
 */
const row = {
  id: "s1",
  fullName: "Asha Ramanathan",
  rollNumber: "TEC001",
  overallCgpa: 8.2,
  currentArrears: 0,
  historyOfArrears: 1,
  tenthPercentage: 91.4,
  twelfthPercentage: 88,
  submittedAt: "2026-08-01T10:00:00Z",
  documents: [
    { kind: "tenth_marksheet", label: "10th marksheet", url: "https://signed/10" },
    { kind: "twelfth_marksheet", label: "12th marksheet", url: "https://signed/12" },
  ],
};

function repo(overrides: Partial<VerificationRepository> = {}): VerificationRepository {
  return {
    pending: async () => [row],
    decide: async () => undefined,
    ...overrides,
  };
}

describe("SrfVerificationQueue", () => {
  it("lists the forms awaiting verification", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    expect(await screen.findByText("Asha Ramanathan")).toBeDefined();
    expect(screen.getByText("TEC001")).toBeDefined();
  });

  it("says so plainly when nothing is waiting", async () => {
    render(<SrfVerificationQueue repository={repo({ pending: async () => [] })} />);

    expect(await screen.findByText(/nothing awaiting verification/i)).toBeDefined();
  });

  it("approves a student through the repository and clears them from the queue", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SrfVerificationQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /approve Asha Ramanathan/i }));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0]?.[0]).toBe("s1");
    expect(decide.mock.calls[0]?.[2]).toEqual({ decision: "approve" });
    await waitFor(() => expect(screen.queryByText("Asha Ramanathan")).toBeNull());
  });

  it("shows the refusal when a decision is rejected by the rules", async () => {
    const decide = vi.fn().mockRejectedValue(new VerificationError("A rejection needs a reason."));
    const user = userEvent.setup();
    render(<SrfVerificationQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /approve Asha Ramanathan/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toMatch(/needs a reason/i);
    // The student stays in the queue - nothing was decided.
    expect(screen.getByText("Asha Ramanathan")).toBeDefined();
  });

  it("links the marksheets that justify the figures (PRD 4.2)", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    expect(await screen.findByRole("link", { name: /10th marksheet/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /12th marksheet/i })).toBeDefined();
  });

  it("flags a student who uploaded nothing, rather than showing a blank cell", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({ pending: async () => [{ ...row, documents: [] }] })}
      />,
    );

    expect(await screen.findByText(/none uploaded/i)).toBeDefined();
  });

  it("reports a failure to load rather than showing an empty queue", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({
          pending: async () => {
            throw new VerificationError("Could not load the verification queue.");
          },
        })}
      />,
    );

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText(/nothing awaiting verification/i)).toBeNull();
  });
});
