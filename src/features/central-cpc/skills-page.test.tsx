// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type SkillArea, type SkillStudentRow, SkillsPage, type SkillsView } from "./skills-page";

/**
 * PRD §5 — the Central Student Skill Repository screen.
 *
 * The Central CPC maintains institutional scores per student: singly, in
 * bulk across selected students, and in bulk from a CSV. Every path funnels
 * through the same domain validation, because these numbers later decide a
 * shortlist.
 */

const AREAS: readonly SkillArea[] = [
  { id: "a1", name: "Aptitude" },
  { id: "a2", name: "AI skills" },
];

const PRIYA: SkillStudentRow = {
  studentId: "s1",
  studentName: "Priya Ramesh",
  rollNumber: "21CSE1042",
  campusName: "Alliance University",
  scores: { a1: 4 },
};

const ARJUN: SkillStudentRow = {
  studentId: "s2",
  studentName: "Arjun Menon",
  rollNumber: "21CSE9001",
  campusName: "VIT Bangalore",
  scores: {},
};

function view(overrides: Partial<SkillsView> = {}): SkillsView {
  return {
    areas: async () => AREAS,
    students: async () => [PRIYA, ARJUN],
    addArea: async (name) => ({ id: "new", name }),
    saveScores: async () => undefined,
    ...overrides,
  };
}

const rowOf = async (name: string) => {
  const cell = await screen.findByText(name);
  const row = cell.closest("tr");
  if (row === null) throw new Error(`row for ${name} not found`);
  return row;
};

describe("SkillsPage — the grid", () => {
  it("shows each student with their scores, and a dash where none is recorded", async () => {
    render(<SkillsPage view={view()} />);

    const priya = await rowOf("Priya Ramesh");
    expect(within(priya).getByText("4")).toBeDefined();

    const arjun = await rowOf("Arjun Menon");
    // No score is "—", never 0 — unmeasured must not read as a mark.
    expect(within(arjun).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("has a column per skill area", async () => {
    render(<SkillsPage view={view()} />);
    expect(await screen.findByRole("columnheader", { name: "Aptitude" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "AI skills" })).toBeDefined();
  });

  /**
   * D7 (UAT 2026-08-19): "column headings should freeze/stick, since they
   * currently disappear when the CPC scrolls down." Sticky positioning has no
   * accessible-role equivalent, so the class IS the behaviour here.
   */
  it("keeps the column headers stuck to the top while scrolling (D7)", async () => {
    render(<SkillsPage view={view()} />);
    const header = await screen.findByRole("columnheader", { name: "Aptitude" });
    const thead = header.closest("thead");
    expect(thead?.className).toMatch(/sticky/);
    expect(thead?.className).toMatch(/top-0/);
  });

  it("filters by name or roll number", async () => {
    const user = userEvent.setup();
    render(<SkillsPage view={view()} />);
    await screen.findByText("Priya Ramesh");

    await user.type(screen.getByLabelText(/search students/i), "arjun");

    expect(screen.queryByText("Priya Ramesh")).toBeNull();
    expect(screen.getByText("Arjun Menon")).toBeDefined();
  });

  it("says so when there are no students", async () => {
    render(<SkillsPage view={view({ students: async () => [] })} />);
    expect(await screen.findByText(/no students on the roster yet/i)).toBeDefined();
  });
});

describe("SkillsPage — editing one student", () => {
  it("saves only the cells that changed", async () => {
    const saveScores = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ saveScores })} />);

    await user.click(await screen.findByRole("button", { name: /edit priya ramesh/i }));
    const priya = await rowOf("Priya Ramesh");
    await user.type(within(priya).getByLabelText("AI skills"), "3");
    await user.click(within(priya).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(saveScores).toHaveBeenCalledWith([{ studentId: "s1", skillAreaId: "a2", score: 3 }]),
    );
  });

  it("clearing an existing score removes it — it does not become zero", async () => {
    const saveScores = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ saveScores })} />);

    await user.click(await screen.findByRole("button", { name: /edit priya ramesh/i }));
    const priya = await rowOf("Priya Ramesh");
    await user.clear(within(priya).getByLabelText("Aptitude"));
    await user.click(within(priya).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(saveScores).toHaveBeenCalledWith([
        { studentId: "s1", skillAreaId: "a1", score: null },
      ]),
    );
  });

  it("refuses an invalid score with the domain's reason, and saves nothing", async () => {
    const saveScores = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ saveScores })} />);

    await user.click(await screen.findByRole("button", { name: /edit priya ramesh/i }));
    const priya = await rowOf("Priya Ramesh");
    await user.type(within(priya).getByLabelText("AI skills"), "101");
    await user.click(within(priya).getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("between 1 and 5"),
    );
    expect(saveScores).not.toHaveBeenCalled();
  });

  it("cancel discards the edit without saving", async () => {
    const saveScores = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ saveScores })} />);

    await user.click(await screen.findByRole("button", { name: /edit priya ramesh/i }));
    const priya = await rowOf("Priya Ramesh");
    await user.type(within(priya).getByLabelText("AI skills"), "40");
    await user.click(within(priya).getByRole("button", { name: /cancel/i }));

    expect(saveScores).not.toHaveBeenCalled();
    expect(within(await rowOf("Priya Ramesh")).queryByLabelText("AI skills")).toBeNull();
  });
});

