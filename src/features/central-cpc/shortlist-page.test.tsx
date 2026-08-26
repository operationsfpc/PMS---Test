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

/**
 * F2 (UAT 2026-08-19): saving asks first. The dialog's confirm button, found
 * once the dialog has opened.
 */
const confirmButton = async () =>
  within(await screen.findByRole("alertdialog")).getByRole("button", { name: /confirm/i });

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
    await user.click(await confirmButton());

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

  /**
   * SPEC CHANGE 2026-08-21 (Karthik): "Even though the shortlisted people are
   * shown with a tag, subsequently I can still select them and shortlist them
   * again." This test used to assert they came back PRE-TICKED — which is
   * exactly what made re-shortlisting possible. They now live on their own
   * read-only tab instead.
   */
  it("keeps the already-shortlisted OFF the working tab — on their own, read-only", async () => {
    const user = userEvent.setup();
    render(
      <ShortlistPage
        driveId="d1"
        view={view({
          applicants: async () => [{ ...STRONG, shortlisted: true }, WEAK],
        })}
      />,
    );

    // The working tab holds only the undecided.
    await screen.findByText("Weak Candidate");
    expect(screen.queryByText("Strong Candidate")).toBeNull();

    // The shortlisted tab shows them — with the badge, without a checkbox.
    await user.click(screen.getByRole("button", { name: /^shortlisted \(1\)/i }));
    const row = (await screen.findByText("Strong Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText(/shortlisted/i)).toBeDefined();
    expect(within(row).queryByRole("checkbox")).toBeNull();
  });

  /** The save must not carry the already-shortlisted — they are decided. */
  it("never re-submits an already-shortlisted student with the save", async () => {
    const saveShortlist = vi.fn();
    const user = userEvent.setup();
    render(
      <ShortlistPage
        driveId="d1"
        view={view({
          applicants: async () => [{ ...STRONG, shortlisted: true }, WEAK],
          saveShortlist,
        })}
      />,
    );

    const row = (await screen.findByText("Weak Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    await user.click(within(row).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /shortlist 1/i }));
    await user.click(await confirmButton());

    await waitFor(() => expect(saveShortlist).toHaveBeenCalledTimes(1));
    const [, decisions] = saveShortlist.mock.calls[0] as [string, ShortlistDecision[]];
    expect(decisions.map((d) => d.applicationId)).toEqual(["app-weak"]);
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
    await user.click(await confirmButton());

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
    await user.click(await confirmButton());

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
    await user.click(await confirmButton());
  };

  it("confirms the shortlist was saved, and says how many are on it", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={persistingView()} />);

    await shortlistOne(user);

    const saved = await screen.findByRole("status");
    expect(saved.textContent).toMatch(/1 student/i);
    expect(saved.textContent).toMatch(/shortlist/i);
  });

  /**
   * SPEC CHANGE 2026-08-21: a saved student now MOVES to the Shortlisted tab
   * rather than staying put with a badge — the badge alone left them
   * selectable, which is the bug this round fixes.
   */
  it("moves the saved students to the Shortlisted tab", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={persistingView()} />);

    await shortlistOne(user);
    await screen.findByRole("status");

    // Gone from the working tab…
    expect(screen.queryByText("Strong Candidate")).toBeNull();

    // …present, badged and un-tickable on the Shortlisted tab.
    await user.click(screen.getByRole("button", { name: /^shortlisted \(1\)/i }));
    const row = (await screen.findByText("Strong Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText(/shortlisted/i)).toBeDefined();
    expect(within(row).queryByRole("checkbox")).toBeNull();
  });

  it("clears the confirmation as soon as the selection changes again", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={persistingView()} />);

    await shortlistOne(user);
    await screen.findByRole("status");

    // Strong moved to the Shortlisted tab; ticking someone still undecided
    // makes the confirmation stale.
    await user.click(screen.getByRole("checkbox", { name: /shortlist weak candidate/i }));

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
    await user.click(await confirmButton());

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

  /**
   * ⚠️ REWRITTEN 2026-08-24 (answers 5a/5b) — the CSV became the zip pack:
   * shortlist.xlsx + resumes/, hyperlinked, zipped; and a missing resume now
   * BLOCKS the export instead of merely being named beside a download.
   */
  it("downloads the zip pack — sheet + resumes — and logs it (5a)", async () => {
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
          resumeFiles: async () =>
            new Map([["resume-1", { data: new Uint8Array([1]).buffer, extension: ".pdf" }]]),
          logExport,
        })}
        download={download}
      />,
    );

    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("button", { name: /export recruiter pack/i }));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [filename, content] = download.mock.calls[0] as [string, Blob];
    expect(filename).toMatch(/zoho.*\.zip$/i);
    expect(content).toBeInstanceOf(Blob);
    expect(logExport).toHaveBeenCalledWith("d1", expect.arrayContaining(["Resume"]), 1);
  });

  it("BLOCKS the export when a shortlisted candidate has no resume (5b)", async () => {
    const download = vi.fn();
    const logExport = vi.fn();
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
          logExport,
        })}
        download={download}
      />,
    );

    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("button", { name: /export recruiter pack/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/R9/);
    // Nothing left the building and nothing was logged as if it had.
    expect(download).not.toHaveBeenCalled();
    expect(logExport).not.toHaveBeenCalled();
  });
});

