// @vitest-environment jsdom
import type { AppRole } from "@domain/types";
import { AuthContext, type AuthState } from "@features/auth/require-auth";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

/**
 * Navigation must follow the SIGNED-IN role, not a preview control.
 *
 * The role switcher is a development convenience for reviewing screens without
 * a database. Shipping it would let any signed-in user navigate into another
 * role's screens: RLS would return nothing, but offering the route at all is
 * misleading and invites support tickets about "broken" pages.
 */
function shellFor(auth: AuthState) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <AppShell>content</AppShell>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const signedIn = (role: AppRole): AuthState => ({
  status: "signed-in",
  role,
  email: "x@example.com",
});

afterEach(() => vi.unstubAllEnvs());

describe("AppShell navigation", () => {
  it("shows a student their own links", () => {
    shellFor(signedIn("student"));

    expect(screen.getByRole("link", { name: /my registration form/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /drive cockpit/i })).toBeNull();
  });

  it("shows the central coordinator their own links, and not the student's", () => {
    shellFor(signedIn("central_placement_coordinator"));

    expect(screen.getByRole("link", { name: /drive cockpit/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /my registration form/i })).toBeNull();
  });

  it("offers the AE the PIF", () => {
    shellFor(signedIn("account_executive"));
    expect(screen.getByRole("link", { name: /position information form/i })).toBeDefined();
  });

  it("gives a student the drives list, not just a dashboard", () => {
    shellFor(signedIn("student"));
    expect(screen.getByRole("link", { name: /open drives/i })).toBeDefined();
  });

  it("gives a CEO their read-only overview", () => {
    shellFor(signedIn("ceo"));
    expect(screen.getByRole("link", { name: /executive overview/i })).toBeDefined();
  });

  /** The reporting roles share one dashboard, labelled for each of them. */
  it("labels the shared dashboard for the role reading it", () => {
    shellFor(signedIn("campus_manager"));
    expect(screen.getByRole("link", { name: /campus overview/i })).toBeDefined();
  });
});

describe("the preview-as switcher", () => {
  it("is available in development, where there may be no database", () => {
    vi.stubEnv("DEV", true);
    shellFor(signedIn("student"));
    expect(screen.getByLabelText(/preview as/i)).toBeDefined();
  });

  it("is never shipped to production", () => {
    vi.stubEnv("DEV", false);
    shellFor(signedIn("student"));
    expect(screen.queryByLabelText(/preview as/i)).toBeNull();
  });
});

/**
 * The avatar was hardcoded to "PR", a leftover from the mock era. It told
 * every signed-in user they were someone else, which is a small lie the whole
 * session then rests on.
 */
describe("the account avatar", () => {
  it("shows the signed-in user's own initials", () => {
    shellFor({ status: "signed-in", role: "admin", email: "karthikraja@faceprep.in" });
    expect(screen.getByTitle(/karthikraja@faceprep.in/i).textContent).toBe("KA");
  });

  it("does not show one fixed set of initials to everybody", () => {
    shellFor({ status: "signed-in", role: "student", email: "priya@gmail.com" });
    expect(screen.getByTitle(/priya@gmail.com/i).textContent).toBe("PR");

    shellFor({ status: "signed-in", role: "admin", email: "arjun@faceprep.in" });
    expect(screen.getByTitle(/arjun@faceprep.in/i).textContent).toBe("AR");
  });
});
