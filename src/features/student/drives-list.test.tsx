// @vitest-environment jsdom
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApplyError } from "./apply-repository";
import { DrivesList, type DrivesView } from "./drives-list";

/** The card carries a Link to /drives/:id (N1), so a router must be present. */
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

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
  roleCategory: "software_technical" as const,
  ctcLabel: "₹6.5–9 LPA",
  offerCategory: "dream" as const,
  applicationEnd: "2026-09-10T00:00:00Z",
  canApply: true,
  refusal: null,
  applied: false,
  profileResumeName: null as string | null,
  details: {
    jobDescription: "Build and maintain backend services.",
    designations: ["Associate Engineer"],
    locations: "Chennai, Tenkasi",
    openings: 25,
    ctcBreakup: "6.5 fixed + 2.5 variable",
    bondDetails: "No bond",
    shift: "Day shift",
    joining: "Immediate joining",
    jobDescriptionUrl: null as string | null,
    jobDescriptionName: null as string | null,
    mandatorySkills: "TypeScript, SQL",
    driveMode: "on_campus",
    venue: "",
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
 * ⚠️ DELIBERATELY REVERSED 2026-08-24 (Karthik): "we do not need view
 * everything and view more about a drive. view everything is sufficient."
 * F14's inline expander is gone — the canonical /drives/:id record page
 * carries every detail it showed (JD link, venue, rounds, shift, joining).
 * The apply warning and the drive-specific resume (F14's other two asks)
 * stay untouched below.
 */
describe("DrivesList — the card points at the one canonical page", () => {
  it("offers no View more — the record-page link is the way in", async () => {
    render(<DrivesList view={view()} />);

    await screen.findByText("Zoho");
    expect(screen.queryByRole("button", { name: /view more/i })).toBeNull();
    expect(screen.getByRole("link", { name: /view everything about Zoho/i })).toBeDefined();
    // The detail panel's content is gone with it.
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

/**
 * D2 (UAT 2026-08-19): "a student's preferred resume … should auto-populate
 * when they apply." The saved per-area resume is the default; the upload is
 * the override. A student with neither is still refused.
 */
describe("DrivesList — the saved resume auto-fetches (D2)", () => {
  const withSaved = { ...open, profileResumeName: "software-technical-resume.pdf" };

  const startApplying = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: /apply to Zoho/i }));
  };

  it("names the resume that will be sent, before the student confirms", async () => {
    const user = userEvent.setup();
    render(<DrivesList view={view({ openDrives: async () => [withSaved] })} />);

    await startApplying(user);

    expect(screen.getByText(/software-technical-resume\.pdf/)).toBeDefined();
    expect(screen.getByText(/will be sent/i)).toBeDefined();
  });

  it("applies WITHOUT an upload — the saved resume is a real resume", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DrivesList view={view({ openDrives: async () => [withSaved], apply })} />);

    await startApplying(user);
    await user.click(screen.getByRole("button", { name: /yes, apply/i }));

    await waitFor(() => expect(apply).toHaveBeenCalledWith("d1", null));
  });

  it("an upload still wins over the saved resume", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DrivesList view={view({ openDrives: async () => [withSaved], apply })} />);

    await startApplying(user);
    await user.upload(
      screen.getByLabelText(/replace|resume for this drive/i),
      new File(["cv"], "tailored.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /yes, apply/i }));

    await waitFor(() => expect(apply).toHaveBeenCalled());
    const [, resume] = apply.mock.calls[0] as [string, File];
    expect(resume.name).toBe("tailored.pdf");
  });
});
