import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client. Anon key only — every table is protected by RLS, so the
 * browser never needs more privilege than the signed-in user has.
 */
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
}

let client: SupabaseClient | undefined;

export function supabase(): SupabaseClient {
  if (client === undefined) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. Copy .env.example to .env.local.",
      );
    }
    client = createSupabaseClient(url, key);
  }
  return client;
}

/** Test seam: lets tests inject a client pointed at an intercepted origin. */
export function setSupabaseClient(next: SupabaseClient | undefined): void {
  client = next;
}
