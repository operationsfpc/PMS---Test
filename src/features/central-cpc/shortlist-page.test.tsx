// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  type ShortlistApplicant,
  type ShortlistDecision,
  ShortlistPage,
  type ShortlistView,
} from "./shortlist-page";

/**
 * Internal shortlisting, against real applicants.
 *
 * Two things this screen must never get wrong:
 *  1. Ranking and rationale are INTERNAL. A student must never see their score.
 *  2. The ranking is advisory. The human decision is what ships, and both are
 *     recorded so the recommendation quality can be reviewed later (PRD 13.1).
 */
const DRIVE = {
  driveId: "d1",
  companyName: "Zoho",
  roleTitle: "MTS",
  roleCategory: "software_technical" as const,
  mandatorySkills: ["TypeScript"],
};

const WEAK: ShortlistApplicant = {
  applicationId: "app-weak",
  studentName: "Weak Candidate",
  rollNumber: "21CSE0002",
  overallCgpa: 6,
  currentArrears: 2,
  historyOfArrears: 3,
  skillScores: [],
  preferredRoleCategories: [],
  shortlisted: false,
};

const STRONG: ShortlistApplicant = {
  applicationId: "app-strong",
  studentName: "Strong Candidate",
  rollNumber: "21CSE0001",
  overallCgpa: 9.5,
  currentArrears: 0,
  historyOfArrears: 0,
  skillScores: [{ skill: "TypeScript", score: 95 }],
  preferredRoleCategories: ["software_technical"],
  shortlisted: false,
};

const APPLICANTS: readonly ShortlistApplicant[] = [WEAK, STRONG];

function view(overrides: Partial<ShortlistView> = {}): ShortlistView {
  return {
    drive: async () => DRIVE,
    applicants: async () => APPLICANTS,
    saveShortlist: async () => undefined,
    ...overrides,
  };
}

describe("ShortlistPage", () => {
  it("ranks the strongest applicant first, using the domain rule", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);

    const rows = await screen.findAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("Strong Candidate")).toBeDefined();
  });

  it("shows why each candidate scored what they did", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);

    const row = (await screen.findByText("Weak Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText(/standing arrear/i)).toBeDefined();
  });

  it("warns that ranking is internal and never shown to students", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);

    expect(await screen.findByText(/never shown to students/i)).toBeDefined();
  });

  /**
   * PRD 13.1: the recommendation is recorded ALONGSIDE the human decision, so
   * recommendation quality can be reviewed later. Saving only the ticked boxes
   * would throw away the half that makes it auditable.
   */
  it("saves the decision and the recommendation that produced it", async () => {
    const saveShortlist = vi.fn();
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={view({ saveShortlist })} />);

    const row = (await screen.findByText("Weak Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.click(within(row).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /shortlist 1/i }));

    await waitFor(() => expect(saveShortlist).toHaveBeenCalledTimes(1));

    const [driveId, decisions] = saveShortlist.mock.calls[0] as [string, ShortlistDecision[]];
    expect(driveId).toBe("d1");

    const weak = decisions.find((d) => d.applicationId === "app-weak");
    const strong = decisions.find((d) => d.applicationId === "app-strong");

    expect(weak?.included).toBe(true);
    expect(strong?.included).toBe(false);
    // The strong candidate ranks first even though they were not picked.
    expect(strong?.rank).toBe(1);
    expect(weak?.rationale).toMatch(/standing arrear/i);
    expect(weak?.score).toBeLessThan(strong?.score ?? 0);
  });

  it("pre-selects anyone already shortlisted", async () => {
    render(
      <ShortlistPage
        driveId="d1"
        view={view({
          applicants: async () => [{ ...STRONG, shortlisted: true }],
        })}
      />,
    );

    const row = (await screen.findByText("Strong Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    expect((within(row).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("says so plainly when nobody has applied", async () => {
    render(<ShortlistPage driveId="d1" view={view({ applicants: async () => [] })} />);

    expect(await screen.findByText(/nobody has applied/i)).toBeDefined();
  });

  it("surfaces a failed save instead of pretending it worked", async () => {
    const user = userEvent.setup();
    render(
      <ShortlistPage
        driveId="d1"
        view={view({
          saveShortlist: async () => {
            throw new Error("Only the Central Placement Coordinator may shortlist.");
          },
        })}
      />,
    );

    const row = (await screen.findByText("Weak Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.click(within(row).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /shortlist 1/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/central placement coordinator/i);
  });
});
