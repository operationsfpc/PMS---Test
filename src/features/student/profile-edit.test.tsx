// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ProfileEditPage } from "./profile-edit";
import type { StudentCertificatesRepository, StudentProfileRepository } from "./profile-repository";

/**
 * What a verified student may still change themselves.
 *
 * Asked for 2026-08-05: after approval a student "should be able to see the
 * details he has entered. from there, there should be a place to go and edit
 * it, by clicking a link."
 *
 * Asked for again 2026-08-06, against the screen that answered it: "skills and
 * achievements editing page, want it to have similar look and feel to the
 * original student registration form. already submitted details should be
 * fetched and shown and they should be able to edit it." And: "i am not able
 * to add certifications. need provision for students to add details of
 * certificates they have and must be able to upload them."
 *
 * R10 decides what that link may reach. Marks, arrears and the semester record
 * have been checked against documents and belong to the coordinator now -
 * §7.2 judges eligibility on them, so a student editing them would invalidate
 * every shortlist their record has already been measured for. Skills, projects
 * and links go stale, are nobody else's to maintain, and decide nothing.
 */
const CURRENT = {
  driveTypePreferences: ["placement" as const],
  technicalSkills: "TypeScript, React",
  areasOfInterest: "Frontend",
  areasOfExpertise: "Web",
  projects: "MERN stack app",
  achievements: "Built a web application from scratch",
  linkedin: "https://linkedin.com/in/asha",
  github: "",
  leetcode: "",
  hackerrank: "",
  otherProfiles: [{ label: "Kaggle", value: "asha_r" }],
};

const ON_FILE = [
  {
    id: "cert-1",
    name: "AWS Cloud Practitioner",
    url: "https://signed/aws.pdf",
    status: "pending" as const,
    rejectionReason: null,
  },
  {
    id: "cert-2",
    name: "NPTEL Data Structures",
    url: null,
    status: "pending" as const,
    rejectionReason: null,
  },
];

function repo(overrides: Partial<StudentProfileRepository> = {}): StudentProfileRepository {
  return {
    load: async () => CURRENT,
    save: async () => undefined,
    ...overrides,
  };
}

function certs(
  overrides: Partial<StudentCertificatesRepository> = {},
): StudentCertificatesRepository {
  return {
    list: async () => ON_FILE,
    add: async () => undefined,
    remove: async () => undefined,
    ...overrides,
  };
}

const renderPage = (
  repository: StudentProfileRepository,
  certificates: StudentCertificatesRepository = certs(),
) =>
  render(
    <MemoryRouter>
      <ProfileEditPage repository={repository} certificates={certificates} />
    </MemoryRouter>,
  );

const pdf = () => new File(["scan"], "aws.pdf", { type: "application/pdf" });

/**
 * D1/D3 (UAT 2026-08-19): the student chooses which DRIVE TYPES they want.
 * No approval needed — the change applies to new drives from that point on;
 * past applications carry their apply-time snapshot.
 */
