// @vitest-environment jsdom
import { AuthActionsContext } from "@lib/auth-context";
import { act, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { SRF_SECTIONS, SrfPage } from "./srf-page";

/** The form links back to the dashboard, so every render needs a router. */
const render = (ui: React.ReactNode) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

/**
 * Structural contract for the Student Registration Form.
 *
 * This is a visual mock pending design approval, so these tests pin STRUCTURE
 * and ACCESSIBILITY, not styling. Field-level validation rules arrive with the
 * real form logic; pinning the skeleton now means restyling can never silently
 * drop a required field.
 *
 * PRD §4.1.
 */
/**
 * The SRF is full-bleed: it deliberately has its own chrome rather than the
 * app shell. That meant it also had no way to sign out - and it is the FIRST
 * screen a student sees, so for a student there was no way out of the
 * application at all.
 */
const ROSTER = {
  fullName: "Asha Rao",
  rollNumber: "21CSE1042",
  email: "asha@example.edu",
  degree: "B.E",
  branch: "CSE",
  passingYear: 2026,
  draft: null,
};

describe("SrfPage — signing out", () => {
  it("offers a way out from its own header", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    render(
      <AuthActionsContext.Provider value={{ signOut }}>
        <SrfPage />
      </AuthActionsContext.Provider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("SrfPage", () => {
  it("announces itself with a single top-level heading", () => {
    render(<SrfPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /student registration form/i }),
    ).toBeDefined();
  });

  it("renders every section from PRD §4.1", () => {
    render(<SrfPage />);
    for (const section of SRF_SECTIONS) {
      expect(
        screen.getByRole("heading", { level: 2, name: section.title }),
        `Missing section: ${section.title}`,
      ).toBeDefined();
    }
  });

  it("exposes each section as a landmark region for screen readers", () => {
    render(<SrfPage />);
    expect(screen.getAllByRole("region")).toHaveLength(SRF_SECTIONS.length);
  });

  describe("academic section", () => {
    it("captures 10th and 12th marks as percentages (decision Q8)", () => {
      render(<SrfPage />);
      expect(screen.getByLabelText(/10th marks \(%\)/i)).toBeDefined();
      expect(screen.getByLabelText(/12th marks \(%\)/i)).toBeDefined();
    });

    /**
     * Superseded 2026-08-04: the single cumulative CGPA and one-off arrear
     * counts are gone. Academics are per semester, and eligibility reads the
     * latest VERIFIED line (src/domain/academics.ts).
     */
    it("captures CGPA per semester, which is what eligibility tests against", () => {
      render(<SrfPage />);
      expect(screen.getByLabelText(/semester 1 result/i)).toBeDefined();
    });

    it("captures current arrears and arrear history separately, per semester", () => {
      render(<SrfPage />);
      // The distinction drives the no_standing vs no_history policies (Q6).
      expect(screen.getByLabelText(/semester 1 standing arrears/i)).toBeDefined();
      expect(screen.getByLabelText(/semester 1 arrear history/i)).toBeDefined();
    });
  });

  describe("role preferences", () => {
    it("offers exactly the five canonical role categories", () => {
      render(<SrfPage />);
      const region = screen.getByRole("region", { name: /placement preferences/i });
      expect(within(region).getAllByRole("checkbox")).toHaveLength(5);
    });

    it("labels them with the agreed wording", () => {
      render(<SrfPage />);
      expect(screen.getByRole("checkbox", { name: /software \/ technical/i })).toBeDefined();
      expect(
        screen.getByRole("checkbox", { name: /technical support \/ it operations/i }),
      ).toBeDefined();
      expect(screen.getByRole("checkbox", { name: /digital marketing/i })).toBeDefined();
      expect(screen.getByRole("checkbox", { name: /^sales$/i })).toBeDefined();
      expect(
        screen.getByRole("checkbox", { name: /operations and business roles/i }),
      ).toBeDefined();
    });
  });

  describe("consent", () => {
    it("requires explicit consent before submission (PRD §4.1)", () => {
      render(<SrfPage />);
      const consent = screen.getByRole("checkbox", { name: /consent/i });
      expect(consent.hasAttribute("required")).toBe(true);
    });
  });

  it("offers a submit action", () => {
    render(<SrfPage />);
    expect(screen.getByRole("button", { name: /submit for verification/i })).toBeDefined();
  });

  it("tells the student their submission must be verified before they can apply", () => {
    // PRD §22.1 — no DAF until the CPC approves. Setting the expectation early
    // prevents a support burden later.
    render(<SrfPage />);
    expect(screen.getByText(/verified by your campus placement coordinator/i)).toBeDefined();
  });
});

/**
 * Reported from UAT 2026-08-05.
 *
 * The progress tracker was hardcoded: the first pill was lit the moment the
 * form opened and the other six never lit at all. And there was no way back to
 * the dashboard or to a section already filled in, so a student who wanted to
 * check something they had entered had to scroll and hope.
 */
describe("SrfPage — progress and navigation", () => {
  it("lights no step before the student has entered anything", async () => {
    render(<SrfPage profile={ROSTER} />);

    const progress = await screen.findByRole("navigation", { name: /form progress/i });
    expect(within(progress).queryAllByRole("link", { current: "step" })).toHaveLength(0);
  });

  it("marks a section done as soon as it is genuinely complete", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} />);

    await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");
    await user.type(screen.getByLabelText(/alternate contact number/i), "9876500000");

    const progress = screen.getByRole("navigation", { name: /form progress/i });
    const personal = within(progress).getByRole("link", { name: /personal details/i });
    expect(personal.getAttribute("aria-current")).toBe("step");
  });

  it("does not mark a section done while it is half filled in", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} />);

    await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");

    const progress = screen.getByRole("navigation", { name: /form progress/i });
    const personal = within(progress).getByRole("link", { name: /personal details/i });
    expect(personal.getAttribute("aria-current")).toBeNull();
  });

  it("says how far through the student is", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} />);

    await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");
    await user.type(screen.getByLabelText(/alternate contact number/i), "9876500000");

    // Four required sections since the marksheet step was folded into
    // academics (2026-08-06), so personal alone is a quarter of the way.
    expect(screen.getByText(/25% complete/i)).toBeDefined();
  });

  it("lets the student jump back to any section from the tracker", async () => {
    render(<SrfPage profile={ROSTER} />);

    const progress = await screen.findByRole("navigation", { name: /form progress/i });
    const academic = within(progress).getByRole("link", { name: /academic record/i });

    expect(academic.getAttribute("href")).toBe("#academic");
    expect(document.getElementById("academic")).not.toBeNull();
  });

  it("offers a way back to the dashboard without losing the form", async () => {
    render(<SrfPage profile={ROSTER} />);

    const home = await screen.findByRole("link", { name: /my dashboard/i });
    expect(home.getAttribute("href")).toBe("/student");
  });
});

