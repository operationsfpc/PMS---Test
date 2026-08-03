import type { Page } from "@playwright/test";
import { E2E_SUPABASE_URL } from "./env";

/**
 * Puts a signed-in session in the browser before the app boots.
 *
 * Google OAuth cannot be driven from a test — and should not be. What these
 * journeys prove is what happens AFTER identity is established: routing, role
 * resolution, data loading, and the rules. The sign-in screen itself is
 * covered by `src/features/auth/login-page.test.tsx`.
 *
 * This is a test fixture, never a production seam. Nothing in `src/` knows it
 * exists, so it cannot become a way into the real application.
 */

/** supabase-js derives this from the URL host: `sb-<first label>-auth-token`. */
const STORAGE_KEY = `sb-${new URL(E2E_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface SignInOptions {
  readonly role: "student" | "staff";
  /** The auth user id the stub will answer for. */
  readonly userId?: string;
  readonly email?: string;
  readonly studentId?: string;
}

export async function signInAs(page: Page, options: SignInOptions): Promise<void> {
  const userId = options.userId ?? "auth-user-1";
  const email = options.email ?? "anitha@example.com";
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;

  const accessToken = [
    base64url({ alg: "HS256", typ: "JWT" }),
    base64url({ sub: userId, email, role: "authenticated", exp: expiresAt }),
    "e2e-not-a-real-signature",
  ].join(".");

  const session = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: "e2e-refresh-token",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email,
      app_metadata: { provider: "google" },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };

  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    [STORAGE_KEY, JSON.stringify(session)] as const,
  );
}
