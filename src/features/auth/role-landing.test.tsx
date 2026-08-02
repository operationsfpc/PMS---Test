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
 * The five read-only reporting roles share one dashboard; RLS scopes what
 * each of them can actually see.
 */
function renderLanding(state: AuthState) {
  return render(
    <AuthContext.Provider value={state}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RoleLanding />} />
          <Route path="/student" element={<p>Student dashboard</p>} />
          <Route path="/central/drives" element={<p>Drive cockpit</p>} />
          <Route path="/dashboard" element={<p>Dashboard</p>} />
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

  it("drops a CEO on the shared dashboard", () => {
    renderLanding({ status: "signed-in", role: "ceo", email: "ceo@faceprep.in" });
    expect(screen.getByText("Dashboard")).toBeDefined();
  });
});
