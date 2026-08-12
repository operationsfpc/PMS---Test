// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  DriveRoundsPage,
  type DriveRoundsView,
  ResultsPage,
  type ResultsView,
  type RoundParticipant,
} from "./results-page";

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

/**
 * 2026-08-12 (approved spec, WS6): the drive's rounds as numbered tabs, with
 * explicit advancement. "Multiple rounds can be created and added. each round
 * is numbered. in each round, students progress or fail."
 */
describe("DriveRoundsPage — numbered rounds, explicit advancement", () => {
  const ROUNDS = [
    { roundId: "r1", sequence: 1, name: "Aptitude" },
    { roundId: "r2", sequence: 2, name: "Technical" },
  ];

  function driveView(overrides: Partial<DriveRoundsView> = {}): DriveRoundsView {
    return {
      ...view(),
      rounds: async () => ROUNDS,
      advance: async () => 1,
      addRound: async () => undefined,
      ...overrides,
    };
  }

  const routed = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it("numbers each round as a tab", async () => {
    routed(<DriveRoundsPage driveId="d1" view={driveView()} />);

    expect(await screen.findByRole("button", { name: /round 1 · aptitude/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /round 2 · technical/i })).toBeDefined();
  });

  it("advances the selected into the next round, saying how many", async () => {
    const advance = vi.fn().mockResolvedValue(1);
    const user = userEvent.setup();
    routed(
      <DriveRoundsPage
        driveId="d1"
        view={driveView({
          advance,
          participants: async () => [{ ...PRIYA, result: "selected" }, ARJUN],
        })}
      />,
    );

    const button = await screen.findByRole("button", { name: /advance 1 selected to round 2/i });
    await user.click(button);

    await waitFor(() => expect(advance).toHaveBeenCalledWith("r1", "r2"));
  });

  it("offers no advancement from the last round — final selection lives there", async () => {
    const user = userEvent.setup();
    routed(
      <DriveRoundsPage
        driveId="d1"
        view={driveView({ participants: async () => [{ ...PRIYA, result: "selected" }] })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /round 2 · technical/i }));

    expect(screen.queryByRole("button", { name: /advance/i })).toBeNull();
    expect(await screen.findByRole("link", { name: /final selection/i })).toBeDefined();
  });

  it("adds a numbered round on request", async () => {
    const addRound = vi.fn();
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={driveView({ addRound })} />);

    await user.click(await screen.findByRole("button", { name: /add round/i }));
    await user.type(screen.getByLabelText(/round name/i), "HR");
    await user.click(screen.getByRole("button", { name: /create round 3/i }));

    await waitFor(() => expect(addRound).toHaveBeenCalledWith("d1", "HR"));
  });
});
