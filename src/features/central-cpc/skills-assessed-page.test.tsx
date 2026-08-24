// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillsAssessedPage } from "./skills-assessed-page";
import type { SkillsView } from "./skills-page";

/**
 * Skills assessed (2026-08-24, answers 1a/2a/3a): the master list of core
 * skills students are trained and evaluated on. It feeds three places — the
 * score-upload template's columns, the upload validation, and the AE's
 * mandatory-skills picker — so its management gets a page of its own.
 */
const usage = [
  { id: "a1", name: "AI skills", scoreCount: 3 },
  { id: "a2", name: "Aptitude", scoreCount: 0 },
];

function view(over: Partial<SkillsView> = {}): SkillsView {
  return {
    areas: async () => usage.map(({ id, name }) => ({ id, name })),
    students: async () => [],
    addArea: async (name) => ({ id: "new", name }),
    saveScores: async () => undefined,
    areasWithUsage: async () => usage,
    renameArea: async () => undefined,
    removeArea: async () => undefined,
    ...over,
  };
}

describe("SkillsAssessedPage", () => {
  it("lists every assessed skill with how many scores sit under it", async () => {
    render(<SkillsAssessedPage view={view()} />);

    expect(await screen.findByText("AI skills")).toBeDefined();
    expect(screen.getByText("Aptitude")).toBeDefined();
    expect(screen.getByText(/3 scores/)).toBeDefined();
  });

  it("adds a skill", async () => {
    const addArea = vi.fn(async (name: string) => ({ id: "new", name }));
    const user = userEvent.setup();
    render(<SkillsAssessedPage view={view({ addArea })} />);
    await screen.findByText("AI skills");

    await user.type(screen.getByLabelText(/new skill/i), "Spreadsheet");
    await user.click(screen.getByRole("button", { name: /add skill/i }));

    await waitFor(() => expect(addArea).toHaveBeenCalledWith("Spreadsheet"));
    expect(await screen.findByText("Spreadsheet")).toBeDefined();
  });

  it("renames a skill — the scores follow it (1a)", async () => {
    const renameArea = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsAssessedPage view={view({ renameArea })} />);
    await screen.findByText("AI skills");

    await user.click(screen.getByRole("button", { name: /rename ai skills/i }));
    const input = screen.getByLabelText(/new name for ai skills/i);
    await user.clear(input);
    await user.type(input, "AI fundamentals");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(renameArea).toHaveBeenCalledWith("a1", "AI fundamentals"));
  });

  it("refuses to remove a skill with scores, and says why", async () => {
    const removeArea = vi.fn(async () => undefined);
    render(<SkillsAssessedPage view={view({ removeArea })} />);
    await screen.findByText("AI skills");

    const button = screen.getByRole("button", { name: /remove ai skills/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/3 student scores exist/i)).toBeDefined();
    expect(removeArea).not.toHaveBeenCalled();
  });

  it("removes a skill nobody has been scored on, after confirmation", async () => {
    const removeArea = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SkillsAssessedPage view={view({ removeArea })} />);
    await screen.findByText("Aptitude");

    await user.click(screen.getByRole("button", { name: /remove aptitude/i }));
    await user.click(screen.getByRole("button", { name: /yes, remove/i }));

    await waitFor(() => expect(removeArea).toHaveBeenCalledWith("a2"));
    expect(screen.queryByText("Aptitude")).toBeNull();
  });

  it("says where the list is used", async () => {
    render(<SkillsAssessedPage view={view()} />);
    await screen.findByText("AI skills");
    expect(screen.getByText(/upload template/i)).toBeDefined();
    expect(screen.getByText(/position information form/i)).toBeDefined();
  });
});

describe("SkillsAssessedPage — when things fail", () => {
  it("says the list could not load", async () => {
    render(
      <SkillsAssessedPage
        view={view({
          areasWithUsage: async () => {
            throw new Error("network");
          },
        })}
      />,
    );
    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("shows the view's own words when adding fails", async () => {
    const user = userEvent.setup();
    render(
      <SkillsAssessedPage
        view={view({
          addArea: async () => {
            throw new Error('"Spreadsheet" already exists — two skills cannot share a name.');
          },
        })}
      />,
    );
    await screen.findByText("AI skills");

    await user.type(screen.getByLabelText(/new skill/i), "Spreadsheet");
    await user.click(screen.getByRole("button", { name: /add skill/i }));

    expect(await screen.findByText(/already exists/i)).toBeDefined();
  });

  it("refuses a blank name before the network is asked", async () => {
    const addArea = vi.fn();
    const user = userEvent.setup();
    render(<SkillsAssessedPage view={view({ addArea })} />);
    await screen.findByText("AI skills");

    await user.click(screen.getByRole("button", { name: /add skill/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(addArea).not.toHaveBeenCalled();
  });

  it("refuses a rename that collides with another skill, client-side", async () => {
    const renameArea = vi.fn();
    const user = userEvent.setup();
    render(<SkillsAssessedPage view={view({ renameArea })} />);
    await screen.findByText("AI skills");

    await user.click(screen.getByRole("button", { name: /rename ai skills/i }));
    const input = screen.getByLabelText(/new name for ai skills/i);
    await user.clear(input);
    await user.type(input, "aptitude");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/already exists/i)).toBeDefined();
    expect(renameArea).not.toHaveBeenCalled();
  });

  it("shows the FK refusal's words when removing fails server-side", async () => {
    const user = userEvent.setup();
    render(
      <SkillsAssessedPage
        view={view({
          removeArea: async () => {
            throw new Error(
              "Student scores exist under this skill. Clear them first, or keep the skill.",
            );
          },
        })}
      />,
    );
    await screen.findByText("Aptitude");

    await user.click(screen.getByRole("button", { name: /remove aptitude/i }));
    await user.click(screen.getByRole("button", { name: /yes, remove/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Aptitude")).toBeDefined();
  });

  it("shows the rename failure's words and keeps the editor open", async () => {
    const user = userEvent.setup();
    render(
      <SkillsAssessedPage
        view={view({
          renameArea: async () => {
            throw new Error("Could not rename the skill. Please try again.");
          },
        })}
      />,
    );
    await screen.findByText("AI skills");

    await user.click(screen.getByRole("button", { name: /rename ai skills/i }));
    const input = screen.getByLabelText(/new name for ai skills/i);
    await user.clear(input);
    await user.type(input, "AI fundamentals");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/could not rename/i)).toBeDefined();
    expect(screen.getByLabelText(/new name for ai skills/i)).toBeDefined();
  });
});
