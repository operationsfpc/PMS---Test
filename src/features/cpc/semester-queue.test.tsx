// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SemesterQueue } from "./semester-queue";
import type { PendingSemester, SemesterQueueRepository } from "./semester-queue-repository";

/**
 * The coordinator's semester (CGPA) queue — 2026-08-24 UAT: the missing
 * approval Karthik reported. A declared CGPA sits beside its marksheet; the
 * coordinator opens the document and verifies or rejects with a reason.
 */
const SEM3: PendingSemester = {
  id: "sem-1",
  studentName: "Thanush Krishna",
  rollNumber: "124",
  semesterNumber: 3,
  cgpa: 7.5,
  declaredMarks: 75,
  marksScale: "percentage",
  currentArrears: 0,
  historyOfArrears: 1,
  uploadedAt: "2026-08-24T07:00:00Z",
  url: "/signed/sem-3.pdf",
};

const SEM2: PendingSemester = {
  id: "sem-2",
  studentName: "Priya Ramesh",
  rollNumber: "21CSE1042",
  semesterNumber: 2,
  cgpa: 8.1,
  declaredMarks: null,
  marksScale: null,
  currentArrears: 0,
  historyOfArrears: 0,
  uploadedAt: "2026-08-24T08:00:00Z",
  url: null,
};

function repo(overrides: Partial<SemesterQueueRepository> = {}): SemesterQueueRepository {
  return {
    pending: async () => [SEM3, SEM2],
    decide: async () => undefined,
    ...overrides,
  };
}

const rowFor = async (name: string) => {
  const cell = await screen.findByText(name);
  const row = cell.closest("li");
  if (row === null) throw new Error(`row for ${name} not found`);
  return within(row);
};

describe("SemesterQueue", () => {
  it("puts the declared figure beside its marksheet link", async () => {
    render(<SemesterQueue repository={repo()} />);

    const row = await rowFor("Thanush Krishna");
    expect(row.getByText(/Semester 3 — CGPA 7\.5/)).toBeDefined();
    expect(row.getByText(/declared as 75%/i)).toBeDefined();
    expect(row.getByRole("link", { name: /open marksheet/i }).getAttribute("href")).toBe(
      "/signed/sem-3.pdf",
    );
  });

  it("says plainly when the marksheet could not be opened — never a dead link", async () => {
    render(<SemesterQueue repository={repo()} />);

    const row = await rowFor("Priya Ramesh");
    expect(row.queryByRole("link")).toBeNull();
    expect(row.getByText(/no marksheet available/i)).toBeDefined();
  });

  it("verifies a semester and reloads the queue", async () => {
    const decide = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SemesterQueue repository={repo({ decide })} />);

    const row = await rowFor("Thanush Krishna");
    await user.click(row.getByRole("button", { name: /verify/i }));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("sem-1", "pending", { decision: "verify" }),
    );
  });

  it("rejects with the typed reason", async () => {
    const decide = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<SemesterQueue repository={repo({ decide })} />);

    const row = await rowFor("Thanush Krishna");
    await user.type(row.getByLabelText(/reason/i), "Marksheet says 6.9");
    await user.click(row.getByRole("button", { name: /reject/i }));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("sem-1", "pending", {
        decision: "reject",
        reason: "Marksheet says 6.9",
      }),
    );
  });

  it("surfaces the repository's refusal (an empty rejection reason)", async () => {
    const user = userEvent.setup();
    render(
      <SemesterQueue
        repository={repo({
          decide: async () => {
            throw new Error("A rejection needs a reason, so the student knows what to correct.");
          },
        })}
      />,
    );

    const row = await rowFor("Thanush Krishna");
    await user.click(row.getByRole("button", { name: /reject/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("says the queue is empty when it is, not when it failed", async () => {
    render(<SemesterQueue repository={repo({ pending: async () => [] })} />);
    expect(await screen.findByText(/no declared semesters are waiting/i)).toBeDefined();
  });

  it("shows a failed load as a failure, never as an empty queue", async () => {
    render(
      <SemesterQueue
        repository={repo({
          pending: async () => {
            throw new Error("network");
          },
        })}
      />,
    );
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText(/no declared semesters/i)).toBeNull();
  });
});
