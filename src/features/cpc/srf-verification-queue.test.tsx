// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SrfVerificationQueue } from "./srf-verification-queue";
import { VerificationError, type VerificationRepository } from "./verification-repository";

/**
 * The CPC queue against a real repository.
 *
 * Approval is what unlocks every drive a student can ever see, so the tests
 * pin that a decision actually reaches the repository, and that a refusal is
 * shown rather than swallowed.
 */
const row = {
  id: "s1",
  fullName: "Asha Ramanathan",
  rollNumber: "TEC001",
  overallCgpa: 8.2,
  currentArrears: 0,
  historyOfArrears: 1,
  tenthPercentage: 91.4,
  twelfthPercentage: 88,
  submittedAt: "2026-08-01T10:00:00Z",
  documents: [
    { kind: "tenth_marksheet", label: "10th marksheet", url: "https://signed/10" },
    { kind: "twelfth_marksheet", label: "12th marksheet", url: "https://signed/12" },
  ],
  semesters: [
    {
      semesterNumber: 1,
      cgpa: 8.1,
      currentArrears: 0,
      historyOfArrears: 0,
      status: "pending",
      marksheetUrl: "https://signed/sem1",
    },
    {
      semesterNumber: 2,
      cgpa: 8.4,
      currentArrears: 1,
      historyOfArrears: 2,
      status: "pending",
      marksheetUrl: "https://signed/sem2",
    },
  ],
};

function repo(overrides: Partial<VerificationRepository> = {}): VerificationRepository {
  return {
    pending: async () => [row],
    decide: async () => undefined,
    ...overrides,
  };
}

describe("SrfVerificationQueue", () => {
  it("lists the forms awaiting verification", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    expect(await screen.findByText("Asha Ramanathan")).toBeDefined();
    expect(screen.getByText("TEC001")).toBeDefined();
  });

  it("says so plainly when nothing is waiting", async () => {
    render(<SrfVerificationQueue repository={repo({ pending: async () => [] })} />);

    expect(await screen.findByText(/nothing awaiting verification/i)).toBeDefined();
  });

  it("approves a student through the repository and clears them from the queue", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SrfVerificationQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /approve Asha Ramanathan/i }));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0]?.[0]).toBe("s1");
    expect(decide.mock.calls[0]?.[2]).toEqual({ decision: "approve" });
    await waitFor(() => expect(screen.queryByText("Asha Ramanathan")).toBeNull());
  });

  it("shows the refusal when a decision is rejected by the rules", async () => {
    const decide = vi.fn().mockRejectedValue(new VerificationError("A rejection needs a reason."));
    const user = userEvent.setup();
    render(<SrfVerificationQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /approve Asha Ramanathan/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toMatch(/needs a reason/i);
    // The student stays in the queue - nothing was decided.
    expect(screen.getByText("Asha Ramanathan")).toBeDefined();
  });

  it("links the marksheets that justify the figures (PRD 4.2)", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    expect(await screen.findByRole("link", { name: /10th marksheet/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /12th marksheet/i })).toBeDefined();
  });

  it("flags a student who uploaded nothing, rather than showing a blank cell", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({ pending: async () => [{ ...row, documents: [] }] })}
      />,
    );

    expect(await screen.findByText(/none uploaded/i)).toBeDefined();
  });

  it("reports a failure to load rather than showing an empty queue", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({
          pending: async () => {
            throw new VerificationError("Could not load the verification queue.");
          },
        })}
      />,
    );

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText(/nothing awaiting verification/i)).toBeNull();
  });
});

/**
 * The reason this screen exists.
 *
 * The SRF marked the marksheet uploads required, let the student pick their
 * files, and discarded every one — so a coordinator was shown a declared CGPA
 * with nothing to check it against, and "Approve" meant endorsing the
 * student's own typing. A verified semester is what R5 reads to decide whether
 * that student may apply to a drive, so the hole was load-bearing.
 */
describe("checking a declared CGPA against the marksheet that proves it", () => {
  it("shows each declared semester with its own CGPA", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    expect(await screen.findByText(/semester 1/i)).toBeDefined();
    expect(screen.getByText("8.1")).toBeDefined();
    expect(screen.getByText("8.4")).toBeDefined();
  });

  it("links each semester's CGPA to the marksheet that evidences it", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    const link = await screen.findByRole("link", { name: /semester 1 marksheet for Asha/i });
    expect(link.getAttribute("href")).toBe("https://signed/sem1");
    expect(
      screen.getByRole("link", { name: /semester 2 marksheet for Asha/i }).getAttribute("href"),
    ).toBe("https://signed/sem2");
  });

  /**
   * Never a dead link, and never a bare number: a coordinator who cannot see
   * the document must be told so, not left to assume they checked it.
   */
  it("says plainly when a semester has no marksheet behind it", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({
          pending: async () => [
            {
              ...row,
              semesters: row.semesters.slice(0, 1).map((s) => ({ ...s, marksheetUrl: null })),
            },
          ],
        })}
      />,
    );

    expect(await screen.findByText(/no marksheet/i)).toBeDefined();
    expect(screen.queryByRole("link", { name: /semester 1 marksheet/i })).toBeNull();
  });

  it("shows the arrears declared per semester, which drives filter on", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    // Semester 2: 1 standing, 2 in history.
    expect(await screen.findByText(/1 standing, 2 in history/i)).toBeDefined();
  });

  it("says so when a student declared no semesters at all", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({ pending: async () => [{ ...row, semesters: [] }] })}
      />,
    );

    expect(await screen.findByText(/no semesters declared/i)).toBeDefined();
  });
});
