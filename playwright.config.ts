import { defineConfig, devices } from "@playwright/test";
import { E2E_ANON_KEY, E2E_BASE_URL, E2E_PORT, E2E_SUPABASE_URL } from "./e2e/fixtures/env";

/**
 * E2E journeys — one per role (CLAUDE.md, "Journeys").
 *
 * These run against a stubbed Supabase origin, never the live Mumbai project.
 * The audit table is append-only, so a test that writes to production leaves
 * rows nobody can ever delete. `e2e/fixtures/supabase.ts` fails the run if any
 * request escapes the stub.
 *
 * `E2E_SUPABASE_URL` is deliberately a host that does not exist. Vite gives
 * process.env precedence over .env.local (verified against vite@8's loadEnv),
 * so this overrides the developer's real project ref without touching it.
 */

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  // A journey that only passes on a retry is a flaky journey. Surface it.
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    // Vite binds to `localhost` only; 127.0.0.1 is refused.
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "student-mobile",
      // PRD §21.2 — students are on phones. Their journey is tested on one.
      use: { ...devices["Pixel 7"] },
      testMatch: /student-.*\.spec\.ts$/,
    },
    {
      name: "staff-desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /student-.*\.spec\.ts$/,
    },
  ],
  webServer: {
    command: `pnpm vite --port ${E2E_PORT} --strictPort`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: E2E_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: E2E_ANON_KEY,
      // MSW would intercept the stubbed origin first and hide wiring bugs.
      VITE_USE_MOCKS: "false",
    },
  },
});