describe("ProfileEditPage — drive type preferences", () => {
  it("shows the three types with the student's current choices ticked", async () => {
    renderPage(repo());

    const placement = await screen.findByRole("checkbox", { name: /^placement$/i });
    expect((placement as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: /^internship$/i }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole("checkbox", { name: /convertible/i }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("saves a changed preference", async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    renderPage(repo({ save }));

    await user.click(await screen.findByRole("checkbox", { name: /^internship$/i }));
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].driveTypePreferences).toEqual(["placement", "internship"]);
  });

  it("says the change applies forward only", async () => {
    renderPage(repo());
    await screen.findByRole("checkbox", { name: /^placement$/i });
    expect(screen.getByText(/new drives from this point/i)).toBeDefined();
  });
});

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

/**
 * "similar look and feel to the original student registration form"
 * (2026-08-06). The form is a set of numbered sections; this was one flat card
 * of ten identical boxes, so a student arriving from the form could not tell
 * it was the same product, let alone which parts of their record it covered.
 */
describe("ProfileEditPage — the registration form's shape", () => {
  it("groups the fields under the same headings the form uses", async () => {
    renderPage(repo());

    // Level 2: the page's own <h1> names all three, which is the point of it.
    for (const heading of [
      /^skills and achievements$/i,
      /^certificates$/i,
      /^professional profiles$/i,
    ]) {
      expect(await screen.findByRole("heading", { level: 2, name: heading })).toBeDefined();
    }
  });

  /**
   * `students.certifications` was free text: a claim nobody could check and
   * nothing could de-duplicate, which is what F9 reported. It is superseded by
   * `student_certificates` and no longer written by anything - offering the
   * box here would quietly write to a column the SRF stopped writing in 0035.
   */
  it("no longer offers the free-text certifications box", async () => {
    renderPage(repo());
    await screen.findByLabelText(/technical skills/i);

    expect(screen.queryByLabelText(/^certifications$/i)).toBeNull();
  });
});

describe("ProfileEditPage — the profiles the student added themselves", () => {
  it("reads back the other profiles submitted on the form", async () => {
    renderPage(repo());

    const name = await screen.findByLabelText(/profile 1 name/i);
    expect((name as HTMLInputElement).value).toBe("Kaggle");
    expect((screen.getByLabelText(/profile 1 link or username/i) as HTMLInputElement).value).toBe(
      "asha_r",
    );
  });

  it("lets the student add one that was not there before", async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    renderPage(repo({ save }));

    await user.click(await screen.findByRole("button", { name: /add another profile/i }));
    await user.type(screen.getByLabelText(/profile 2 name/i), "Portfolio");
    await user.type(screen.getByLabelText(/profile 2 link or username/i), "asha.dev");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0].otherProfiles).toEqual([
      { label: "Kaggle", value: "asha_r" },
      { label: "Portfolio", value: "asha.dev" },
    ]);
  });

  /** The domain's rule, not the screen's: both halves or neither. */
  it("refuses a half-filled profile, naming the entry", async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    renderPage(repo({ save }));

    await user.click(await screen.findByRole("button", { name: /add another profile/i }));
    await user.type(screen.getByLabelText(/profile 2 name/i), "Portfolio");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByText(/portfolio/i)).toBeDefined();
  });
});

/**
 * "i am not able to add certifications. need provision for students to add
 * details of certificates they have and must be able to upload them."
 * (2026-08-06)
 *
 * A certificate is a NAME and a DOCUMENT (F17), uploaded ONCE (F9). This
 * screen was still offering the free-text box both of those replaced.
 */
