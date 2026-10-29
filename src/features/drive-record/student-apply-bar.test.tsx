// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OpenDrive } from "../student/drives-list";
import { StudentApplyBar, type StudentApplyView } from "./student-apply-bar";

/**
 * 2026-10-29 UAT: the drive's canonical page — the one every card's "View"
 * leads to — had no Apply on it. The bar re-asks the same R5/R6 questions as
 * the card, so a refusal here says what the list would have said.
 */
const ZOHO: OpenDrive = {
  id: "d1",
  companyName: "Zoho",
  roleTitle: "Member Technical Staff",
  roleCategory: "software_technical",
  ctcLabel: "₹6.5–9 LPA",
  offerCategory: "dream",
  applicationEnd: "2026-09-10T00:00:00Z",
  canApply: true,
  refusal: null,
  applied: false,
  profileResumeName: null,
  companyDriveId: null,
  tentativeDate: null,
  details: {
    jobDescription: "Build and maintain backend services.",
    designations: [],
    locations: "Chennai",
    openings: 25,
    ctcBreakup: "",
    bondDetails: "",
    shift: "Day shift",
    joining: "Immediate joining",
    jobDescriptionUrl: null,
    jobDescriptionName: null,
    mandatorySkills: "TypeScript",
    driveMode: "on_campus",
    venue: "",
    applicationStart: "2026-09-01T00:00:00Z",
    rounds: [],
  },
};

function view(overrides: Partial<StudentApplyView> = {}): StudentApplyView {
  return {
    openDrive: async () => ZOHO,
    apply: async () => undefined,
    ...overrides,
  };
}

describe("StudentApplyBar", () => {
  it("offers Apply on the drive's own page, naming the drive", async () => {
    render(<StudentApplyBar driveId="d1" view={view()} />);

    expect(
      await screen.findByRole("button", { name: "Apply to Zoho — Member Technical Staff" }),
    ).toBeDefined();
  });

  it("asks for confirmation, because an application cannot be withdrawn", async () => {
    const user = userEvent.setup();
    render(<StudentApplyBar driveId="d1" view={view()} />);

    await user.click(await screen.findByRole("button", { name: /apply to Zoho/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/are you sure/i);
    expect(dialog.textContent).toMatch(/cannot be withdrawn/i);
  });

  it("sends the drive and the chosen resume, then says it was submitted", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<StudentApplyBar driveId="d1" view={view({ apply })} />);

    await user.click(await screen.findByRole("button", { name: /apply to Zoho/i }));
    await user.upload(
      screen.getByLabelText(/resume for this drive/i),
      new File(["cv"], "resume.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /yes, apply/i }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith("d1", expect.any(File)));
    expect(await screen.findByText("Application submitted")).toBeDefined();
    expect(screen.queryByRole("button", { name: /apply to Zoho/i })).toBeNull();
  });

  it("refuses to send an application with no resume anywhere on file", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<StudentApplyBar driveId="d1" view={view({ apply })} />);

    await user.click(await screen.findByRole("button", { name: /apply to Zoho/i }));
    await user.click(screen.getByRole("button", { name: /yes, apply/i }));

    expect(screen.getByText(/upload the resume/i)).toBeDefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it("sends the saved resume when the student chooses no new file", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <StudentApplyBar
        driveId="d1"
        view={view({ apply, openDrive: async () => ({ ...ZOHO, profileResumeName: "zoho.pdf" }) })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /apply to Zoho/i }));
    expect(screen.getByText(/zoho\.pdf/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: /yes, apply/i }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith("d1", null));
  });

  it("shows the refusal in place of a button when the drive is not open to them", async () => {
    render(
      <StudentApplyBar
        driveId="d1"
        view={view({
          openDrive: async () => ({
            ...ZOHO,
            canApply: false,
            refusal: "Applications closed on 10 Sep 2026.",
          }),
        })}
      />,
    );

    expect(await screen.findByText("Applications closed on 10 Sep 2026.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /apply to Zoho/i })).toBeNull();
  });

  it("stays out of the way when the student cannot see the drive at all", async () => {
    const { container } = render(
      <StudentApplyBar driveId="d1" view={view({ openDrive: async () => null })} />,
    );

    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("offers a retry when the verdict itself could not be read", async () => {
    const openDrive = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(ZOHO);
    const user = userEvent.setup();
    render(<StudentApplyBar driveId="d1" view={view({ openDrive })} />);

    expect(await screen.findByRole("alert")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("button", { name: /apply to Zoho/i })).toBeDefined();
  });
});
