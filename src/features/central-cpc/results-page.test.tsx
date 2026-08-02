// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResultsPage, type ResultsView, type RoundParticipant } from "./results-page";

/**
 * Recording a round's results.
 *
 * Only `selected` advances (Q10), so this screen decides who is in the next
 * round. Waitlisted and on-hold students are deliberately NOT carried
 * forward: the Central CPC must promote them explicitly, which makes the
 * promotion an auditable act rather than a side effect.
 */
const PRIYA: RoundParticipant = {
  applicationId: "app1",
  studentName: "Priya Ramesh",
  rollNumber: "21CSE1042",
  attendance: "present",
  result: null,
};

const ARJUN: RoundParticipant = {
  applicationId: "app2",
  studentName: "Arjun Menon",
  rollNumber: "21CSE9001",
  attendance: "absent",
  result: "rejected",
};

const PARTICIPANTS: readonly RoundParticipant[] = [PRIYA, ARJUN];

function view(overrides: Partial<ResultsView> = {}): ResultsView {
  return {
    participants: async () => PARTICIPANTS,
    record: async () => undefined,
    ...overrides,
  };
}

describe("ResultsPage", () => {
  it("lists everyone who took part, with their attendance", async () => {
    render(<ResultsPage roundId="r1" view={view()} />);

    expect(await screen.findByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByText(/absent/i)).toBeDefined();
  });

  it("records a result for one participant", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(<ResultsPage roundId="r1" view={view({ record })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.selectOptions(within(row).getByRole("combobox"), "selected");

    await waitFor(() => expect(record).toHaveBeenCalledWith("r1", "app1", "selected"));
  });

  it("shows a result that was already recorded", async () => {
    render(<ResultsPage roundId="r1" view={view()} />);

    const row = (await screen.findByText("Arjun Menon")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByRole<HTMLSelectElement>("combobox").value).toBe("rejected");
  });

  it("says how many advance, because only the selected are scheduled next", async () => {
    render(
      <ResultsPage
        roundId="r1"
        view={view({
          participants: async () => [
            { ...PRIYA, result: "selected" },
            { ...ARJUN, result: "waitlisted" },
          ],
        })}
      />,
    );

    expect(await screen.findByText(/1 of 2 advance/i)).toBeDefined();
  });

  it("warns that a waitlisted student is not carried forward", async () => {
    render(
      <ResultsPage
        roundId="r1"
        view={view({
          participants: async () => [{ ...PRIYA, result: "waitlisted" }],
        })}
      />,
    );

    expect(await screen.findByText(/promote them to selected/i)).toBeDefined();
  });

  it("surfaces a failed save instead of pretending it worked", async () => {
    const user = userEvent.setup();
    render(
      <ResultsPage
        roundId="r1"
        view={view({
          record: async () => {
            throw new Error("Only the Central Placement Coordinator may record round results.");
          },
        })}
      />,
    );

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.selectOptions(within(row).getByRole("combobox"), "selected");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/central placement coordinator/i);
  });
});
