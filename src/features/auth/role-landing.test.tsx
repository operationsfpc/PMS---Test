// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthState } from "./require-auth";
import { RoleLanding } from "./role-landing";
import type { StudentStanding } from "./student-standing";

/**
 * Where signing in drops you. The mapping itself is a domain rule
 * (landingRouteForRole / studentLandingRoute); this component only obeys it.
 *
 * The five read-only reporting roles share one dashboard; RLS scopes what
 * each of them can actually see.
 */
function renderLanding(
  state: AuthState,
  readStanding: () => Promise<StudentStanding | null> = async () => ({
    srfStatus: "srf_approved",
    participationStatus: "active",
  }),
) {
  return render(
    <AuthContext.Provider value={state}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RoleLanding readStanding={readStanding} />} />
          <Route path="/student" element={<p>Student dashboard</p>} />
          <Route path="/srf" element={<p>Registration form</p>} />
          <Route path="/central/drives" element={<p>Drive cockpit</p>} />
          <Route path="/dashboard" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const student: AuthState = { status: "signed-in", role: "student", email: "s@example.com" };

describe("RoleLanding", () => {
  it("drops a verified student on the student dashboard", async () => {
    renderLanding(student);
    expect(await screen.findByText("Student dashboard")).toBeDefined();
  });

  it("drops the central coordinator on the drive cockpit", () => {
    renderLanding({
      status: "signed-in",
      role: "central_placement_coordinator",
      email: "c@example.com",
    });
    expect(screen.getByText("Drive cockpit")).toBeDefined();
  });

  it("drops a CEO on the shared dashboard", () => {
    renderLanding({ status: "signed-in", role: "ceo", email: "ceo@faceprep.in" });
    expect(screen.getByText("Dashboard")).toBeDefined();
  });

  /**
   * Asked for 2026-08-06: "when a student logs in for the first time, he
   * should directly land on the registration page." They landed on the
   * dashboard, which for an unregistered student is a near-empty screen whose
   * only useful content is a link to the form they were meant to be filling.
   */
  describe("a student who has not registered yet", () => {
    it("lands directly on the registration form", async () => {
      renderLanding(student, async () => ({
        srfStatus: "invited",
        participationStatus: "active",
      }));

      expect(await screen.findByText("Registration form")).toBeDefined();
    });

    it("still lands there on a later sign-in, until the form is actually sent", async () => {
      renderLanding(student, async () => ({
        srfStatus: "registered",
        participationStatus: "active",
      }));

      expect(await screen.findByText("Registration form")).toBeDefined();
    });

    /**
     * The trap. Participation is settled before registration is asked for, so
     * a student who has opted out must never be routed into a form they cannot
     * act on — opting out cannot be reversed.
     */
    it("is never routed to the form once they have opted out", async () => {
      renderLanding(student, async () => ({
        srfStatus: "invited",
        participationStatus: "opted_out",
      }));

      expect(await screen.findByText("Student dashboard")).toBeDefined();
    });
  });

  /**
   * Deciding where a student goes needs a round trip, and a blank screen
   * during it looks like a broken login.
   */
  it("says it is working while it finds out where the student belongs", () => {
    renderLanding(student, () => new Promise(() => {}));

    expect(screen.getByRole("status")).toBeDefined();
  });

  /**
   * Never trap them. If we cannot read their standing we cannot know whether
   * the form is even appropriate, and the dashboard carries the prompt with a
   * link to it — so the fallback informs rather than guesses.
   */
  it("falls back to the dashboard when their standing cannot be read", async () => {
    renderLanding(student, async () => null);

    expect(await screen.findByText("Student dashboard")).toBeDefined();
  });

  it("falls back to the dashboard when the lookup fails outright", async () => {
    renderLanding(student, async () => {
      throw new Error("network");
    });

    expect(await screen.findByText("Student dashboard")).toBeDefined();
  });

  /** Nobody else pays for the student lookup. */
  it("does not look up a standing for a role that has no student record", async () => {
    const readStanding = vi.fn();
    renderLanding(
      { status: "signed-in", role: "ceo", email: "ceo@faceprep.in" },
      readStanding as unknown as () => Promise<StudentStanding | null>,
    );

    await waitFor(() => expect(screen.getByText("Dashboard")).toBeDefined());
    expect(readStanding).not.toHaveBeenCalled();
  });
});
