// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApplyError } from "./apply-repository";
import { DrivesList, type DrivesView } from "./drives-list";

/**
 * The student's view of open drives.
 *
 * R5 decides what appears at all; R6 decides whether Apply is offered. A drive
 * hidden by the ladder or the internship cap must not be listed - a student
 * seeing a drive they can never apply to is worse than not seeing it.
 *
 * There is no withdrawal (PRD §7.4), so applying is stated as final.
 */
const open = {
  id: "d1",
  companyName: "Zoho",
  roleTitle: "Member Technical Staff",
  ctcLabel: "₹6.5–9 LPA",
  offerCategory: "dream" as const,
  applicationEnd: "2026-09-10T00:00:00Z",
  canApply: true,
  refusal: null,
  applied: false,
  details: {
    jobDescription: "Build and maintain backend services.",
    designations: ["Associate Engineer"],
    locations: "Chennai, Tenkasi",
    openings: 25,
    ctcBreakup: "6.5 fixed + 2.5 variable",
    bondDetails: "No bond",
    shiftType: "General",
    mandatorySkills: "TypeScript, SQL",
    driveMode: "on_campus",
    applicationStart: "2026-09-01T00:00:00Z",
    rounds: [
      { sequence: 1, name: "Aptitude test" },
      { sequence: 2, name: "Technical interview" },
    ],
  },
};

function view(overrides: Partial<DrivesView> = {}): DrivesView {
  return {
    openDrives: async () => [open],
    apply: async () => undefined,
    ...overrides,
  };
}

describe("DrivesList", () => {
  it("lists a drive the student may apply to", async () => {
    render(<DrivesList view={view()} />);
    expect(await screen.findByText("Zoho")).toBeDefined();
    expect(screen.getByRole("button", { name: /apply to Zoho/i })).toBeDefined();
  });

  it("says so when nothing is open, rather than showing an empty page", async () => {
    render(<DrivesList view={view({ openDrives: async () => [] })} />);
    expect(await screen.findByText(/no drives are open to you/i)).toBeDefined();
  });

  it("warns that applying cannot be undone", async () => {
    render(<DrivesList view={view()} />);
    expect(await screen.findByText(/cannot be withdrawn/i)).toBeDefined();
  });

  it("applies through the repository once the student has confirmed", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DrivesList view={view({ apply })} />);

    await user.click(await screen.findByRole("button", { name: /apply to Zoho/i }));
    await user.upload(
      screen.getByLabelText(/resume for this drive/i),
      new File(["cv"], "resume.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /yes, apply/i }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith("d1", expect.any(File)));
    expect(await screen.findByText(/applied/i)).toBeDefined();
  });

  it("explains a refusal in the student's words, not the rule's code", async () => {
    render(
      <DrivesList
        view={view({
          openDrives: async () => [
            {
              ...open,
              canApply: false,
              refusal: "Applications for this drive have closed.",
            },
          ],
        })}
      />,
    );

    expect(await screen.findByText(/applications for this drive have closed/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /apply to Zoho/i })).toBeNull();
  });

  it("shows an already-applied drive without offering to apply again", async () => {
    render(<DrivesList view={view({ openDrives: async () => [{ ...open, applied: true }] })} />);

    expect(await screen.findByText(/applied/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /apply to Zoho/i })).toBeNull();
  });

  it("surfaces a failure without pretending the application succeeded", async () => {
    const apply = vi.fn().mockRejectedValue(new ApplyError("You have already applied."));
    const user = userEvent.setup();
    render(<DrivesList view={view({ apply })} />);

    await user.click(await screen.findByRole("button", { name: /apply to Zoho/i }));
    await user.upload(
      screen.getByLabelText(/resume for this drive/i),
      new File(["cv"], "resume.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /yes, apply/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
  });
});

