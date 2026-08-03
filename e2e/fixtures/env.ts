/**
 * The fake Supabase origin every journey runs against.
 *
 * Lives here rather than in playwright.config.ts because a spec that imports
 * the config re-enters it while Playwright is still loading it, and Playwright
 * then refuses the whole run ("did not expect test.describe() to be called
 * here"). Plain constants, imported by both, keep the two apart.
 *
 * The host does not resolve on purpose: if the route stub ever misses, the
 * request fails loudly instead of reaching the real Mumbai project.
 */
export const E2E_SUPABASE_URL = "https://e2e.supabase.co";
export const E2E_ANON_KEY = "e2e-anon-key";
export const E2E_PORT = 5174;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
