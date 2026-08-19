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

  it("records a result for one participant — after an explicit confirmation (F2)", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(<ResultsPage roundId="r1" view={view({ record })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.selectOptions(within(row).getByRole("combobox"), "selected");

    // The student is notified the moment this lands, so the screen asks first.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/priya ramesh/i);
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(record).toHaveBeenCalledWith("r1", "app1", "selected"));
  });

  it("cancelling the confirmation records nothing and resets the row (F2)", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(<ResultsPage roundId="r1" view={view({ record })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.selectOptions(within(row).getByRole("combobox"), "rejected");

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(record).not.toHaveBeenCalled();
    expect(within(row).getByRole<HTMLSelectElement>("combobox").value).toBe("");
  });

  it("records an interim state (waitlisted) without ceremony — nobody is notified", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(<ResultsPage roundId="r1" view={view({ record })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.selectOptions(within(row).getByRole("combobox"), "waitlisted");

    await waitFor(() => expect(record).toHaveBeenCalledWith("r1", "app1", "waitlisted"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  /**
   * F1 (UAT 2026-08-19): once a student sits in a later round, their result
   * here is history — the screen shows it and refuses to re-open it.
   */
  it("renders a read-only result for a student already advanced (F1)", async () => {
    render(
      <ResultsPage
        roundId="r1"
        view={view({ participants: async () => [{ ...PRIYA, result: "selected" }, ARJUN] })}
        locked={new Set(["app1"])}
      />,
    );

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).queryByRole("combobox")).toBeNull();
    expect(within(row).getByText(/advanced/i)).toBeDefined();
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
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

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
          // Round-aware: Priya is selected in Round 1 and NOT yet in Round 2 —
          // a fixture that put her in both told F1 she had already advanced.
          participants: async (roundId) =>
            roundId === "r1" ? [{ ...PRIYA, result: "selected" }, ARJUN] : [],
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

  /**
   * F1 (UAT 2026-08-19): a student already sitting in Round 2 cannot have
   * their Round 1 result re-recorded — and they no longer count towards
   * "Advance N", so the button cannot advance the same student twice.
   */
  it("locks earlier-round results for students already advanced", async () => {
    const participants = vi.fn(async (roundId: string) =>
      roundId === "r1" ? [{ ...PRIYA, result: "selected" as const }, ARJUN] : [PRIYA],
    );
    routed(<DriveRoundsPage driveId="d1" view={driveView({ participants })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await waitFor(() => expect(within(row).queryByRole("combobox")).toBeNull());
    expect(within(row).getByText(/advanced/i)).toBeDefined();

    // Priya is the only selected — and she has already gone. Nothing to advance.
    expect(screen.queryByRole("button", { name: /advance/i })).toBeNull();
  });

  /**
   * UAT transcript 2026-08-19: "Advancing students works once but fails on
   * second attempt without a page refresh" — the screen never reloaded after
   * advancing, so it argued with the database until someone pressed F5.
   */
  it("reloads the round after advancing, so the button reflects reality", async () => {
    let advanced = false;
    const participants = vi.fn(async (roundId: string) => {
      if (roundId === "r1") return [{ ...PRIYA, result: "selected" as const }, ARJUN];
      return advanced ? [PRIYA] : [];
    });
    const advance = vi.fn().mockImplementation(async () => {
      advanced = true;
      return 1;
    });
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={driveView({ participants, advance })} />);

    await user.click(await screen.findByRole("button", { name: /advance 1 selected to round 2/i }));

    // After the reload Priya is locked (she sits in Round 2 now) — the
    // advance button is gone rather than lying about 1 more to move.
    await waitFor(() => expect(screen.queryByRole("button", { name: /advance/i })).toBeNull());
    expect(await screen.findByRole("status")).toBeDefined();
  });
});