describe("ProfileEditPage — certificates", () => {
  it("lists the certificates already on file", async () => {
    renderPage(repo());

    expect(await screen.findByText(/aws cloud practitioner/i)).toBeDefined();
    expect(screen.getByText(/nptel data structures/i)).toBeDefined();
  });

  it("links to the document, so a name is never taken on trust", async () => {
    renderPage(repo());

    const link = await screen.findByRole("link", { name: /view aws cloud practitioner/i });
    expect(link.getAttribute("href")).toBe("https://signed/aws.pdf");
  });

  it("uploads a new one and shows it on the list", async () => {
    const add = vi.fn();
    const list = vi
      .fn()
      .mockResolvedValueOnce(ON_FILE)
      .mockResolvedValue([
        ...ON_FILE,
        {
          id: "cert-3",
          name: "Azure Fundamentals",
          url: null,
          status: "pending" as const,
          rejectionReason: null,
        },
      ]);
    const user = userEvent.setup();
    renderPage(repo(), certs({ add, list }));

    await user.type(await screen.findByLabelText(/certificate name/i), "Azure Fundamentals");
    await user.upload(screen.getByLabelText(/upload certificate/i), pdf());
    await user.click(screen.getByRole("button", { name: /add certificate/i }));

    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add.mock.calls[0]?.[0]).toBe("Azure Fundamentals");
    expect(add.mock.calls[0]?.[1]).toBeInstanceOf(File);
    expect(await screen.findByText(/azure fundamentals/i)).toBeDefined();
  });

  /** F9, and it is the domain that says so. */
  it("refuses a second copy of a certificate already on file", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    renderPage(repo(), certs({ add }));

    await user.type(await screen.findByLabelText(/certificate name/i), "aws cloud practitioner");
    await user.upload(screen.getByLabelText(/upload certificate/i), pdf());
    await user.click(screen.getByRole("button", { name: /add certificate/i }));

    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByText(/already uploaded/i)).toBeDefined();
  });

  it("refuses a name with no document behind it", async () => {
    const add = vi.fn();
    const user = userEvent.setup();
    renderPage(repo(), certs({ add }));

    await user.type(await screen.findByLabelText(/certificate name/i), "Azure Fundamentals");
    await user.click(screen.getByRole("button", { name: /add certificate/i }));

    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByText(/cannot be verified|upload the certificate/i)).toBeDefined();
  });

  it("removes one, which is how a certificate is replaced", async () => {
    const remove = vi.fn();
    const user = userEvent.setup();
    renderPage(repo(), certs({ remove }));

    await user.click(await screen.findByRole("button", { name: /remove aws cloud practitioner/i }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("cert-1"));
  });

  it("says so when the upload fails, rather than clearing the form", async () => {
    const user = userEvent.setup();
    renderPage(
      repo(),
      certs({
        add: async () => {
          throw new Error("Could not upload your certificate. Please try again.");
        },
      }),
    );

    await user.type(await screen.findByLabelText(/certificate name/i), "Azure Fundamentals");
    await user.upload(screen.getByLabelText(/upload certificate/i), pdf());
    await user.click(screen.getByRole("button", { name: /add certificate/i }));

    expect(await screen.findByText(/could not upload/i)).toBeDefined();
    expect((screen.getByLabelText(/certificate name/i) as HTMLInputElement).value).toBe(
      "Azure Fundamentals",
    );
  });

  it("keeps each certificate's own remove button with its own name", async () => {
    renderPage(repo());

    const item = within(await screen.findByRole("listitem", { name: /nptel data structures/i }));
    expect(item.getByRole("button", { name: /remove nptel data structures/i })).toBeDefined();
  });
});

/**
 * Verification, from the student's side (asked for 2026-08-06).
 *
 * A certificate is a claim until a coordinator has checked it. The student
 * must be able to see which of theirs have been, and what to do about one
 * that was not - a rejection whose reason they never read is not a decision
 * they can act on.
 */
describe("certificate verification", () => {
  const withStatus = (
    status: "pending" | "verified" | "rejected",
    rejectionReason: string | null = null,
  ) => [{ id: "cert-1", name: "AWS Cloud Practitioner", url: null, status, rejectionReason }];

  it("says a new certificate is waiting to be checked", async () => {
    renderPage(repo(), certs({ list: async () => withStatus("pending") }));

    const row = await screen.findByLabelText("AWS Cloud Practitioner");
    expect(within(row).getByText(/awaiting verification/i)).toBeDefined();
  });

  it("says when one has been verified", async () => {
    renderPage(repo(), certs({ list: async () => withStatus("verified") }));

    const row = await screen.findByLabelText("AWS Cloud Practitioner");
    expect(within(row).getByText(/^verified$/i)).toBeDefined();
  });

  it("gives a rejected certificate its reason, which is the point of rejecting it", async () => {
    renderPage(
      repo(),
      certs({ list: async () => withStatus("rejected", "The document is a screenshot") }),
    );

    const row = await screen.findByLabelText("AWS Cloud Practitioner");
    expect(within(row).getByText(/not accepted/i)).toBeDefined();
    expect(within(row).getByText(/the document is a screenshot/i)).toBeDefined();
  });

  /** Q4: verified data is no longer the student's to change. */
  it("offers no Remove on a verified certificate", async () => {
    renderPage(repo(), certs({ list: async () => withStatus("verified") }));

    const row = await screen.findByLabelText("AWS Cloud Practitioner");
    expect(within(row).queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("still lets them remove a rejected one, which is how they replace it", async () => {
    renderPage(repo(), certs({ list: async () => withStatus("rejected", "Illegible") }));

    const row = await screen.findByLabelText("AWS Cloud Practitioner");
    expect(within(row).getByRole("button", { name: /remove/i })).toBeDefined();
  });
});
