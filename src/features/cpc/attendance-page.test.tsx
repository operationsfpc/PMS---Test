// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AttendancePage, type AttendanceView } from "./attendance-page";

/**
 * Marking attendance for a round.
 *
 * Only students the recruiter actually scheduled appear (Q9). A student who
 * applied but was never called must never be markable, because three absences
 * trigger a disbarment review (R8) - so this list IS the safety boundary.
 *
 * Select all / Unselect all is a confirmed requirement: a coordinator with 200
 * students in a hall marks the exceptions, not the rule.
 */
const scheduled = [
  {
    applicationId: "a1",
    studentName: "Asha Ramanathan",
    rollNumber: "TEC001",
    status: "scheduled" as const,
    priorAbsences: 0,
  },
  {
    applicationId: "a2",
    studentName: "Bala Subramanian",
    rollNumber: "TEC002",
    status: "scheduled" as const,
    priorAbsences: 2,
  },
];

function view(overrides: Partial<AttendanceView> = {}): AttendanceView {
  return {
    scheduled: async () => scheduled,
    mark: async () => undefined,
    ...overrides,
  };
}

describe("AttendancePage", () => {
  it("lists only the students scheduled for this round", async () => {
    render(<AttendancePage roundId="r1" view={view()} />);
    expect(await screen.findByText("Asha Ramanathan")).toBeDefined();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("says so when the recruiter has not shortlisted anyone yet", async () => {
    render(<AttendancePage roundId="r1" view={view({ scheduled: async () => [] })} />);
    expect(await screen.findByText(/nobody is scheduled/i)).toBeDefined();
  });

  it("offers select all and unselect all", async () => {
    render(<AttendancePage roundId="r1" view={view()} />);
    expect(await screen.findByRole("button", { name: /^select all$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^unselect all$/i })).toBeDefined();
  });

  it("marks everyone present when select all is used", async () => {
    const user = userEvent.setup();
    render(<AttendancePage roundId="r1" view={view()} />);

    await user.click(await screen.findByRole("button", { name: /^select all$/i }));

    for (const box of screen.getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).checked).toBe(true);
    }
  });

  it("clears everyone when unselect all is used", async () => {
    const user = userEvent.setup();
    render(<AttendancePage roundId="r1" view={view()} />);

    await user.click(await screen.findByRole("button", { name: /^select all$/i }));
    await user.click(screen.getByRole("button", { name: /^unselect all$/i }));

    for (const box of screen.getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
  });

  it("saves present for the ticked and absent for the rest", async () => {
    const mark = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AttendancePage roundId="r1" view={view({ mark })} />);

    await user.click(await screen.findByRole("checkbox", { name: /Asha Ramanathan/i }));
    await user.click(screen.getByRole("button", { name: /save attendance/i }));

    await waitFor(() => expect(mark).toHaveBeenCalledTimes(2));
    expect(mark).toHaveBeenCalledWith("r1", "a1", "present");
    expect(mark).toHaveBeenCalledWith("r1", "a2", "absent");
  });

  it("warns that an absence counts towards a disbarment review", async () => {
    render(<AttendancePage roundId="r1" view={view()} />);
    expect(await screen.findByText(/disbarment review/i)).toBeDefined();
  });

  it("shows each student's prior absences against the limit", async () => {
    render(<AttendancePage roundId="r1" view={view()} />);
    expect(await screen.findByText("2 of 3")).toBeDefined();
  });

  it("warns when marking a student absent would reach the review threshold", async () => {
    // Bala has 2 prior absences; leaving him unticked makes it a third.
    const user = userEvent.setup();
    render(<AttendancePage roundId="r1" view={view()} />);

    await user.click(await screen.findByRole("button", { name: /^unselect all$/i }));

    expect(screen.getAllByText(/triggers review/i).length).toBeGreaterThan(0);
  });

  it("does not cry wolf for a student nowhere near the limit", async () => {
    const user = userEvent.setup();
    render(<AttendancePage roundId="r1" view={view()} />);

    await user.click(await screen.findByRole("button", { name: /^unselect all$/i }));

    // Only Bala triggers it, not Asha.
    expect(screen.getAllByText(/triggers review/i)).toHaveLength(1);
  });

  it("surfaces a refusal rather than pretending attendance saved", async () => {
    const mark = vi.fn().mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    render(<AttendancePage roundId="r1" view={view({ mark })} />);

    await user.click(await screen.findByRole("button", { name: /save attendance/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
  });
});
