import { landingRouteForRole } from "@domain/auth-routing";
import type { AppRole } from "@domain/types";
import { useAuth } from "@lib/auth-context";
import { Link } from "react-router";
import { Button, Card } from "./ui";

/**
 * Shown when a signed-in user reaches a route their role may not enter.
 *
 * Replaces the raw `<p>` tags the old inline guards rendered — same words,
 * but styled as a card so it reads as an intentional destination rather than
 * a broken page. The "Go to dashboard" button gives them somewhere to click;
 * nobody should be stuck on a refusal screen with no way out.
 */
export function AccessDeniedPage({ reason }: { reason: string }) {
  const auth = useAuth();
  const role: AppRole = auth.status === "signed-in" ? auth.role : "student";

  return (
    <div className="flex flex-col items-center px-4 py-16 text-center">
      <Card className="max-w-md p-8">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-danger-50 text-danger-500">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-6"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h2 className="font-heading text-xl font-bold text-ink-900">You don't have access</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">{reason}</p>
        <div className="mt-6">
          <Link to={landingRouteForRole(role)}>
            <Button variant="primary">Go to dashboard</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
