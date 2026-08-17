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
  optedOut: false,
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
  optedOut: false,
};

const APPLICANTS: readonly ShortlistApplicant[] = [WEAK, STRONG];

function view(overrides: Partial<ShortlistView> = {}): ShortlistView {
  return {
    drive: async () => DRIVE,
    applicants: async () => APPLICANTS,
    saveShortlist: async () => undefined,
    exportEntries: async () => [],
    logExport: async () => undefined,
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

/**
 * F16 (UAT 2026-08-06): "After shortlisting the candidates, the screen stays
 * the same, this needs to be fixed."
 *
 * Pressing "Shortlist 1" saved and re-read, and every pixel came back
 * identical - same checkboxes, same button, same count. There was no way to
 * tell a save that worked from one that silently did nothing, so coordinators
 * pressed it again.
 */
/**
 * D7 (2026-08-12): "applied but not yet shortlisted should not be
 * shortlisted. This is an alert. Central PC can override."
 */
describe("ShortlistPage \u2014 an opted-out applicant", () => {
  const OPTED: ShortlistApplicant = {
    ...WEAK,
    applicationId: "app-opted",
    studentName: "Opted Out Candidate",
    rollNumber: "21CSE0003",
    optedOut: true,
  };

  it("is flagged with an alert and offered no checkbox", async () => {
    render(<ShortlistPage driveId="d1" view={view({ applicants: async () => [OPTED, STRONG] })} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/opted out/i);
    expect(alert.textContent).toMatch(/Opted Out Candidate/);

    const row = screen.getByText("Opted Out Candidate").closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).queryByRole("checkbox")).toBeNull();
  });

  it("can be overridden with a reason, which the save carries", async () => {
    const saveShortlist = vi.fn();
    const user = userEvent.setup();
    render(
      <ShortlistPage
        driveId="d1"
        view={view({ applicants: async () => [OPTED, STRONG], saveShortlist })}
      />,
    );

    const row = (await screen.findByText("Opted Out Candidate")).closest("li");
    if (row === null) throw new Error("row not found");

    await user.click(within(row).getByRole("button", { name: /override/i }));
    await user.type(within(row).getByLabelText(/reason/i), "Recruiter asked for her by name");
    await user.click(within(row).getByRole("button", { name: /confirm/i }));

    // Overriding makes them selectable; it does not select them by stealth.
    await user.click(within(row).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /shortlist 1/i }));

    await waitFor(() => expect(saveShortlist).toHaveBeenCalledTimes(1));
    const [, decisions] = saveShortlist.mock.calls[0] as [string, ShortlistDecision[]];
    const opted = decisions.find((d) => d.applicationId === "app-opted");
    expect(opted?.included).toBe(true);
    expect(opted?.optOutOverrideReason).toBe("Recruiter asked for her by name");
  });

  it("refuses to confirm an override with no reason", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={view({ applicants: async () => [OPTED] })} />);

    const row = (await screen.findByText("Opted Out Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.click(within(row).getByRole("button", { name: /override/i }));
    await user.click(within(row).getByRole("button", { name: /confirm/i }));

    expect(within(row).queryByRole("checkbox")).toBeNull();
  });
});

/** D8/D9: saving IS the communication, and the screen says so. */
describe("ShortlistPage \u2014 what saving means", () => {
  it("says the save notifies the students and schedules Round 1", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);

    await screen.findByText("Strong Candidate");
    expect(screen.getByText(/notifies the shortlisted students/i)).toBeDefined();
    expect(screen.getByText(/schedules them for round 1/i)).toBeDefined();
  });
});