describe("SkillsPage — skill areas", () => {
  it("adds a new area through the view and shows it as a column", async () => {
    const addArea = vi.fn(async (name: string) => ({ id: "a3", name }));
    const user = userEvent.setup();
    render(<SkillsPage view={view({ addArea })} />);
    await screen.findByText("Priya Ramesh");

    await user.type(screen.getByLabelText(/new skill area/i), "Cloud fundamentals");
    await user.click(screen.getByRole("button", { name: /add skill area/i }));

    await waitFor(() => expect(addArea).toHaveBeenCalledWith("Cloud fundamentals"));
    expect(await screen.findByRole("columnheader", { name: "Cloud fundamentals" })).toBeDefined();
  });

  it("refuses a duplicate area without calling the view", async () => {
    const addArea = vi.fn(async (name: string) => ({ id: "a3", name }));
    const user = userEvent.setup();
    render(<SkillsPage view={view({ addArea })} />);
    await screen.findByText("Priya Ramesh");

    await user.type(screen.getByLabelText(/new skill area/i), "  ai   SKILLS ");
    await user.click(screen.getByRole("button", { name: /add skill area/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("already exists"),
    );
    expect(addArea).not.toHaveBeenCalled();
  });
});

describe("SkillsPage — bulk apply to selected students", () => {
  it("applies one area's score to every selected student", async () => {
    const saveScores = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ saveScores })} />);
    await screen.findByText("Priya Ramesh");

    await user.click(screen.getByRole("checkbox", { name: /select priya ramesh/i }));
    await user.click(screen.getByRole("checkbox", { name: /select arjun menon/i }));
    await user.selectOptions(screen.getByLabelText(/^skill area$/i), "a2");
    await user.type(screen.getByLabelText(/^score$/i), "2");
    await user.click(screen.getByRole("button", { name: /apply to 2 selected/i }));

    await waitFor(() =>
      expect(saveScores).toHaveBeenCalledWith([
        { studentId: "s1", skillAreaId: "a2", score: 2 },
        { studentId: "s2", skillAreaId: "a2", score: 2 },
      ]),
    );
  });

  it("select all selects every visible student", async () => {
    const saveScores = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ saveScores })} />);
    await screen.findByText("Priya Ramesh");

    await user.click(screen.getByRole("checkbox", { name: /select all/i }));
    await user.selectOptions(screen.getByLabelText(/^skill area$/i), "a1");
    await user.type(screen.getByLabelText(/^score$/i), "5");
    await user.click(screen.getByRole("button", { name: /apply to 2 selected/i }));

    await waitFor(() => expect(saveScores).toHaveBeenCalled());
  });

  it("refuses an invalid bulk score with a reason, and saves nothing", async () => {
    const saveScores = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ saveScores })} />);
    await screen.findByText("Priya Ramesh");

    await user.click(screen.getByRole("checkbox", { name: /select priya ramesh/i }));
    await user.selectOptions(screen.getByLabelText(/^skill area$/i), "a1");
    await user.type(screen.getByLabelText(/^score$/i), "abc");
    await user.click(screen.getByRole("button", { name: /apply to 1 selected/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("is not a number"),
    );
    expect(saveScores).not.toHaveBeenCalled();
  });
});

