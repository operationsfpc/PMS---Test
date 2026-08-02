// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProgrammesPage } from "./programmes-page";
import type { ProgrammesRepository } from "./programmes-repository";

/**
 * Degrees and their branches.
 *
 * Roster import refuses an unknown degree and an unknown non-blank branch
 * (A11), so this screen is what makes a roster importable at all. A branch
 * always belongs to a degree - there is no free-floating branch.
 */
const DEGREES = [
  {
    id: "d1",
    name: "B.E / B.Tech (CSE / IT / allied)",
    branches: [{ id: "b1", name: "CSE", isActive: true }],
  },
  { id: "d2", name: "MCA", branches: [] },
];

function repo(overrides: Partial<ProgrammesRepository> = {}): ProgrammesRepository {
  return {
    list: async () => DEGREES,
    addDegree: async () => undefined,
    addBranch: async () => undefined,
    setBranchActive: async () => undefined,
    ...overrides,
  };
}

describe("ProgrammesPage", () => {
  it("lists each degree with its branches", async () => {
    render(<ProgrammesPage repository={repo()} />);

    expect(await screen.findByRole("heading", { name: /B.E \/ B.Tech/ })).toBeDefined();
    expect(screen.getByText("CSE")).toBeDefined();
  });

  it("says which degrees have no branches yet", async () => {
    render(<ProgrammesPage repository={repo()} />);

    expect(await screen.findByText(/no branches yet/i)).toBeDefined();
  });

  it("adds a degree", async () => {
    const addDegree = vi.fn();
    const user = userEvent.setup();
    render(<ProgrammesPage repository={repo({ addDegree })} />);

    await user.type(await screen.findByLabelText(/new degree/i), "B.Sc IT");
    await user.click(screen.getByRole("button", { name: /add degree/i }));

    await waitFor(() => expect(addDegree).toHaveBeenCalledWith("B.Sc IT"));
  });

  it("adds a branch to the degree it belongs to", async () => {
    const addBranch = vi.fn();
    const user = userEvent.setup();
    render(<ProgrammesPage repository={repo({ addBranch })} />);

    await user.type(await screen.findByLabelText(/new branch for MCA/i), "Data Science");
    await user.click(screen.getByRole("button", { name: /add branch to MCA/i }));

    await waitFor(() => expect(addBranch).toHaveBeenCalledWith("d2", "Data Science"));
  });

  it("will not add a blank degree", async () => {
    const addDegree = vi.fn();
    const user = userEvent.setup();
    render(<ProgrammesPage repository={repo({ addDegree })} />);

    await user.click(await screen.findByRole("button", { name: /add degree/i }));

    expect(addDegree).not.toHaveBeenCalled();
  });

  it("retires a branch by deactivating it, never deleting", async () => {
    const setBranchActive = vi.fn();
    const user = userEvent.setup();
    render(<ProgrammesPage repository={repo({ setBranchActive })} />);

    await user.click(await screen.findByRole("button", { name: /deactivate CSE/i }));

    await waitFor(() => expect(setBranchActive).toHaveBeenCalledWith("b1", false));
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("surfaces a failure instead of pretending it worked", async () => {
    const user = userEvent.setup();
    render(
      <ProgrammesPage
        repository={repo({
          addDegree: async () => {
            throw new Error("That degree already exists.");
          },
        })}
      />,
    );

    await user.type(await screen.findByLabelText(/new degree/i), "MCA");
    await user.click(screen.getByRole("button", { name: /add degree/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/already exists/i);
  });
});
