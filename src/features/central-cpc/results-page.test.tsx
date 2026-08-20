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
    {
      roundId: "r1",
      sequence: 1,
      name: "Aptitude",
      mode: null,
      scheduledAt: null,
      interviewLink: null,
      venue: null,
    },
    {
      roundId: "r2",
      sequence: 2,
      name: "Technical",
      mode: null,
      scheduledAt: null,
      interviewLink: null,
      venue: null,
    },
  ];

  function driveView(overrides: Partial<DriveRoundsView> = {}): DriveRoundsView {
    return {
      ...view(),
      rounds: async () => ROUNDS,
      advance: async () => 1,
      addRound: async () => undefined,
      updateRound: async () => undefined,
      assignSlots: async () => ({ matched: 0, unmatched: [] }),
      setParticipantSlot: async () => undefined,
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
    // F3 (UAT 2026-08-19): the advance asks first, offering a proof upload.
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(advance).toHaveBeenCalledWith("r1", "r2", null));
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

    // Priya is the only selected — and she has already gone. Nothing to
    // advance — but the button stays VISIBLE and disabled (G6a, UAT
    // 2026-08-20: "No Advance to Round 2 button available" must never be the
    // report again).
    const advance = screen.getByRole("button", { name: /advance to round 2/i });
    expect((advance as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * G6a (UAT 2026-08-20): "No 'Advance to Round 2' button available." The
   * button only rendered once someone was marked Selected, so a coordinator
   * on a fresh round saw nothing and reasonably reported the feature missing.
   * It now stands disabled with the instruction that makes it light up.
   */
  it("shows a disabled Advance button with instructions when nobody is selected yet (G6a)", async () => {
    routed(
      <DriveRoundsPage
        driveId="d1"
        view={driveView({
          participants: async (roundId) =>
            roundId === "r1" ? [{ ...PRIYA, result: null }, ARJUN] : [],
        })}
      />,
    );

    await screen.findByText("Priya Ramesh");
    const advance = await screen.findByRole("button", { name: /advance to round 2/i });
    expect((advance as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/only selected students advance/i)).toBeDefined();
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
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    // After the reload Priya is locked (she sits in Round 2 now) — the
    // advance button DISARMS rather than lying about 1 more to move (G6a:
    // it stays visible, disabled, so it never reads as missing).
    await waitFor(() => {
      const button = screen.getByRole("button", { name: /advance to round 2/i });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });
    expect(await screen.findByRole("status")).toBeDefined();
  });
});

/**
 * UAT 2026-08-19 — F3 (proof of the company's instruction travels with the
 * advance) · F4 (a round's details are editable after creation) · F5 (per-
 * student meeting links, singly or by CSV).
 */
describe("DriveRoundsPage — round details, proof and meeting links", () => {
  const ROUNDS = [
    {
      roundId: "r1",
      sequence: 1,
      name: "Aptitude",
      mode: "virtual" as const,
      scheduledAt: "2026-09-01T10:30",
      interviewLink: "https://meet.google.com/shared",
      venue: null,
    },
    {
      roundId: "r2",
      sequence: 2,
      name: "Technical",
      mode: null,
      scheduledAt: null,
      interviewLink: null,
      venue: null,
    },
  ];

  /** G6c: a participant who has not yet begun — details stay editable. */
  const NOT_BEGUN: RoundParticipant = {
    applicationId: "app3",
    studentName: "Kavya Nair",
    rollNumber: "21CSE3007",
    attendance: "scheduled",
    result: null,
  };

  function detailView(overrides: Partial<DriveRoundsView> = {}): DriveRoundsView {
    return {
      participants: async (roundId) =>
        roundId === "r1" ? [{ ...PRIYA, result: "selected" as const }, ARJUN] : [],
      record: async () => undefined,
      rounds: async () => ROUNDS,
      advance: async () => 1,
      addRound: async () => undefined,
      updateRound: async () => undefined,
      assignSlots: async () => ({ matched: 0, unmatched: [] }),
      setParticipantSlot: async () => undefined,
      ...overrides,
    };
  }

  const routed = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it("edits a round's mode, time and link after creation (F4) — while nobody has begun (G6c)", async () => {
    const updateRound = vi.fn();
    const user = userEvent.setup();
    routed(
      <DriveRoundsPage
        driveId="d1"
        view={detailView({ updateRound, participants: async () => [NOT_BEGUN] })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.selectOptions(screen.getByLabelText(/round mode/i), "on_campus");
    await user.click(screen.getByRole("button", { name: /save round details/i }));

    // Switching to a physical mode swaps the link for a venue (G6b) — the
    // abandoned link is CLEARED, not smuggled through (the J2 lesson).
    await waitFor(() =>
      expect(updateRound).toHaveBeenCalledWith("r1", {
        mode: "on_campus",
        scheduledAt: "2026-09-01T10:30",
        interviewLink: null,
        venue: null,
      }),
    );
  });

  it("a physical round takes a VENUE — an address, not a URL (G6b)", async () => {
    const updateRound = vi.fn();
    const user = userEvent.setup();
    routed(
      <DriveRoundsPage
        driveId="d1"
        view={detailView({ updateRound, participants: async () => [NOT_BEGUN] })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.selectOptions(screen.getByLabelText(/round mode/i), "physical_outside_campus");

    // The link box is gone; a venue box stands in its place.
    expect(screen.queryByLabelText(/shared interview link/i)).toBeNull();
    await user.type(
      screen.getByLabelText(/venue/i),
      "Taj Coromandel, 37 MG Road, Nungambakkam, Chennai",
    );
    await user.click(screen.getByRole("button", { name: /save round details/i }));

    await waitFor(() =>
      expect(updateRound).toHaveBeenCalledWith("r1", {
        mode: "physical_outside_campus",
        scheduledAt: "2026-09-01T10:30",
        interviewLink: null,
        venue: "Taj Coromandel, 37 MG Road, Nungambakkam, Chennai",
      }),
    );
  });

  it("names the modes in plain words — Online, Physical on/outside campus (G6b)", async () => {
    const user = userEvent.setup();
    routed(
      <DriveRoundsPage driveId="d1" view={detailView({ participants: async () => [NOT_BEGUN] })} />,
    );

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    const select = screen.getByLabelText(/round mode/i);
    const labels = within(select as HTMLElement)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels).toContain("Online");
    expect(labels).toContain("Physical — on campus");
    expect(labels).toContain("Physical — outside campus");
  });

  it("locks round details once a student has begun participating (G6c)", async () => {
    // Priya is marked present and carries a result — participation has begun.
    routed(<DriveRoundsPage driveId="d1" view={detailView()} />);

    await screen.findByText("Priya Ramesh");
    expect(screen.queryByRole("button", { name: /edit round details/i })).toBeNull();
    expect(screen.getByText(/locked/i)).toBeDefined();
  });

  it("attaches an optional proof to the advance (F3)", async () => {
    const advance = vi.fn().mockResolvedValue(1);
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={detailView({ advance })} />);

    await user.click(await screen.findByRole("button", { name: /advance 1 selected to round 2/i }));

    const dialog = await screen.findByRole("alertdialog");
    const proof = new File(["mail"], "company-mail.pdf", { type: "application/pdf" });
    await user.upload(within(dialog).getByLabelText(/proof of company communication/i), proof);
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(advance).toHaveBeenCalled());
    const [from, to, file] = advance.mock.calls[0] as [string, string, File | null];
    expect(from).toBe("r1");
    expect(to).toBe("r2");
    expect(file?.name).toBe("company-mail.pdf");
  });

  it("advances with NO proof — it is optional (F3)", async () => {
    const advance = vi.fn().mockResolvedValue(1);
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={detailView({ advance })} />);

    await user.click(await screen.findByRole("button", { name: /advance 1 selected to round 2/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(advance).toHaveBeenCalled());
    expect((advance.mock.calls[0] as unknown[])[2]).toBeNull();
  });

  it("uploads per-student slots by CSV and reports what matched (F5)", async () => {
    const assignSlots = vi.fn().mockResolvedValue({ matched: 1, unmatched: ["21CSE9999"] });
    const user = userEvent.setup();
    // G6c: links are assigned BEFORE the round runs — nobody has begun.
    routed(
      <DriveRoundsPage
        driveId="d1"
        view={detailView({ assignSlots, participants: async () => [NOT_BEGUN] })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    const csv = new File(
      [
        "roll_number,meeting_link,scheduled_at\n21CSE1042,https://meet.google.com/abc,2026-09-01T10:30\n21CSE9999,https://meet.google.com/def,",
      ],
      "slots.csv",
      { type: "text/csv" },
    );
    await user.upload(screen.getByLabelText(/per-student links/i), csv);

    await waitFor(() => expect(assignSlots).toHaveBeenCalled());
    const [roundId, slots] = assignSlots.mock.calls[0] as [string, unknown[]];
    expect(roundId).toBe("r1");
    expect(slots).toHaveLength(2);

    // The coordinator is told who was NOT matched, by roll number.
    expect((await screen.findByRole("alert")).textContent).toMatch(/21CSE9999/);
  });

  it("refuses a CSV whose header is wrong, naming the expected one (F5)", async () => {
    const assignSlots = vi.fn();
    const user = userEvent.setup();
    routed(
      <DriveRoundsPage
        driveId="d1"
        view={detailView({ assignSlots, participants: async () => [NOT_BEGUN] })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.upload(
      screen.getByLabelText(/per-student links/i),
      new File(["name,link\nPriya,https://x"], "bad.csv", { type: "text/csv" }),
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/roll_number,meeting_link/);
    expect(assignSlots).not.toHaveBeenCalled();
  });

  it("saves one student's own link from their row (F5)", async () => {
    const setParticipantSlot = vi.fn();
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={detailView({ setParticipantSlot })} />);

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.type(
      within(row).getByLabelText(/meeting link for priya ramesh/i),
      "https://meet.google.com/priya",
    );
    await user.click(within(row).getByRole("button", { name: /save link/i }));

    await waitFor(() =>
      expect(setParticipantSlot).toHaveBeenCalledWith(
        "r1",
        "app1",
        "https://meet.google.com/priya",
        null,
      ),
    );
  });
});
