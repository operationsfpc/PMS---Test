// Type definitions for Supabase Edge Functions running on Deno.
// Provides type safety and clears TypeScript LSP diagnostics in standard IDEs.

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    toObject(): Record<string, string>;
  }
  export const env: Env;
}

declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(
    handler: (request: Request) => Response | Promise<Response>,
    options?: {
      port?: number;
      hostname?: string;
      onListen?: (params: { port: number; hostname: string }) => void;
      onError?: (error: unknown) => Response | Promise<Response>;
    },
  ): void | Promise<void>;
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}
