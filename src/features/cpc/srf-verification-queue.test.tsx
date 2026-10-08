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
  currentArrears: 1,
  historyOfArrears: 2,
  tenthPercentage: 91.4,
  twelfthPercentage: 88,
  // The board is verified against the same document as the marks (2026-08-18).
  tenthBoard: { board: "state_board" as const, state: "Tamil Nadu", other: null },
  twelfthBoard: { board: "cbse" as const, state: null, other: null },
  tenthGrade: null,
  twelfthGrade: null,
  submittedAt: "2026-08-01T10:00:00Z",
  /** Non-null only on a form this coordinator has already sent back once. */
  previousRejectionReason: null,
  documents: [
    { kind: "tenth_marksheet", label: "10th marksheet", url: "https://signed/10" },
    { kind: "twelfth_marksheet", label: "12th marksheet", url: "https://signed/12" },
  ],
  certificates: [
    {
      id: "c1",
      name: "AWS Cloud Practitioner",
      fileName: null,
      url: "https://signed/aws",
      status: "pending" as const,
    },
    { id: "c2", name: "NPTEL Data Structures", fileName: null, url: null, status: "pending" as const },
  ],
  resumes: [
    {
      roleCategory: "software_technical" as const,
      label: "Software / Technical",
      fileName: "software-cv.pdf",
      url: "https://signed/sw-resume",
    },
    {
      roleCategory: "sales" as const,
      label: "Sales",
      fileName: null,
      url: "https://signed/sales-resume",
    },
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

  it("links each uploaded category resume so the coordinator can review it", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    const swResume = await screen.findByRole("link", {
      name: /open software \/ technical resume for asha ramanathan/i,
    });
    expect(swResume.getAttribute("href")).toBe("https://signed/sw-resume");
    expect(screen.getByText("(software-cv.pdf)")).toBeDefined();

    const salesResume = screen.getByRole("link", {
      name: /open sales resume for asha ramanathan/i,
    });
    expect(salesResume.getAttribute("href")).toBe("https://signed/sales-resume");
  });

  it("flags a student with no uploaded resumes", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({ pending: async () => [{ ...row, resumes: [] }] })}
      />,
    );

    expect(await screen.findByText(/no resume uploaded/i)).toBeDefined();
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

/**
 * Approving the form also confirms the certificates that came with it
 * (0039, asked for 2026-08-06). That click may only mean anything if the
 * coordinator was shown the documents first - the same reason semester
 * marksheets are on this screen. A verify button with nothing to open is a
 * signature on the student's own typing.
 */
describe("SrfVerificationQueue — certificates", () => {
  it("lists each certificate with a link to the document it claims", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    expect(await screen.findByText("AWS Cloud Practitioner")).toBeDefined();
    const link = screen.getByRole<HTMLAnchorElement>("link", {
      name: /open aws cloud practitioner/i,
    });
    expect(link.href).toContain("https://signed/aws");
  });

  /** A coordinator must never believe they checked something they could not open. */
  it("says when a certificate has no document, rather than offering a dead link", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    await screen.findByText("NPTEL Data Structures");
    expect(screen.queryByRole("link", { name: /open nptel data structures/i })).toBeNull();
    expect(screen.getByText(/no document/i)).toBeDefined();
  });

  /** The coordinator is told what approving will commit them to. */
  it("says that approving will verify the certificates too", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    expect(await screen.findByText(/approving.*also verif\w*.*2 certificates/i)).toBeDefined();
  });

  it("counts one certificate in the singular", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({
          pending: async () => [
            {
              ...row,
              certificates: [
                {
                  id: "c1",
                  name: "AWS Cloud Practitioner",
                  fileName: null,
                  url: null,
                  status: "pending" as const,
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(await screen.findByText(/also verify 1 certificate\b/i)).toBeDefined();
  });

  it("says so plainly when there are none to check", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({ pending: async () => [{ ...row, certificates: [] }] })}
      />,
    );

    expect(await screen.findByText(/no certificates uploaded/i)).toBeDefined();
  });

  /** One already decided is shown as decided, not offered again. */
  it("shows a certificate that was already verified as verified", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({
          pending: async () => [
            {
              ...row,
              certificates: [
                {
                  id: "c1",
                  name: "AWS Cloud Practitioner",
                  fileName: null,
                  url: null,
                  status: "verified" as const,
                },
              ],
            },
          ],
        })}
      />,
    );

    await screen.findByText("AWS Cloud Practitioner");
    expect(screen.getByText(/^verified$/i)).toBeDefined();
  });
});

