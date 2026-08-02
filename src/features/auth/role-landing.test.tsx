// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthContext, type AuthState } from "./require-auth";
import { RoleLanding } from "./role-landing";

/**
 * Where signing in drops you. The mapping itself is a domain rule
 * (landingRouteForRole); this component only obeys it.
 *
 * Roles whose screen does not exist yet get an honest message rather than a
 * redirect to somebody else's dashboard.
 */
function renderLanding(state: AuthState) {
  return render(
    <AuthContext.Provider value={state}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RoleLanding />} />
          <Route path="/student" element={<p>Student dashboard</p>} />
          <Route path="/central/drives" element={<p>Drive cockpit</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("RoleLanding", () => {
  it("drops a student on the student dashboard", () => {
    renderLanding({ status: "signed-in", role: "student", email: "s@example.com" });
    expect(screen.getByText("Student dashboard")).toBeDefined();
  });

  it("drops the central coordinator on the drive cockpit", () => {
    renderLanding({
      status: "signed-in",
      role: "central_placement_coordinator",
      email: "c@example.com",
    });
    expect(screen.getByText("Drive cockpit")).toBeDefined();
  });

  it("tells a role with no screen yet the truth, rather than redirecting them somewhere wrong", () => {
    // The CEO dashboard is not built. Admin now has roster import, so it is no
    // longer an example of a role without a screen.
    renderLanding({ status: "signed-in", role: "ceo", email: "a@faceprep.in" });

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/no dashboard yet/i);
    // The signed-in identity is still shown, so it is clear login worked.
    expect(status.textContent).toContain("a@faceprep.in");
  });
});