describe("ShortlistPage \u2014 after saving", () => {
  /** A view that actually remembers what was saved, as the database would. */
  function persistingView(saveShortlist?: ShortlistView["saveShortlist"]): ShortlistView {
    let saved: readonly string[] = [];

    return {
      drive: async () => DRIVE,
      applicants: async () =>
        APPLICANTS.map((a) => ({ ...a, shortlisted: saved.includes(a.applicationId) })),
      exportEntries: async () => [],
      logExport: async () => undefined,
      saveShortlist: async (driveId, decisions) => {
        if (saveShortlist !== undefined) await saveShortlist(driveId, decisions);
        saved = decisions.filter((d) => d.included).map((d) => d.applicationId);
      },
    };
  }

  const shortlistOne = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("checkbox", { name: /shortlist strong candidate/i }));
    await user.click(screen.getByRole("button", { name: /shortlist 1/i }));
  };

  it("confirms the shortlist was saved, and says how many are on it", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={persistingView()} />);

    await shortlistOne(user);

    const saved = await screen.findByRole("status");
    expect(saved.textContent).toMatch(/1 student/i);
    expect(saved.textContent).toMatch(/shortlist/i);
  });

  it("marks the students who are on it, so the list is not just checkboxes again", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={persistingView()} />);

    await shortlistOne(user);
    await screen.findByRole("status");

    const row = screen.getByText("Strong Candidate").closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText(/shortlisted/i)).toBeDefined();
  });

  it("clears the confirmation as soon as the selection changes again", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={persistingView()} />);

    await shortlistOne(user);
    await screen.findByRole("status");

    await user.click(screen.getByRole("checkbox", { name: /shortlist strong candidate/i }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not claim success when the save failed", async () => {
    const user = userEvent.setup();
    render(
      <ShortlistPage
        driveId="d1"
        view={persistingView(async () => {
          throw new Error("Could not save the shortlist.");
        })}
      />,
    );

    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("button", { name: /shortlist 0/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not save/i);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

/** WS8 (2026-08-12): "Export using excel of all shortlisted students." */
describe("ShortlistPage \u2014 exporting the shortlist", () => {
  const snapshot = (roll: string, name: string) => ({
    profile: {
      id: `student-${roll}`,
      rollNumber: roll,
      fullName: name,
      email: `${roll}@x.in`,
      degree: "B.E",
      branch: "CSE",
      passingYear: 2026,
      overallCgpa: 8,
      tenthPercentage: 90,
      twelfthPercentage: 91,
      currentArrears: 0,
      historyOfArrears: 0,
      technicalSkills: "TS",
    },
    resumeId: "resume-1",
  });

  it("downloads a CSV Excel opens \u2014 BOM first, snapshot data, included only \u2014 and logs it", async () => {
    const download = vi.fn();
    const logExport = vi.fn();
    const user = userEvent.setup();
    render(
      <ShortlistPage
        driveId="d1"
        view={view({
          exportEntries: async () => [
            { applicationId: "a1", included: true, snapshot: snapshot("R1", "Priya") },
            { applicationId: "a2", included: false, snapshot: snapshot("R2", "Left Out") },
          ],
          logExport,
        })}
        download={download}
      />,
    );

    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("button", { name: /export shortlist/i }));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [filename, text] = download.mock.calls[0] as [string, string];
    expect(filename).toMatch(/zoho.*\.csv$/i);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("Roll number");
    expect(text).toContain("Priya");
    expect(text).not.toContain("Left Out");
    expect(logExport).toHaveBeenCalledWith("d1", expect.any(Array), 1);
  });

  it("names the shortlisted candidates who have no resume on file", async () => {
    const user = userEvent.setup();
    render(
      <ShortlistPage
        driveId="d1"
        view={view({
          exportEntries: async () => [
            {
              applicationId: "a1",
              included: true,
              snapshot: { ...snapshot("R9", "No Resume"), resumeId: null },
            },
          ],
          logExport: async () => undefined,
        })}
        download={vi.fn()}
      />,
    );

    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("button", { name: /export shortlist/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/R9/);
  });
});

/**
 * 2026-08-17 (Karthik): "what is the number 15? I see that in a lot of places
 * while shortlisting students. It is not clickable. It is not referring to
 * anything else."
 *
 * It was `rankApplicants`' weighted score, rendered as a bare numeral in the
 * corner of every row. A number with no unit and no label is not information:
 * 15 could have been a rank, a count of applicants, an ID or a percentage, and
 * the coordinator had no way to tell which. The value was right; the screen
 * simply never said what it was.
 */
describe("the match score says what it is", () => {
  it("labels the score and shows the scale it is out of", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);

    const row = await screen.findByRole("listitem", { name: /strong candidate/i });
    const score = within(row).getByRole("figure", { name: /match score/i });

    // The scale is the point: 15 alone is meaningless, "15 / 100" is not.
    expect(score.textContent).toMatch(/\/\s*100/);
    expect(score.textContent).toMatch(/match score/i);
  });

  it("still shows the score the domain calculated, unrounded and unaltered", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);

    const row = await screen.findByRole("listitem", { name: /weak candidate/i });
    // CGPA 6/10 -> 24, no skill score -> 0, standing arrears -> 0, role not
    // preferred -> 0. The screen must report the domain's arithmetic, not its own.
    expect(within(row).getByRole("figure", { name: /match score/i }).textContent).toMatch(
      /24\s*\/\s*100/,
    );
  });

  /** The explanation of the number belongs next to the number. */
  it("explains what the score is for, without implying it is a decision", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);
    await screen.findByText(/strong candidate/i);

    const note = screen.getByText(/never shown to students/i).closest("p");
    expect(note?.textContent).toMatch(/match score/i);
    expect(note?.textContent).toMatch(/out of 100/i);
    // Advisory, not a verdict: the tick is the decision, the number is input to it.
    expect(note?.textContent).toMatch(/advisory/i);
  });
});
