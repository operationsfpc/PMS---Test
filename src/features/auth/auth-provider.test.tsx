// @vitest-environment jsdom
import { setSupabaseClient } from "@lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthProvider } from "./auth-provider";
import { useAuth } from "./require-auth";

function Consumer() {
  const auth = useAuth();
  return <p data-testid="state">{auth.status === "signed-in" ? auth.role : auth.status}</p>;
}

const unsubscribe = vi.fn();

function fakeClient(session: unknown): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe } } }),
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
