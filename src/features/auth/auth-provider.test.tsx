// @vitest-environment jsdom
import { useAuthActions } from "@lib/auth-context";
import { setSupabaseClient } from "@lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthProvider } from "./auth-provider";
import { useAuth } from "./require-auth";

function Consumer() {
  const auth = useAuth();
  return <p data-testid="state">{auth.status === "signed-in" ? auth.role : auth.status}</p>;
}

const unsubscribe = vi.fn();
const signOutSpy = vi.fn().mockResolvedValue({ error: null });

function fakeClient(session: unknown): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe } } }),
      signOut: signOutSpy,
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { role: "ceo" }, error: null }) }),
      }),
    }),
  } as unknown as SupabaseClient;
}

afterEach(() => {
  setSupabaseClient(undefined);
  vi.clearAllMocks();
});

describe("SupabaseAuthProvider", () => {
  it("starts as loading so the guard does not bounce a returning user", () => {
    setSupabaseClient(fakeClient(null));
    render(
      <SupabaseAuthProvider>
        <Consumer />
      </SupabaseAuthProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("loading");
  });

  it("publishes the resolved identity once the session is read", async () => {
    setSupabaseClient(fakeClient({ user: { id: "u1", email: "boss@faceprep.in" } }));
    render(
      <SupabaseAuthProvider>
        <Consumer />
      </SupabaseAuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("ceo"));
  });

  /**
   * Signing out has to reach Supabase, not just clear local state: the session
   * lives in localStorage and survives a reload, so a "sign out" that only
   * forgot it in memory would put the next person straight back in.
   */
  it("ends the Supabase session when a consumer signs out", async () => {
    setSupabaseClient(fakeClient({ user: { id: "u1", email: "boss@faceprep.in" } }));

    function SignOutButton() {
      const { signOut } = useAuthActions();
      return (
        <button type="button" onClick={() => void signOut()}>
          out
        </button>
      );
    }

    render(
      <SupabaseAuthProvider>
        <SignOutButton />
      </SupabaseAuthProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "out" }));

    await waitFor(() => expect(signOutSpy).toHaveBeenCalledTimes(1));
  });

  it("stops listening when unmounted", async () => {
    setSupabaseClient(fakeClient(null));
    const { unmount } = render(
      <SupabaseAuthProvider>
        <Consumer />
      </SupabaseAuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("signed-out"));
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
