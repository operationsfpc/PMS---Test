import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Deployment configuration guard.
 *
 * This app is a client-side SPA: React Router owns /login, /student and the
 * rest. A static host knows nothing about those paths, so unless it is told to
 * fall back to index.html, opening or refreshing any URL other than "/" serves
 * a 404.
 *
 * That failure only appears in production, and looks like "the app is broken"
 * rather than "one config key is wrong" - so it is pinned here.
 */
const config = JSON.parse(
  readFileSync(fileURLToPath(new URL("../wrangler.json", import.meta.url)), "utf8"),
);

/** Copied into dist/ by Vite, then honoured by Cloudflare at upload time. */
const assetsIgnore = readFileSync(
  fileURLToPath(new URL("../public/.assetsignore", import.meta.url)),
  "utf8",
);

describe("Cloudflare deployment config", () => {
  it("serves the built assets", () => {
    expect(config.assets.directory).toBe("./dist");
  });

  it("falls back to the SPA so deep links and refreshes work", () => {
    expect(config.assets.not_found_handling).toBe("single-page-application");
  });

  it("pins a compatibility date, so a future Workers runtime cannot change behaviour silently", () => {
    expect(config.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe("keeps development-only files off the public internet", () => {
    // Shipped on the first deploy. Harmless, but neither belongs in production.
    it("excludes macOS directory metadata", () => {
      expect(assetsIgnore).toMatch(/^\.DS_Store$/m);
    });

    it("excludes the MSW service worker, which can intercept network requests", () => {
      expect(assetsIgnore).toMatch(/^mockServiceWorker\.js$/m);
    });
  });
});
