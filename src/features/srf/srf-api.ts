import type { SrfSubmission } from "./srf-schema";

export interface SrfSubmitResult {
  readonly id: string;
  readonly status: string;
}

/** Thrown for a server-side refusal the student can act on. */
export class SrfSubmitError extends Error {}

export async function submitSrf(values: SrfSubmission): Promise<SrfSubmitResult> {
  const response = await fetch("/api/srf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new SrfSubmitError(body.error ?? "Could not submit your form. Please try again.");
  }

  return (await response.json()) as SrfSubmitResult;
}