/**
 * UAT 2026-08-19: D6 (advisory target count) · D8 (the drive's skills on the
 * screen) · D9 (select all) · F2 (a confirmation guards the save).
 */
describe("ShortlistPage — UAT 2026-08-19", () => {
  it("selects every eligible applicant with one Select all (D9)", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={view()} />);

    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("checkbox", { name: /select all/i }));

    expect(screen.getByRole("button", { name: /shortlist 2/i })).toBeDefined();

    // And unticking it clears them all again.
    await user.click(screen.getByRole("checkbox", { name: /select all/i }));
    expect(screen.getByRole("button", { name: /shortlist 0/i })).toBeDefined();
  });

  it("Select all never picks up an opted-out applicant by stealth (D9)", async () => {
    const OPTED: ShortlistApplicant = {
      ...WEAK,
      applicationId: "app-opted",
      studentName: "Opted Out Candidate",
      optedOut: true,
    };
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={view({ applicants: async () => [OPTED, STRONG] })} />);

    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("checkbox", { name: /select all/i }));

    expect(screen.getByRole("button", { name: /shortlist 1/i })).toBeDefined();
  });

  it("asks before saving, and cancel saves nothing (F2)", async () => {
    const saveShortlist = vi.fn();
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={view({ saveShortlist })} />);

    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("checkbox", { name: /shortlist strong candidate/i }));
    await user.click(screen.getByRole("button", { name: /shortlist 1/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/1 student/i);
    expect(dialog.textContent).toMatch(/notified/i);

    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(saveShortlist).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows an advisory target and counts against it (D6)", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={view()} />);

    await screen.findByText("Strong Candidate");
    await user.type(screen.getByLabelText(/target shortlist size/i), "5");
    await user.click(screen.getByRole("checkbox", { name: /shortlist strong candidate/i }));

    expect(screen.getByText(/1 of 5 selected/i)).toBeDefined();
  });

  it("shows the drive's required skills to the coordinator (D8)", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);

    await screen.findByText("Strong Candidate");
    expect(screen.getByText(/skills required/i)).toBeDefined();
    expect(screen.getByText("TypeScript")).toBeDefined();
  });

  it("says plainly when the PIF recorded no skills, instead of nothing (D8)", async () => {
    render(
      <ShortlistPage
        driveId="d1"
        view={view({ drive: async () => ({ ...DRIVE, mandatorySkills: [] }) })}
      />,
    );

    await screen.findByText("Strong Candidate");
    expect(screen.getByText(/no specific skills recorded/i)).toBeDefined();
  });
});

