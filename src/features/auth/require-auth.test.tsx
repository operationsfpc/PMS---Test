// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthContext, type AuthState, RequireAuth } from "./require-auth";

/**
 * The guard in front of every screen.
 *
 * "Loading" must not redirect. Restoring a session from storage is async, so
 * treating the first render as signed-out would bounce a legitimately
 * signed-in user to /login on every refresh.
 */
function renderGuarded(state: AuthState) {
  return render(
    <AuthContext.Provider value={state}>
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route path="/login" element={<p>Login screen</p>} />
          <Route
            path="/protected"
            element={
              <RequireAuth>
                <p>Confidential student data</p>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("RequireAuth", () => {
  it("sends a signed-out visitor to the login screen", () => {
    renderGuarded({ status: "signed-out" });

    expect(screen.getByText("Login screen")).toBeDefined();
    expect(screen.queryByText("Confidential student data")).toBeNull();
  });

  it("lets a signed-in user through", () => {
    renderGuarded({ status: "signed-in", role: "student", email: "a@b.com", campuses: [] });

    expect(screen.getByText("Confidential student data")).toBeDefined();
  });

  it("sends an authenticated but unrecognised account to the login screen too", () => {
    renderGuarded({ status: "unrecognised", email: "ghost@faceprep.in" });

    expect(screen.getByText("Login screen")).toBeDefined();
    expect(screen.queryByText("Confidential student data")).toBeNull();
  });

  it("waits while the session is still being restored, rather than bouncing to login", () => {
    renderGuarded({ status: "loading" });

    expect(screen.queryByText("Login screen")).toBeNull();
    expect(screen.queryByText("Confidential student data")).toBeNull();
    expect(screen.getByRole("status")).toBeDefined();
  });
});