/**
 * F14 (UAT 2026-08-06), three requests about the same screen:
 *  - "Add a view more button to view further details on the drives displayed."
 *  - "Add a warning that you are sure you want to apply for this drive? Say if
 *    you apply, you are expected to attend all the rounds of this drive and
 *    accept if you get a final offer."
 *  - "Ask for a drive specific resume to be uploaded at the time of applying."
 */
describe("DrivesList \u2014 view more", () => {
  it("keeps the detail out of the way until it is asked for", async () => {
    render(<DrivesList view={view()} />);

    await screen.findByText("Zoho");
    expect(screen.queryByText(/build and maintain backend services/i)).toBeNull();
    expect(screen.getByRole("button", { name: /view more about Zoho/i })).toBeDefined();
  });

  it("shows the job description, locations and package detail on request", async () => {
    const user = userEvent.setup();
    render(<DrivesList view={view()} />);

    await user.click(await screen.findByRole("button", { name: /view more about Zoho/i }));

    expect(screen.getByText(/build and maintain backend services/i)).toBeDefined();
    expect(screen.getByText(/chennai, tenkasi/i)).toBeDefined();
    expect(screen.getByText(/6.5 fixed \+ 2.5 variable/i)).toBeDefined();
  });

  /** F7: one interview process may cover several job titles. */
  it("names the other designations this one process covers", async () => {
    const user = userEvent.setup();
    render(<DrivesList view={view()} />);

    await user.click(await screen.findByRole("button", { name: /view more about Zoho/i }));

    expect(screen.getByText(/associate engineer/i)).toBeDefined();
  });

  /** The student is about to promise to attend all of them, so they are listed. */
  it("lists the rounds the student is committing to", async () => {
    const user = userEvent.setup();
    render(<DrivesList view={view()} />);

    await user.click(await screen.findByRole("button", { name: /view more about Zoho/i }));

    expect(screen.getByText(/1\. Aptitude test/)).toBeDefined();
    expect(screen.getByText(/2\. Technical interview/)).toBeDefined();
  });

  it("hides the detail again", async () => {
    const user = userEvent.setup();
    render(<DrivesList view={view()} />);

    await user.click(await screen.findByRole("button", { name: /view more about Zoho/i }));
    await user.click(screen.getByRole("button", { name: /view less about Zoho/i }));

    expect(screen.queryByText(/build and maintain backend services/i)).toBeNull();
  });
});

describe("DrivesList \u2014 confirming an application", () => {
  const startApplying = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: /apply to Zoho/i }));
  };

  it("does not apply on the first press", async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    render(<DrivesList view={view({ apply })} />);

    await startApplying(user);

    expect(apply).not.toHaveBeenCalled();
  });

  it("says what applying commits the student to", async () => {
    const user = userEvent.setup();
    render(<DrivesList view={view()} />);

    await startApplying(user);

    expect(screen.getByText(/are you sure/i)).toBeDefined();
    expect(screen.getByText(/attend all the rounds/i)).toBeDefined();
    expect(screen.getByText(/accept.*final offer/i)).toBeDefined();
  });

  it("will not apply without a resume for this drive", async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    render(<DrivesList view={view({ apply })} />);

    await startApplying(user);
    await user.click(screen.getByRole("button", { name: /yes, apply/i }));

    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText(/upload the resume/i)).toBeDefined();
  });

  it("sends the resume the student chose for this drive", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DrivesList view={view({ apply })} />);

    await startApplying(user);
    await user.upload(
      screen.getByLabelText(/resume for this drive/i),
      new File(["cv"], "zoho-resume.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /yes, apply/i }));

    await waitFor(() => expect(apply).toHaveBeenCalled());
    const [, resume] = apply.mock.calls[0] as [string, File];
    expect(resume.name).toBe("zoho-resume.pdf");
  });

  it("lets the student back out without applying", async () => {
    const apply = vi.fn();
    const user = userEvent.setup();
    render(<DrivesList view={view({ apply })} />);

    await startApplying(user);
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(apply).not.toHaveBeenCalled();
    expect(screen.queryByText(/are you sure/i)).toBeNull();
  });
});
