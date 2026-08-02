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

  it("applies through the repository", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DrivesList view={view({ apply })} />);

    await user.click(await screen.findByRole("button", { name: /apply to Zoho/i }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith("d1"));
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

    expect(await screen.findByRole("alert")).toBeDefined();
  });
});
