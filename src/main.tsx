import { SupabaseAuthProvider } from "@features/auth/auth-provider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app";
import "./styles/theme.css";

/**
 * The mock backend is now opt-in. Auth talks to the real Supabase project, and
 * MSW intercepting those calls would make sign-in impossible to debug.
 * Set VITE_USE_MOCKS=true in .env.local to review screens without a database.
 */
async function enableMocking(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (import.meta.env.VITE_USE_MOCKS !== "true") return;
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

const root = document.getElementById("root");
if (root === null) throw new Error("Root element #root not found");

await enableMocking();

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <SupabaseAuthProvider>
        <App />
      </SupabaseAuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