/**
 * SPEC CHANGE 2026-08-17 (Karthik): "we can remove the display of 15 number
 * with the description of it. This is not used currently."
 *
 * The number was `rankApplicants`' weighted score. Labelling it (earlier the
 * same day) answered "what is it?" but not "what is it for?" - and the honest
 * answer was nothing: the coordinator shortlists on the facts, not the score.
 *
 * The RANKING SURVIVES. It still orders the list, and the score and rationale
 * are still WRITTEN on save, because PRD 13.1 requires the recommendation to
 * be stored next to the decision so the two can be compared later. What has
 * gone is the presentation of a number nobody acted on.
 */
describe("the match score is not shown", () => {
  it("shows no score figure on any row", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);
    await screen.findByText(/strong candidate/i);

    expect(screen.queryAllByRole("figure")).toHaveLength(0);
    expect(screen.queryByText(/match score/i)).toBeNull();
  });

  it("does not print the raw score anywhere on the row", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);

    const row = await screen.findByRole("listitem", { name: /weak candidate/i });
    // 24 was this applicant's score. The row still shows CGPA 6, so the
    // assertion is about the score specifically, not about digits.
    expect(row.textContent).not.toMatch(/\b24\b/);
    expect(row.textContent).not.toMatch(/\/\s*100/);
  });

  it("no longer explains a score the screen does not show", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);
    await screen.findByText(/strong candidate/i);

    const note = screen.getByText(/never shown to students/i).closest("p");
    expect(note?.textContent).not.toMatch(/match score/i);
    expect(note?.textContent).not.toMatch(/out of 100/i);
  });

  /** The order is still the ranking's, so removing the number changed nothing else. */
  it("still lists the stronger candidate first", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0]?.textContent).toMatch(/strong candidate/i);
  });

  /** PRD 13.1: the recommendation is still recorded, it is just not displayed. */
  it("still saves the score and rationale for the audit trail", async () => {
    const saved: ShortlistDecision[][] = [];
    render(
      <ShortlistPage
        driveId="d1"
        view={view({
          saveShortlist: async (_drive, decisions) => {
            saved.push([...decisions]);
          },
        })}
      />,
    );

    await screen.findByText(/strong candidate/i);
    await userEvent.click(screen.getByRole("button", { name: /^shortlist \d/i }));
    await userEvent.click(await confirmButton());

    const strong = saved[0]?.find((d) => d.applicationId === "app-strong");
    expect(strong?.score).toBeGreaterThan(0);
    expect(strong?.rationale.length).toBeGreaterThan(0);
  });
});

/**
 * G5a (UAT 2026-08-20): the screen said "Scored on 0 of 1 required skills"
 * and nothing else — no visibility into what the student actually has. The
 * student's own scores now stand beside the ranking's verdict.
 */
