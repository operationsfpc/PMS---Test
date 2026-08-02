// @vitest-environment jsdom
import { setSupabaseClient } from "@lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage, SUPPORT_EMAIL } from "./login-page";
import { AuthContext, type AuthState } from "./require-auth";

/**
 * The single login screen. Confirmed decisions:
 *   - ONE screen for students and staff alike; role routing happens after.
 *   - A refused sign-in gets a friendly explanation and a support address,
 *     never the raw Postgres error text from 0009_guards.sql.
 *
 * A refusal produces NO session: the allowlist trigger fires BEFORE INSERT on
 * auth.users, so the account is never created and Supabase redirects back with
 * an error in the query string. There is nothing to sign out of.
 */

function renderAt(path: string, auth: AuthState = { status: "signed-out" }) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Signed in already</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function stubAuth() {
  const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
  setSupabaseClient({ auth: { signInWithOAuth } } as unknown as SupabaseClient);
  return signInWithOAuth;
}

afterEach(() => {
  setSupabaseClient(undefined);
  vi.restoreAllMocks();
});

describe("LoginPage", () => {
  it("announces itself with a single top-level heading", () => {
    stubAuth();
    renderAt("/login");
    expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
  });

  it("offers exactly one sign-in action, and it is Google", () => {
    stubAuth();
    renderAt("/login");
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeDefined();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("starts the Google OAuth flow when pressed", async () => {
    const signInWithOAuth = stubAuth();
    renderAt("/login");

    await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    const [args] = signInWithOAuth.mock.calls[0] ?? [];
    expect(args.provider).toBe("google");
  });

  describe("when Google succeeded but the allowlist refused the address", () => {
    const REFUSAL =
      "Address stranger@gmail.com is not registered. Ask your placement coordinator for an invitation.";

    it("explains it in plain language instead of showing the database error", () => {
      stubAuth();
      renderAt(`/login?error=server_error&error_description=${encodeURIComponent(REFUSAL)}`);

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/not set up/i);
      expect(alert.textContent).not.toMatch(/Address .* is not registered/);
      expect(alert.textContent).not.toMatch(/placement coordinator for an invitation/);
    });

    it("tells them exactly what writing in will achieve", () => {
      stubAuth();
      renderAt(`/login?error=server_error&error_description=${encodeURIComponent(REFUSAL)}`);

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain(SUPPORT_EMAIL);
      // Not just an address to shout at - say what it gets them.
      expect(alert.textContent).toMatch(/to get invited to the placement management system/i);
    });
  });

  it("reports any other sign-in failure without blaming the user", () => {
    stubAuth();
    renderAt("/login?error=access_denied&error_description=User%20cancelled");

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/could not be completed/i);
    expect(alert.textContent).toContain(SUPPORT_EMAIL);
  });

  it("shows no alert on a clean visit", () => {
    stubAuth();
    renderAt("/login");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * Supabase returns OAuth results to `redirectTo`, so that URL must be /login
   * or an allowlist refusal would be silently lost. A successful sign-in
   * therefore also lands here, and must be moved along to role routing.
   */
  it("moves an already signed-in user along instead of offering sign-in again", () => {
    stubAuth();
    renderAt("/login", { status: "signed-in", role: "student", email: "s@example.com" });

    expect(screen.getByText("Signed in already")).toBeDefined();
    expect(screen.queryByRole("button", { name: /sign in with google/i })).toBeNull();
  });
});