describe("SkillsPage — CSV import", () => {
  const upload = (user: ReturnType<typeof userEvent.setup>, content: string) => {
    const file = new File([content], "scores.csv", { type: "text/csv" });
    return user.upload(screen.getByLabelText(/scores file/i), file);
  };

  it("previews the parsed sheet and imports it mapped to student and area ids", async () => {
    const saveScores = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ saveScores })} />);
    await screen.findByText("Priya Ramesh");

    await upload(user, "roll_number,Aptitude,AI skills\n21CSE1042,5,3\n21CSE9001,,2\n");

    expect(await screen.findByText(/2 rows ready to import/i)).toBeDefined();
    await user.click(screen.getByRole("button", { name: /import 2 rows/i }));

    await waitFor(() =>
      expect(saveScores).toHaveBeenCalledWith([
        { studentId: "s1", skillAreaId: "a1", score: 5 },
        { studentId: "s1", skillAreaId: "a2", score: 3 },
        { studentId: "s2", skillAreaId: "a2", score: 2 },
      ]),
    );
  });

  it("reports a roll number that is not on the roster, and imports the rest", async () => {
    const saveScores = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ saveScores })} />);
    await screen.findByText("Priya Ramesh");

    await upload(user, "roll_number,Aptitude\n21CSE1042,5\nNOBODY,3\n");

    expect(await screen.findByText(/row 3/i)).toBeDefined();
    expect(screen.getByText(/"NOBODY" is not on the roster/i)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /import 1 row/i }));
    await waitFor(() =>
      expect(saveScores).toHaveBeenCalledWith([{ studentId: "s1", skillAreaId: "a1", score: 5 }]),
    );
  });

  it("shows a fatal parse problem as an error and offers no import", async () => {
    const user = userEvent.setup();
    render(<SkillsPage view={view()} />);
    await screen.findByText("Priya Ramesh");

    await upload(user, "roll_number,Juggling\n21CSE1042,5\n");

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("not a skill area"),
    );
    expect(screen.queryByRole("button", { name: /import/i })).toBeNull();
  });

  it("offers a template download named after the current areas", async () => {
    render(<SkillsPage view={view()} />);
    await screen.findByText("Priya Ramesh");

    const link = screen.getByRole<HTMLAnchorElement>("link", { name: /download template/i });
    expect(link.download).toBe("skill-scores-template.csv");
    const href = decodeURIComponent(link.href);
    expect(href).toContain("roll_number,Aptitude,AI skills");
    // Roll numbers are prefilled so the coordinator types scores, not identities.
    expect(href).toContain("21CSE1042");
  });
});

describe("SkillsPage — outcomes", () => {
  it("confirms a save and reloads the grid", async () => {
    const students = vi
      .fn(async () => [PRIYA, ARJUN])
      .mockResolvedValueOnce([PRIYA, ARJUN])
      .mockResolvedValue([{ ...PRIYA, scores: { a1: 4, a2: 3 } }, ARJUN]);
    const user = userEvent.setup();
    render(<SkillsPage view={view({ students })} />);

    await user.click(await screen.findByRole("button", { name: /edit priya ramesh/i }));
    const priya = await rowOf("Priya Ramesh");
    await user.type(within(priya).getByLabelText("AI skills"), "3");
    await user.click(within(priya).getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      expect.stringContaining("Saved 1 score"),
    );
    expect(within(await rowOf("Priya Ramesh")).getByText("3")).toBeDefined();
  });

  it("surfaces a failed save as an error, not silence", async () => {
    const user = userEvent.setup();
    render(
      <SkillsPage
        view={view({
          saveScores: async () => {
            throw new Error("boom");
          },
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /edit priya ramesh/i }));
    const priya = await rowOf("Priya Ramesh");
    await user.type(within(priya).getByLabelText("AI skills"), "2");
    await user.click(within(priya).getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Could not save"),
    );
  });
});