/**
 * Sending a form back with comments (2026-08-18).
 *
 * Everything behind this already existed - `decideSrf` refuses an empty reason,
 * the repository writes it, 0020 lets the student resubmit - and yet NO
 * coordinator could reject a form, because this screen only ever offered
 * Approve. A rule with no control on any screen is a rule nobody can follow.
 */
describe("sending a form back for changes", () => {
  it("asks for a comment before it will send anything back", async () => {
    const decide = vi.fn();
    const user = userEvent.setup();
    render(<SrfVerificationQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /send back .*asha/i }));
    await user.click(screen.getByRole("button", { name: /^send back$/i }));

    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/needs a reason/i);
  });

  it("refuses a comment of nothing but spaces", async () => {
    const decide = vi.fn();
    const user = userEvent.setup();
    render(<SrfVerificationQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /send back .*asha/i }));
    await user.type(screen.getByLabelText(/what does this student need to correct/i), "   ");
    await user.click(screen.getByRole("button", { name: /^send back$/i }));

    expect(decide).not.toHaveBeenCalled();
  });

  it("sends the comment to the repository and clears the row", async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SrfVerificationQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /send back .*asha/i }));
    await user.type(
      screen.getByLabelText(/what does this student need to correct/i),
      "Semester 2 marksheet is missing.",
    );
    await user.click(screen.getByRole("button", { name: /^send back$/i }));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("s1", "srf_submitted", {
        decision: "reject",
        reason: "Semester 2 marksheet is missing.",
      }),
    );
    await waitFor(() => expect(screen.queryByText("Asha Ramanathan")).toBeNull());
  });

  it("keeps the student on screen when the write fails, with their reason intact", async () => {
    const user = userEvent.setup();
    render(
      <SrfVerificationQueue
        repository={repo({
          decide: async () => {
            throw new VerificationError("Could not save the decision. Please try again.");
          },
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /send back .*asha/i }));
    await user.type(screen.getByLabelText(/what does this student need to correct/i), "Fix it");
    await user.click(screen.getByRole("button", { name: /^send back$/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Asha Ramanathan")).toBeDefined();
  });

  it("lets the coordinator change their mind without sending anything", async () => {
    const decide = vi.fn();
    const user = userEvent.setup();
    render(<SrfVerificationQueue repository={repo({ decide })} />);

    await user.click(await screen.findByRole("button", { name: /send back .*asha/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByLabelText(/what does this student need to correct/i)).toBeNull();
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /approve asha/i })).toBeDefined();
  });
});

describe("what the coordinator is shown before deciding", () => {
  it("names the board behind each school figure, and the state that identifies it", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    expect(await screen.findByText("State Board — Tamil Nadu")).toBeDefined();
    expect(screen.getByText("CBSE")).toBeDefined();
  });

  it("says so plainly when no board was ever recorded", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({
          pending: async () => [{ ...row, tenthBoard: null, twelfthBoard: null }],
        })}
      />,
    );

    expect((await screen.findAllByText(/not recorded/i)).length).toBeGreaterThan(0);
  });

  /**
   * A resubmission is not a fresh form. Showing what was asked for last time is
   * what stops the same defect being missed twice.
   */
  it("marks a resubmitted form and repeats what was asked for", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({
          pending: async () => [
            { ...row, previousRejectionReason: "Semester 2 marksheet is missing." },
          ],
        })}
      />,
    );

    expect(await screen.findByText(/resubmitted/i)).toBeDefined();
    expect(screen.getByText(/semester 2 marksheet is missing/i)).toBeDefined();
  });

  it("says nothing of the sort about a form submitted for the first time", async () => {
    render(<SrfVerificationQueue repository={repo()} />);

    await screen.findByText("Asha Ramanathan");
    expect(screen.queryByText(/resubmitted/i)).toBeNull();
  });

  it("displays Cambridge / IGCSE grades for coordinator verification", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({
          pending: async () => [
            {
              ...row,
              tenthPercentage: null,
              tenthGrade: "A*",
              tenthBoard: { board: "cambridge" as const, state: null, other: null },
              twelfthPercentage: 89,
              twelfthGrade: "A",
              twelfthBoard: { board: "cambridge" as const, state: null, other: null },
            },
          ],
        })}
      />,
    );

    expect(await screen.findByText("Grade: A*")).toBeDefined();
    expect(screen.getByText("89% (Grade: A)")).toBeDefined();
  });

  it("displays standing arrears from declared semesters", async () => {
    render(
      <SrfVerificationQueue
        repository={repo({
          pending: async () => [
            {
              ...row,
              currentArrears: 3,
              historyOfArrears: 5,
            },
          ],
        })}
      />,
    );

    expect(await screen.findByText("3")).toBeDefined();
  });
});
