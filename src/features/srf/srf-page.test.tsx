// @vitest-environment jsdom
import { AuthActionsContext } from "@lib/auth-context";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SRF_SECTIONS, SrfPage } from "./srf-page";

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
      expect(screen.getByLabelText(/semester 1 cgpa/i)).toBeDefined();
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
