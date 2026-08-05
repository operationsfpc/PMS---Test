// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ProfileEditPage } from "./profile-edit";
import type { StudentProfileRepository } from "./profile-repository";

/**
 * What a verified student may still change themselves.
 *
 * Asked for 2026-08-05: after approval a student "should be able to see the
 * details he has entered. from there, there should be a place to go and edit
 * it, by clicking a link."
 *
 * R10 decides what that link may reach. Marks, arrears and the semester record
 * have been checked against documents and belong to the coordinator now -
 * §7.2 judges eligibility on them, so a student editing them would invalidate
 * every shortlist their record has already been measured for. Skills, projects
 * and links go stale, are nobody else's to maintain, and decide nothing.
 */
const CURRENT = {
  technicalSkills: "TypeScript, React",
  areasOfInterest: "Frontend",
  areasOfExpertise: "Web",
  projects: "MERN stack app",
  certifications: "",
  achievements: "Built a web application from scratch",
  linkedin: "https://linkedin.com/in/asha",
  github: "",
  leetcode: "",
  hackerrank: "",
};

function repo(overrides: Partial<StudentProfileRepository> = {}): StudentProfileRepository {
  return {
    load: async () => CURRENT,
    save: async () => undefined,
    ...overrides,
  };
}

const renderPage = (repository: StudentProfileRepository) =>
  render(
    <MemoryRouter>
      <ProfileEditPage repository={repository} />
    </MemoryRouter>,
  );

describe("ProfileEditPage", () => {
  it("opens with what the student already has", async () => {
    renderPage(repo());

    const skills = await screen.findByLabelText(/technical skills/i);
    expect((skills as HTMLInputElement).value).toBe("TypeScript, React");
  });

  it("saves a change", async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    renderPage(repo({ save }));

    const projects = await screen.findByLabelText(/projects/i);
    await user.clear(projects);
    await user.type(projects, "A placement management system");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ projects: "A placement management system" }),
      ),
    );
  });

  it("confirms the save, so the student knows it took", async () => {
    const user = userEvent.setup();
    renderPage(repo());

    await user.click(await screen.findByRole("button", { name: /save/i }));

    expect(await screen.findByText(/saved/i)).toBeDefined();
  });

  it("says so when it could not save, rather than pretending", async () => {
    const user = userEvent.setup();
    renderPage(
      repo({
        save: async () => {
          throw new Error("Could not save your profile. Please try again.");
        },
      }),
    );

    await user.click(await screen.findByRole("button", { name: /save/i }));

    expect(await screen.findByText(/could not save/i)).toBeDefined();
  });

  /**
   * The whole point of the boundary. If these ever appear here, a student can
   * change a verified figure and every shortlist judged against it is wrong.
   */
  it("offers nothing that a coordinator has verified", async () => {
    renderPage(repo());
    await screen.findByLabelText(/technical skills/i);

    for (const forbidden of [/10th/i, /12th/i, /semester/i, /arrear/i, /cgpa/i, /roll number/i]) {
      expect(screen.queryByLabelText(forbidden)).toBeNull();
    }
  });

  it("offers a way back to the verified record it came from", async () => {
    renderPage(repo());

    expect(await screen.findByRole("link", { name: /registration form|back/i })).toBeDefined();
  });
});