describe("the applicant's actual skills", () => {
  it("shows each skill with its score out of 5 (G5a)", async () => {
    const skilled: ShortlistApplicant = {
      ...STRONG,
      skillScores: [
        { skill: "Java", score: 4 },
        { skill: "SQL", score: 3 },
      ],
    };
    render(<ShortlistPage driveId="d1" view={view({ applicants: async () => [skilled] })} />);

    const row = (await screen.findByText("Strong Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText(/java 4\/5/i)).toBeDefined();
    expect(within(row).getByText(/sql 3\/5/i)).toBeDefined();
  });

  it("says plainly when no skill scores are recorded (G5a)", async () => {
    render(<ShortlistPage driveId="d1" view={view({ applicants: async () => [WEAK] })} />);

    const row = (await screen.findByText("Weak Candidate")).closest("li");
    if (row === null) throw new Error("row not found");
    expect(within(row).getByText(/no skill scores recorded/i)).toBeDefined();
  });
});

/**
 * 2026-08-26: the button still said "(CSV)" while answer 5a had already made
 * the artefact a ZIP — `shortlist-<company>.zip`, the sheet plus every resume.
 * Karthik reported this as "the Export CSV button", which is what the screen
 * told him it was.
 */
describe("the export button names what it produces", () => {
  it("offers a recruiter pack, not a CSV", async () => {
    render(<ShortlistPage driveId="d1" view={view()} />);

    const button = await screen.findByRole("button", { name: /export/i });
    expect(button.textContent).toMatch(/pack|zip/i);
    expect(button.textContent).not.toMatch(/csv/i);
  });
});

/**
 * UAT 2026-08-26: target set to 1, two candidates ticked, "2 of 1 selected"
 * printed quietly, and the save went through. Saving notifies students and
 * schedules Round 1 — so the mismatch has to be stated where the decision is
 * actually taken: in the confirmation that already guards the save.
 *
 * The target stays advisory (D6). The screen warns; it never blocks.
 */
describe("shortlisting against the recruiter's target (UAT 2026-08-26)", () => {
  async function selectBoth(user: ReturnType<typeof userEvent.setup>, target: string) {
    render(<ShortlistPage driveId="d1" view={view()} />);
    await screen.findByText("Strong Candidate");
    await user.type(screen.getByLabelText(/target shortlist size/i), target);
    await user.click(screen.getByRole("checkbox", { name: /select all/i }));
  }

  it("flags the over-count on the page itself, not just as plain text", async () => {
    const user = userEvent.setup();
    await selectBoth(user, "1");

    const status = screen.getByRole("status", { name: /target/i });
    expect(status.textContent).toMatch(/2 of 1 selected/i);
    expect(status.textContent).toMatch(/1 more than the recruiter asked for/i);
  });

  it("warns inside the confirmation when more are selected than asked for", async () => {
    const user = userEvent.setup();
    await selectBoth(user, "1");
    await user.click(screen.getByRole("button", { name: /shortlist 2/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/2 students selected against a target of 1/i);
    expect(dialog.textContent).toMatch(/1 more than the recruiter asked for/i);
  });

  it("makes the over-count an explicit second click, not a reflex Confirm", async () => {
    const saveShortlist = vi.fn();
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={view({ saveShortlist })} />);

    await screen.findByText("Strong Candidate");
    await user.type(screen.getByLabelText(/target shortlist size/i), "1");
    await user.click(screen.getByRole("checkbox", { name: /select all/i }));
    await user.click(screen.getByRole("button", { name: /shortlist 2/i }));

    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: /confirm/i });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    await user.click(confirm);
    expect(saveShortlist).not.toHaveBeenCalled();

    // Acknowledging the mismatch — and only that — releases the save.
    await user.click(
      within(dialog).getByRole("checkbox", { name: /more than the target|target/i }),
    );
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(saveShortlist).toHaveBeenCalledTimes(1));
  });

  it("warns just as loudly when FEWER than the target are selected", async () => {
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={view()} />);

    await screen.findByText("Strong Candidate");
    await user.type(screen.getByLabelText(/target shortlist size/i), "5");
    await user.click(screen.getByRole("checkbox", { name: /shortlist strong candidate/i }));
    await user.click(screen.getByRole("button", { name: /shortlist 1/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/4 fewer than the recruiter asked for/i);
    expect(
      within(dialog)
        .getByRole("button", { name: /confirm/i })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("counts the already-shortlisted toward the target, as the page does", async () => {
    const user = userEvent.setup();
    render(
      <ShortlistPage
        driveId="d1"
        view={view({ applicants: async () => [{ ...WEAK, shortlisted: true }, STRONG] })}
      />,
    );

    await screen.findByText("Strong Candidate");
    await user.type(screen.getByLabelText(/target shortlist size/i), "2");
    await user.click(screen.getByRole("checkbox", { name: /shortlist strong candidate/i }));
    await user.click(screen.getByRole("button", { name: /shortlist 1/i }));

    // One already shortlisted + one now = the target of 2. Nothing to warn about.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).not.toMatch(/than the recruiter asked for/i);
    expect(
      within(dialog)
        .getByRole("button", { name: /confirm/i })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("asks nothing extra when no target was set — the field is optional", async () => {
    const saveShortlist = vi.fn();
    const user = userEvent.setup();
    render(<ShortlistPage driveId="d1" view={view({ saveShortlist })} />);

    await screen.findByText("Strong Candidate");
    await user.click(screen.getByRole("checkbox", { name: /select all/i }));
    await user.click(screen.getByRole("button", { name: /shortlist 2/i }));
    await user.click(await confirmButton());

    await waitFor(() => expect(saveShortlist).toHaveBeenCalledTimes(1));
  });
});
