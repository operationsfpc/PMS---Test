import type { RequestHandler } from "msw";

/**
 * Remaining mock endpoints.
 *
 * The SRF handler has been retired: submission now goes to Supabase through
 * `srf-api.ts`, and leaving a stand-in behind would let a broken wiring pass
 * tests by silently answering from here instead.
 *
 * Screens still on mock data (PIF approvals, shortlisting, DAF publish,
 * attendance) read from in-component fixtures rather than HTTP, so they need
 * no handlers yet. Set VITE_USE_MOCKS=true to run the app without a database.
 */
export const handlers: RequestHandler[] = [];
