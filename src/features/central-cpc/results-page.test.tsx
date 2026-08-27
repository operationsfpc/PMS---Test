// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("ResultsPage — bulk recording (M2, approved 2026-08-21)", () => {
  it("lists everyone who took part, with their attendance", async () => {
    render(<ResultsPage roundId="r1" view={view()} />);

    expect(await screen.findByText("Priya Ramesh")).toBeDefined();
    expect(screen.getByText(/absent/i)).toBeDefined();
  });

  it("marks the checked students Selected — after ONE confirmation naming them", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(<ResultsPage roundId="r1" view={view({ record })} />);

    await user.click(await screen.findByRole("checkbox", { name: /priya ramesh/i }));
    await user.click(screen.getByRole("button", { name: /mark selected/i }));

    // The students are notified the moment this lands, so the screen asks first.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/1 student/i);
    expect(dialog.textContent).toMatch(/priya ramesh/i);
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(record).toHaveBeenCalledWith("r1", "app1", "selected"));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("cancelling the confirmation records nothing and keeps the selection", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(<ResultsPage roundId="r1" view={view({ record })} />);

    await user.click(await screen.findByRole("checkbox", { name: /priya ramesh/i }));
    await user.click(screen.getByRole("button", { name: /mark rejected/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(record).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("checkbox", { name: /priya ramesh/i }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("marks On hold without ceremony — an interim state notifies nobody", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(<ResultsPage roundId="r1" view={view({ record })} />);

    await user.click(await screen.findByRole("checkbox", { name: /priya ramesh/i }));
    await user.click(screen.getByRole("button", { name: /mark on hold/i }));

    await waitFor(() => expect(record).toHaveBeenCalledWith("r1", "app1", "on_hold"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("select-all-undecided ticks exactly the rows without a result; Clear unticks", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(<ResultsPage roundId="r1" view={view({ record })} />);

    await user.click(await screen.findByRole("button", { name: /select all undecided/i }));
    // Priya has no result; Arjun is already rejected.
    expect(
      (screen.getByRole("checkbox", { name: /priya ramesh/i }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: /arjun menon/i }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByText(/1 selected of 1 undecided/i)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(
      (screen.getByRole("checkbox", { name: /priya ramesh/i }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("holds the action buttons disabled until somebody is checked", async () => {
    render(<ResultsPage roundId="r1" view={view()} />);

    await screen.findByText("Priya Ramesh");
    expect(
      (screen.getByRole("button", { name: /mark selected/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("marks several students in one confirmed action", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(
      <ResultsPage
        roundId="r1"
        view={view({
          participants: async () => [PRIYA, { ...ARJUN, result: null }],
          record,
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /select all undecided/i }));
    await user.click(screen.getByRole("button", { name: /mark selected/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/2 students/i);
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record).toHaveBeenCalledWith("r1", "app1", "selected");
    expect(record).toHaveBeenCalledWith("r1", "app2", "selected");
  });

  /**
   * F1 (UAT 2026-08-19): once a student sits in a later round, their result
   * here is history — the screen shows it and refuses to re-open it.
   */
  it("offers no checkbox for a student already advanced (F1)", async () => {
    render(
      <ResultsPage
        roundId="r1"
        view={view({ participants: async () => [{ ...PRIYA, result: "selected" }, ARJUN] })}
        locked={new Set(["app1"])}
      />,
    );

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).queryByRole("checkbox")).toBeNull();
    expect(within(row).getByText(/advanced/i)).toBeDefined();
  });

  it("shows a result that was already recorded, as words", async () => {
    render(<ResultsPage roundId="r1" view={view()} />);

    const row = (await screen.findByText("Arjun Menon")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText(/rejected/i)).toBeDefined();
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

    await user.click(await screen.findByRole("checkbox", { name: /priya ramesh/i }));
    await user.click(screen.getByRole("button", { name: /mark selected/i }));
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
      roundFacts: async () => new Map(),
      renameRound: async () => undefined,
      removeRound: async () => undefined,
      completionFacts: async () => ({ ready: true, undecided: 0 }),
      completeDrive: async () => undefined,
      // 2026-08-26: nobody has been offered anything unless a test says so.
      offerHolders: async () => new Set<string>(),
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

  /**
   * UAT 2026-08-21: "the Advance button gets stuck / does not work initially;
   * it works when the page is reloaded." The embedded ResultsPage recorded
   * results into ITS OWN state and refreshed only itself — the parent's
   * `advancing` count (which arms the button) was never re-read, so the
   * button sat disabled until F5. Recording a result must arm the button
   * without a page reload.
   */
  it("arms the Advance button the moment a result is recorded — no reload needed", async () => {
    // A stateful double: Priya starts undecided; record() flips her.
    let priyaResult: RoundParticipant["result"] = null;
    const participants = vi.fn(async (roundId: string) =>
      roundId === "r1" ? [{ ...PRIYA, result: priyaResult }, ARJUN] : [],
    );
    const record = vi.fn(async (_round: string, _app: string, result: "selected") => {
      priyaResult = result;
    });
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={driveView({ participants, record })} />);

    // Nobody selected yet — the button stands disarmed (G6a).
    const before = await screen.findByRole("button", { name: /advance to round 2/i });
    expect((before as HTMLButtonElement).disabled).toBe(true);

    // Mark Priya Selected through the embedded results bar.
    await user.click(await screen.findByRole("checkbox", { name: /priya ramesh/i }));
    await user.click(screen.getByRole("button", { name: /mark selected/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    // The button must arm on its own — F5 is not a step in the workflow.
    expect(
      await screen.findByRole("button", { name: /advance 1 selected to round 2/i }),
    ).toBeDefined();
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
      roundFacts: async () => new Map(),
      renameRound: async () => undefined,
      removeRound: async () => undefined,
      completionFacts: async () => ({ ready: true, undecided: 0 }),
      completeDrive: async () => undefined,
      offerHolders: async () => new Set<string>(),
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

  /**
   * SPEC CHANGE 2026-08-26: matching moved out of the view and into the domain,
   * against the roster this screen is showing (the live "no participant carries
   * these roll numbers" bug). So only the MATCHED rows now travel to the view,
   * and an unmatched roll number is reported without a round trip.
   */
  it("uploads per-student slots by CSV and reports what matched (F5)", async () => {
    const assignSlots = vi.fn().mockResolvedValue({ matched: 1, unmatched: [] });
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
        `roll_number,meeting_link,scheduled_at\n${NOT_BEGUN.rollNumber},https://meet.google.com/abc,2026-09-01T10:30\n21CSE9999,https://meet.google.com/def,`,
      ],
      "slots.csv",
      { type: "text/csv" },
    );
    await user.upload(screen.getByLabelText(/per-student links/i), csv);

    // SPEC CHANGE 2026-08-27 (approved): the upload is STAGED; Save is what
    // sends it. WHAT gets matched and sent is unchanged, so every assertion
    // below stands exactly as it did.
    await user.click(screen.getByRole("button", { name: /save round details/i }));

    await waitFor(() => expect(assignSlots).toHaveBeenCalled());
    const [roundId, assignments] = assignSlots.mock.calls[0] as [
      string,
      { applicationId: string }[],
    ];
    expect(roundId).toBe("r1");
    expect(assignments.map((a) => a.applicationId)).toEqual([NOT_BEGUN.applicationId]);

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

/**
 * M2 (approved 2026-08-21) — managing rounds and completing the drive from
 * the rounds screen. B2: a company drops a round mid-drive; the Central CPC
 * knocks it off or renames it, unless facts have frozen it. C3 (answer 3b):
 * completing early demands a typed reason.
 */
describe("DriveRoundsPage — manage rounds (B2)", () => {
  const ROUNDS3 = [
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
      name: "HR",
      mode: null,
      scheduledAt: null,
      interviewLink: null,
      venue: null,
    },
  ];

  function manageView(overrides: Partial<DriveRoundsView> = {}): DriveRoundsView {
    return {
      ...view(),
      rounds: async () => ROUNDS3,
      advance: async () => 1,
      addRound: async () => undefined,
      updateRound: async () => undefined,
      assignSlots: async () => ({ matched: 0, unmatched: [] }),
      setParticipantSlot: async () => undefined,
      roundFacts: async () =>
        new Map([
          ["r1", { hasParticipants: true, hasAttendance: true, hasResults: true }],
          ["r2", { hasParticipants: false, hasAttendance: false, hasResults: false }],
        ]),
      renameRound: async () => undefined,
      removeRound: async () => undefined,
      completionFacts: async () => ({ ready: true, undecided: 0 }),
      completeDrive: async () => undefined,
      offerHolders: async () => new Set<string>(),
      ...overrides,
    };
  }

  const routed = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it("freezes a round with recorded facts, and says why", async () => {
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={manageView()} />);

    await user.click(await screen.findByRole("button", { name: /manage rounds/i }));

    const dialog = await screen.findByRole("dialog", { name: /manage rounds/i });
    expect(within(dialog).getByText(/frozen — results are recorded/i)).toBeDefined();
    // The frozen round offers neither rename nor remove.
    expect(within(dialog).queryByRole("textbox", { name: /rename round 1/i })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /remove round 1/i })).toBeNull();
  });

  it("renames an untouched round", async () => {
    const renameRound = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={manageView({ renameRound })} />);

    await user.click(await screen.findByRole("button", { name: /manage rounds/i }));
    const dialog = await screen.findByRole("dialog", { name: /manage rounds/i });
    const input = within(dialog).getByRole("textbox", { name: /rename round 2/i });
    await user.clear(input);
    await user.type(input, "HR discussion");
    await user.click(within(dialog).getByRole("button", { name: /save name/i }));

    await waitFor(() => expect(renameRound).toHaveBeenCalledWith("r2", "HR discussion"));
  });

  it("removes an untouched round after a confirmation", async () => {
    const removeRound = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={manageView({ removeRound })} />);

    await user.click(await screen.findByRole("button", { name: /manage rounds/i }));
    const dialog = await screen.findByRole("dialog", { name: /manage rounds/i });
    await user.click(within(dialog).getByRole("button", { name: /remove round 2/i }));

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toMatch(/renumber/i);
    await user.click(within(confirm).getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(removeRound).toHaveBeenCalledWith("d1", "r2"));
  });
});

describe("DriveRoundsPage — mark drive completed (C3, answer 3b)", () => {
  const ROUND1 = [
    {
      roundId: "r1",
      sequence: 1,
      name: "Aptitude",
      mode: null,
      scheduledAt: null,
      interviewLink: null,
      venue: null,
    },
  ];

  function completionView(overrides: Partial<DriveRoundsView> = {}): DriveRoundsView {
    return {
      ...view(),
      rounds: async () => ROUND1,
      advance: async () => 1,
      addRound: async () => undefined,
      updateRound: async () => undefined,
      assignSlots: async () => ({ matched: 0, unmatched: [] }),
      setParticipantSlot: async () => undefined,
      roundFacts: async () => new Map(),
      renameRound: async () => undefined,
      removeRound: async () => undefined,
      completionFacts: async () => ({ ready: true, undecided: 0 }),
      completeDrive: async () => undefined,
      offerHolders: async () => new Set<string>(),
      ...overrides,
    };
  }

  const routed = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it("completes a fully-decided drive without demanding a reason", async () => {
    const completeDrive = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={completionView({ completeDrive })} />);

    await user.click(await screen.findByRole("button", { name: /mark drive completed/i }));
    const dialog = await screen.findByRole("alertdialog", { name: /complete/i });
    expect(dialog.textContent).toMatch(/every applicant has a final outcome/i);
    await user.click(within(dialog).getByRole("button", { name: /complete drive/i }));

    await waitFor(() => expect(completeDrive).toHaveBeenCalledWith("d1", null));
  });

  it("demands a reason when students are still undecided, and sends it", async () => {
    const completeDrive = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    routed(
      <DriveRoundsPage
        driveId="d1"
        view={completionView({
          completeDrive,
          completionFacts: async () => ({ ready: false, undecided: 3 }),
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /mark drive completed/i }));
    const dialog = await screen.findByRole("alertdialog", { name: /complete/i });
    expect(dialog.textContent).toMatch(/3 student/i);

    // No reason typed: refused, with the domain's words.
    await user.click(within(dialog).getByRole("button", { name: /complete drive/i }));
    expect(completeDrive).not.toHaveBeenCalled();
    expect(dialog.textContent).toMatch(/give a reason/i);

    await user.type(
      within(dialog).getByRole("textbox", { name: /reason/i }),
      "Company closed the process after Round 1",
    );
    await user.click(within(dialog).getByRole("button", { name: /complete drive/i }));

    await waitFor(() =>
      expect(completeDrive).toHaveBeenCalledWith("d1", "Company closed the process after Round 1"),
    );
  });
});

/**
 * 2026-08-26 (Karthik, screenshots 17.27.04/.12/.19): "the status on the right
 * still shows as Selected and their checkbox remains active … update this
 * status label to Offer Declared and prevent further selection actions."
 *
 * F1 locked students who had moved on to a LATER round. The FINAL round has
 * none — and that is exactly where offers are declared, so the one row that
 * must never be re-decided was the one row nothing protected.
 */
describe("ResultsPage — a declared offer closes the row", () => {
  const offered = () =>
    render(
      <ResultsPage
        roundId="r1"
        view={view({ participants: async () => [{ ...PRIYA, result: "selected" }, ARJUN] })}
        offered={new Set(["app1"])}
      />,
    );

  const rowFor = async (name: string) => {
    const row = (await screen.findByText(name)).closest("li");
    if (row === null) throw new Error("row not found");
    return row;
  };

  it("says the offer was declared, not that they were selected", async () => {
    offered();

    const row = await rowFor("Priya Ramesh");
    expect(within(row).getByText("Offer declared")).toBeDefined();
    expect(within(row).queryByText("Selected")).toBeNull();
  });

  it("takes the checkbox away, so no bulk action can reach them", async () => {
    offered();

    const row = await rowFor("Priya Ramesh");
    expect(within(row).queryByRole("checkbox")).toBeNull();
  });

  it("leaves every other student decidable", async () => {
    offered();

    const row = await rowFor("Arjun Menon");
    expect(within(row).getByRole("checkbox")).toBeDefined();
  });

  /** An offer is the outcome: it outranks the advance, and the advance's note. */
  it("reports the offer rather than the advance when both are true", async () => {
    render(
      <ResultsPage
        roundId="r1"
        view={view({ participants: async () => [{ ...PRIYA, result: "selected" }, ARJUN] })}
        locked={new Set(["app1"])}
        offered={new Set(["app1"])}
      />,
    );

    const row = await rowFor("Priya Ramesh");
    expect(within(row).getByText("Offer declared")).toBeDefined();
    expect(within(row).queryByText(/advanced/i)).toBeNull();
  });

  it("still records results for everyone else while an offer stands", async () => {
    const record = vi.fn();
    const user = userEvent.setup();
    render(
      <ResultsPage
        roundId="r1"
        view={view({
          participants: async () => [
            { ...PRIYA, result: "selected" },
            { ...ARJUN, result: null },
          ],
          record,
        })}
        offered={new Set(["app1"])}
      />,
    );

    await user.click(await screen.findByRole("checkbox", { name: /arjun menon/i }));
    await user.click(screen.getByRole("button", { name: /mark selected/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(record).toHaveBeenCalledWith("r1", "app2", "selected"));
    expect(record).toHaveBeenCalledTimes(1);
  });
});

/**
 * The rounds page is what knows the drive, so it is what can ask who holds an
 * offer. The embedded ResultsPage is handed the answer, exactly as it is
 * handed F1's lock.
 */
describe("DriveRoundsPage — offers reach the round", () => {
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
  ];

  const driveView = (overrides: Partial<DriveRoundsView> = {}): DriveRoundsView => ({
    ...view({ participants: async () => [{ ...PRIYA, result: "selected" }, ARJUN] }),
    rounds: async () => ROUNDS,
    advance: async () => 1,
    addRound: async () => undefined,
    updateRound: async () => undefined,
    assignSlots: async () => ({ matched: 0, unmatched: [] }),
    setParticipantSlot: async () => undefined,
    roundFacts: async () => new Map(),
    renameRound: async () => undefined,
    removeRound: async () => undefined,
    completionFacts: async () => ({ ready: true, undecided: 0 }),
    completeDrive: async () => undefined,
    offerHolders: async () => new Set<string>(),
    ...overrides,
  });

  it("closes the row of a student who already holds an offer", async () => {
    render(
      <MemoryRouter>
        <DriveRoundsPage
          driveId="d1"
          view={driveView({ offerHolders: async () => new Set(["app1"]) })}
        />
      </MemoryRouter>,
    );

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText("Offer declared")).toBeDefined();
    expect(within(row).queryByRole("checkbox")).toBeNull();
  });

  it("asks about this drive's offers, not every offer in the system", async () => {
    const offerHolders = vi.fn().mockResolvedValue(new Set<string>());
    render(
      <MemoryRouter>
        <DriveRoundsPage driveId="d1" view={driveView({ offerHolders })} />
      </MemoryRouter>,
    );

    await screen.findByText("Priya Ramesh");
    expect(offerHolders).toHaveBeenCalledWith("d1");
  });

  it("leaves every row open when nobody has been offered anything", async () => {
    render(
      <MemoryRouter>
        <DriveRoundsPage driveId="d1" view={driveView()} />
      </MemoryRouter>,
    );

    const row = (await screen.findByText("Priya Ramesh")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByRole("checkbox")).toBeDefined();
    expect(within(row).getByText("Selected")).toBeDefined();
  });
});

/**
 * UAT 2026-08-26 (live, `docs/inbox/WhatsApp Image 2026-08-26 at 16.22.25 (1).jpeg`):
 * "No participant in this round carries these roll numbers: 124, BCA2023156.
 * 0 links assigned." — while the list underneath showed both roll numbers.
 * The screen and the matcher were reading two different sources.
 *
 * Karthik, same message: "it would help if the CSV upload had a downloadable
 * template with the correct headers … there's no sample to reference."
 */
describe("DriveRoundsPage — the CSV template and the matching it guarantees", () => {
  const ROUNDS = [
    {
      roundId: "r1",
      sequence: 1,
      name: "Aptitude",
      mode: "virtual" as const,
      scheduledAt: null,
      interviewLink: null,
      venue: null,
    },
  ];

  const SHASH: RoundParticipant = {
    applicationId: "app-shash",
    studentName: "TestShash",
    rollNumber: "BCA2023156",
    attendance: "scheduled",
    result: null,
  };
  const THANUSH: RoundParticipant = {
    applicationId: "app-thanush",
    studentName: "Thanush Krishna",
    rollNumber: "124",
    attendance: "scheduled",
    result: null,
  };

  function detailView(overrides: Partial<DriveRoundsView> = {}): DriveRoundsView {
    return {
      participants: async () => [SHASH, THANUSH],
      record: async () => undefined,
      rounds: async () => ROUNDS,
      advance: async () => 0,
      addRound: async () => undefined,
      updateRound: async () => undefined,
      assignSlots: async () => ({ matched: 0, unmatched: [] }),
      setParticipantSlot: async () => undefined,
      roundFacts: async () => new Map(),
      renameRound: async () => undefined,
      removeRound: async () => undefined,
      completionFacts: async () => ({ ready: true, undecided: 0 }),
      completeDrive: async () => undefined,
      offerHolders: async () => new Set<string>(),
      ...overrides,
    };
  }

  const routed = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

  const csv = (text: string) => new File([text], "slots.csv", { type: "text/csv" });

  it("downloads a template pre-filled with THIS round's roll numbers", async () => {
    const download = vi.fn();
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={detailView()} download={download} />);

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.click(screen.getByRole("button", { name: /template/i }));

    expect(download).toHaveBeenCalledTimes(1);
    const [filename, text] = download.mock.calls[0] as [string, string];
    expect(filename).toMatch(/\.csv$/);
    // The header states the date format — the only instruction that travels
    // with the file into Excel.
    expect(text).toBe(
      "roll_number,meeting_link,date (dd-mm-yyyy),time (hh:mm)\nBCA2023156,,,\n124,,,\n",
    );
  });

  it("matches the roll numbers the screen is showing — the live bug", async () => {
    const assignSlots = vi.fn().mockResolvedValue({ matched: 2, unmatched: [] });
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={detailView({ assignSlots })} />);

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.upload(
      screen.getByLabelText(/per-student links/i),
      csv(
        "roll_number,meeting_link,scheduled_at\nBCA2023156,https://meet.google.com/abc,2026-09-01T10:30\n124,https://meet.google.com/def,",
      ),
    );

    // SPEC CHANGE 2026-08-27 (approved): the upload is STAGED; Save is what
    // sends it. WHAT gets matched and sent is unchanged, so every assertion
    // below stands exactly as it did.
    await user.click(screen.getByRole("button", { name: /save round details/i }));

    await waitFor(() => expect(assignSlots).toHaveBeenCalled());
    const [roundId, assignments] = assignSlots.mock.calls[0] as [
      string,
      { applicationId: string; meetingLink: string; scheduledAt: string | null }[],
    ];
    expect(roundId).toBe("r1");
    expect(assignments).toEqual([
      {
        applicationId: "app-shash",
        rollNumber: "BCA2023156",
        meetingLink: "https://meet.google.com/abc",
        scheduledAt: "2026-09-01T10:30",
      },
      {
        applicationId: "app-thanush",
        rollNumber: "124",
        meetingLink: "https://meet.google.com/def",
        scheduledAt: null,
      },
    ]);
  });

  it("matches despite the case and padding a spreadsheet leaves behind", async () => {
    const assignSlots = vi.fn().mockResolvedValue({ matched: 1, unmatched: [] });
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={detailView({ assignSlots })} />);

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.upload(
      screen.getByLabelText(/per-student links/i),
      csv(
        '"roll_number","meeting_link","scheduled_at"\n" bca2023156 ","https://meet.google.com/abc",',
      ),
    );

    // SPEC CHANGE 2026-08-27 (approved): the upload is STAGED; Save is what
    // sends it. WHAT gets matched and sent is unchanged, so every assertion
    // below stands exactly as it did.
    await user.click(screen.getByRole("button", { name: /save round details/i }));

    await waitFor(() => expect(assignSlots).toHaveBeenCalled());
    const [, assignments] = assignSlots.mock.calls[0] as [string, { applicationId: string }[]];
    expect(assignments.map((a) => a.applicationId)).toEqual(["app-shash"]);
  });

  it("still names a roll number that is genuinely not in this round, and sends nothing for it", async () => {
    const assignSlots = vi.fn().mockResolvedValue({ matched: 1, unmatched: [] });
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={detailView({ assignSlots })} />);

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.upload(
      screen.getByLabelText(/per-student links/i),
      csv(
        "roll_number,meeting_link,scheduled_at\n124,https://meet.google.com/def,\n21CSE9999,https://meet.google.com/zzz,",
      ),
    );

    // SPEC CHANGE 2026-08-27 (approved): the upload is STAGED; Save is what
    // sends it. WHAT gets matched and sent is unchanged, so every assertion
    // below stands exactly as it did.
    await user.click(screen.getByRole("button", { name: /save round details/i }));

    await waitFor(() => expect(assignSlots).toHaveBeenCalled());
    const [, assignments] = assignSlots.mock.calls[0] as [string, { applicationId: string }[]];
    expect(assignments.map((a) => a.applicationId)).toEqual(["app-thanush"]);
    expect((await screen.findByRole("alert")).textContent).toMatch(/21CSE9999/);
  });

  it("does not call the server at all when nothing in the file matches", async () => {
    const assignSlots = vi.fn();
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={detailView({ assignSlots })} />);

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.upload(
      screen.getByLabelText(/per-student links/i),
      csv("roll_number,meeting_link,scheduled_at\n21CSE9999,https://meet.google.com/zzz,"),
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/21CSE9999/);
    expect(assignSlots).not.toHaveBeenCalled();
  });

  it("reports a link the server accepted for nobody rather than claiming success", async () => {
    const assignSlots = vi.fn().mockResolvedValue({ matched: 0, unmatched: ["124"] });
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={detailView({ assignSlots })} />);

    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.upload(
      screen.getByLabelText(/per-student links/i),
      csv("roll_number,meeting_link,scheduled_at\n124,https://meet.google.com/def,"),
    );
    // SPEC CHANGE 2026-08-27 (approved): the upload is STAGED; Save is what
    // sends it. A link the server accepts for nobody is still reported as
    // exactly that, which is what this test exists to hold.
    await user.click(screen.getByRole("button", { name: /save round details/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/124/);
    expect(alert.textContent).toMatch(/0 links assigned/i);
  });

  /**
   * UAT 2026-08-27 (live, `docs/inbox/WhatsApp Image 2026-08-27 at 13.51.34.jpeg`):
   * the same file uploaded with `1pm` in the time column produced "No
   * participant in this round carries these roll numbers: BCA2023156, 124. 0
   * links assigned." — both were in the round. `1pm` reached Postgres as
   * `1pm:00+05:30`; every write failed and the failure was reported as a
   * roll-number mismatch. Without the time column the same file worked.
   */
  describe("the time column", () => {
    const SCHEDULED = ROUNDS.map((round) => ({ ...round, scheduledAt: "2026-08-27T13:42" }));

    it("reads a clock time against the round's own day", async () => {
      const assignSlots = vi.fn().mockResolvedValue({ matched: 1, unmatched: [] });
      const user = userEvent.setup();
      routed(
        <DriveRoundsPage
          driveId="d1"
          view={detailView({ assignSlots, rounds: async () => SCHEDULED })}
        />,
      );

      await user.click(await screen.findByRole("button", { name: /edit round details/i }));
      await user.upload(
        screen.getByLabelText(/per-student links/i),
        csv("roll_number,meeting_link,scheduled_at\n124, https://meet.google.com/def,1pm"),
      );

      // SPEC CHANGE 2026-08-27 (approved): the upload is STAGED; Save is what
      // sends it. WHAT gets matched and sent is unchanged, so every assertion
      // below stands exactly as it did.
      await user.click(screen.getByRole("button", { name: /save round details/i }));

      await waitFor(() => expect(assignSlots).toHaveBeenCalled());
      const [, assignments] = assignSlots.mock.calls[0] as [string, { scheduledAt: string }[]];
      expect(assignments[0]?.scheduledAt).toBe("2026-08-27T13:00");
    });

    it("blames the time, not the students, when the time cannot be read", async () => {
      const assignSlots = vi.fn();
      const user = userEvent.setup();
      routed(
        <DriveRoundsPage
          driveId="d1"
          view={detailView({ assignSlots, rounds: async () => SCHEDULED })}
        />,
      );

      await user.click(await screen.findByRole("button", { name: /edit round details/i }));
      await user.upload(
        screen.getByLabelText(/per-student links/i),
        csv("roll_number,meeting_link,scheduled_at\n124,https://meet.google.com/def,after lunch"),
      );

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/line 2/i);
      expect(alert.textContent).not.toMatch(/carries these roll numbers/i);
      expect(assignSlots).not.toHaveBeenCalled();
    });

    it("uses the date being typed into the round, not only the saved one", async () => {
      const assignSlots = vi.fn().mockResolvedValue({ matched: 1, unmatched: [] });
      const user = userEvent.setup();
      routed(<DriveRoundsPage driveId="d1" view={detailView({ assignSlots })} />);

      await user.click(await screen.findByRole("button", { name: /edit round details/i }));
      fireEvent.change(screen.getByLabelText(/scheduled at/i), {
        target: { value: "2026-09-04T09:00" },
      });
      await user.upload(
        screen.getByLabelText(/per-student links/i),
        csv("roll_number,meeting_link,scheduled_at\n124,https://meet.google.com/def,10:30"),
      );

      // SPEC CHANGE 2026-08-27 (approved): the upload is STAGED; Save is what
      // sends it. WHAT gets matched and sent is unchanged, so every assertion
      // below stands exactly as it did.
      await user.click(screen.getByRole("button", { name: /save round details/i }));

      await waitFor(() => expect(assignSlots).toHaveBeenCalled());
      const [, assignments] = assignSlots.mock.calls[0] as [string, { scheduledAt: string }[]];
      expect(assignments[0]?.scheduledAt).toBe("2026-09-04T10:30");
    });
  });
});

/**
 * 🔴 UAT 2026-08-27 — `docs/inbox/WhatsApp Image 2026-08-27 at 17.53.23.jpeg`.
 *
 * The banner read "2 links assigned and notified." while the round form was
 * still open, its date still empty, and Save still unpressed. Choosing the
 * file wrote the slots and fired `meeting_slot_reaches_student` (0054) — so
 * students were told a time before the coordinator had committed to one, and
 * the Cancel button two inches away could not take it back.
 *
 * SPEC CHANGE 2026-08-27 (approved, option 1): the upload is STAGED. Nothing
 * is written and nobody is notified until "Save round details".
 */
describe("the CSV upload waits for Save", () => {
  const ROUNDS = [
    {
      roundId: "r1",
      sequence: 1,
      name: "Aptitude",
      mode: "virtual" as const,
      scheduledAt: null,
      interviewLink: null,
      venue: null,
    },
  ];

  const SHASH: RoundParticipant = {
    applicationId: "app-shash",
    studentName: "TestShash",
    rollNumber: "BCA2023156",
    attendance: "scheduled",
    result: null,
  };
  const THANUSH: RoundParticipant = {
    applicationId: "app-thanush",
    studentName: "Thanush Krishna",
    rollNumber: "124",
    attendance: "scheduled",
    result: null,
  };

  const view = (overrides: Partial<DriveRoundsView> = {}) =>
    ({
      participants: async () => [SHASH, THANUSH],
      record: async () => undefined,
      rounds: async () => ROUNDS,
      advance: async () => 0,
      addRound: async () => undefined,
      updateRound: async () => undefined,
      assignSlots: async () => ({ matched: 0, unmatched: [] }),
      setParticipantSlot: async () => undefined,
      roundFacts: async () => new Map(),
      renameRound: async () => undefined,
      removeRound: async () => undefined,
      completionFacts: async () => ({ ready: true, undecided: 0 }),
      completeDrive: async () => undefined,
      offerHolders: async () => new Set<string>(),
      ...overrides,
    }) as DriveRoundsView;

  const routed = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
  const csv = (text: string) => new File([text], "slots.csv", { type: "text/csv" });
  const GOOD = "roll_number,meeting_link,scheduled_at\nBCA2023156,https://meet.google.com/abc,\n";

  const openAndUpload = async (v: DriveRoundsView, text = GOOD) => {
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={v} />);
    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.upload(screen.getByLabelText(/per-student links/i), csv(text));
    return user;
  };

  it("sends nothing when the file is chosen", async () => {
    const assignSlots = vi.fn().mockResolvedValue({ matched: 1, unmatched: [] });
    await openAndUpload(view({ assignSlots }));

    // The count is reported, so the coordinator knows the file was read…
    expect((await screen.findByRole("status")).textContent).toMatch(/1 link ready/i);
    // …and NOTHING has left the building.
    expect(assignSlots).not.toHaveBeenCalled();
  });

  it("says plainly that saving is what sends them", async () => {
    await openAndUpload(view());

    expect((await screen.findByRole("status")).textContent).toMatch(
      /nothing is sent until you save/i,
    );
  });

  it("sends them on Save, after the round's own details", async () => {
    const order: string[] = [];
    const updateRound = vi.fn(async () => {
      order.push("updateRound");
    });
    const assignSlots = vi.fn(async () => {
      order.push("assignSlots");
      return { matched: 1, unmatched: [] };
    });
    const user = await openAndUpload(view({ updateRound, assignSlots }));

    await user.click(screen.getByRole("button", { name: /save round details/i }));

    await waitFor(() => expect(assignSlots).toHaveBeenCalledTimes(1));
    // The round's mode and time must land BEFORE a student is told their slot,
    // or the schedule notification describes a round that has none.
    expect(order).toEqual(["updateRound", "assignSlots"]);
  });

  it("reports what was sent only once it has been sent", async () => {
    const assignSlots = vi.fn().mockResolvedValue({ matched: 1, unmatched: [] });
    const user = await openAndUpload(view({ assignSlots }));

    await user.click(screen.getByRole("button", { name: /save round details/i }));

    expect((await screen.findByRole("status")).textContent).toMatch(
      /1 link assigned and notified/i,
    );
  });

  /** The whole point: Cancel must be able to take it back. */
  it("discards the staged links when the coordinator cancels", async () => {
    const assignSlots = vi.fn();
    const user = await openAndUpload(view({ assignSlots }));
    await screen.findByRole("status");

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.click(screen.getByRole("button", { name: /save round details/i }));

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeNull());
    expect(assignSlots).not.toHaveBeenCalled();
  });

  it("stages nothing when the file cannot be read, and still names the line", async () => {
    const assignSlots = vi.fn();
    const user = await openAndUpload(
      view({ assignSlots }),
      "roll_number,meeting_link,date (dd-mm-yyyy),time (hh:mm)\nBCA2023156,https://meet.google.com/abc,,half past one\n",
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/line 2/i);
    await user.click(screen.getByRole("button", { name: /save round details/i }));
    expect(assignSlots).not.toHaveBeenCalled();
  });

  it("saves the round details even when no file was chosen", async () => {
    const updateRound = vi.fn();
    const assignSlots = vi.fn();
    const user = userEvent.setup();
    routed(<DriveRoundsPage driveId="d1" view={view({ updateRound, assignSlots })} />);
    await user.click(await screen.findByRole("button", { name: /edit round details/i }));
    await user.click(screen.getByRole("button", { name: /save round details/i }));

    await waitFor(() => expect(updateRound).toHaveBeenCalledTimes(1));
    expect(assignSlots).not.toHaveBeenCalled();
  });
});