/**
 * Draft saving, requested from UAT 2026-08-05: "students can continue the
 * registration later without losing their data."
 *
 * The tracker tells the student their entries are saved as they go, so this
 * has to be true — a promise on screen that the application does not keep is
 * worse than no promise.
 */
describe("SrfPage — saving a draft", () => {
  const flush = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
  };

  it("saves what the student has typed, without being asked", async () => {
    const saveDraft = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} saveDraft={saveDraft} />);

    await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");
    await flush();

    expect(saveDraft).toHaveBeenCalled();
    expect(saveDraft.mock.calls.at(-1)?.[0]).toMatchObject({ mobile: "9876543210" });
  });

  it("tells the student it has saved, and when", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} saveDraft={async () => true} />);

    await user.type(screen.getByLabelText(/^mobile number/i), "9876543210");
    await flush();

    expect(await screen.findByText(/draft saved/i)).toBeDefined();
  });

  it("lets the student save on demand, for when they are about to leave", async () => {
    const saveDraft = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} saveDraft={saveDraft} />);

    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
  });

  it("says plainly when a draft could not be saved, rather than pretending", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} saveDraft={async () => false} />);

    await user.click(screen.getByRole("button", { name: /save draft/i }));

    expect(await screen.findByText(/could not be saved/i)).toBeDefined();
  });

  it("reopens the form where the student left it", async () => {
    render(
      <SrfPage profile={ROSTER} draft={{ mobile: "9876543210", technicalSkills: "TypeScript" }} />,
    );

    const mobile = screen.getByLabelText(/^mobile number/i) as HTMLInputElement;
    expect(mobile.value).toBe("9876543210");
  });

  /** The roster is authoritative for identity, however old the draft is. */
  it("does not let a stale draft overwrite the roster's identity", async () => {
    render(<SrfPage profile={ROSTER} draft={{ rollNumber: "OLD-ROLL", branch: "ECE" }} />);

    const roll = screen.getByLabelText(/roll number/i) as HTMLInputElement;
    expect(roll.value).toBe("21CSE1042");
  });

  /**
   * A File does not survive JSON — it stringifies to `{}`. Storing one would
   * put `{"tenth": {}}` in the draft, and the next visit would restore a
   * marksheet that is not there, count it as provided, and let the student
   * submit marks nobody can verify. Uploads are deliberately re-picked.
   */
  it("never stores a picked file in the draft, because a file cannot survive one", async () => {
    const saveDraft = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup({ delay: null });
    render(<SrfPage profile={ROSTER} saveDraft={saveDraft} />);

    await user.upload(
      screen.getByLabelText(/^10th marksheet/i),
      new File(["scan"], "10th.pdf", { type: "application/pdf" }),
    );
    await flush();

    expect(saveDraft).toHaveBeenCalled();
    // toEqual, not toMatchObject: `toMatchObject({ marksheets: {} })` passes
    // against `{ tenth: {} }` too, and would have proved nothing.
    const saved = saveDraft.mock.calls.at(-1)?.[0] as { marksheets: Record<string, unknown> };
    expect(saved.marksheets).toEqual({});
  });

  it("does not restore a marksheet from a draft that cannot contain one", async () => {
    render(
      <SrfPage
        profile={ROSTER}
        // Exactly what JSON.stringify makes of a form full of picked files:
        // every key present, every value an empty object.
        draft={{
          mobile: "9876543210",
          marksheets: { tenth: {}, twelfth: {}, "semester-1": {} },
        }}
      />,
    );

    // The file inputs are empty: a draft cannot carry a File, so the student
    // re-picks them. Restoring `{}` as though it were a document would let an
    // unevidenced form through.
    expect((screen.getByLabelText(/10th marksheet/i) as HTMLInputElement).files).toHaveLength(0);
    expect((screen.getByLabelText(/12th marksheet/i) as HTMLInputElement).files).toHaveLength(0);
    // And the tracker does not claim the academic section is finished.
    expect(screen.queryByRole("link", { name: /academic record — done/i })).toBeNull();
  });

  it("does not nag a student who has typed nothing", async () => {
    const saveDraft = vi.fn().mockResolvedValue(true);
    render(<SrfPage profile={ROSTER} saveDraft={saveDraft} />);

    await flush();

    expect(saveDraft).not.toHaveBeenCalled();
  });
});
