import { Badge } from "@components/ui";
import { participationOutcome } from "@domain/participation";
import type { RequestStatus } from "./participation-contract";

/**
 * What happened to a request the student raised. F3 (UAT 2026-08-06).
 *
 * Both screens show it, and neither decides what it says — the wording and the
 * fallback for a decline with no reason are the domain's
 * (`participationOutcome`), so the two screens can never drift apart.
 */
export function RequestOutcome({
  status,
  reason,
}: {
  status: RequestStatus;
  reason: string | null;
}) {
  const outcome = participationOutcome({ status, reason });

  const tone =
    outcome.tone === "approved" ? "success" : outcome.tone === "declined" ? "danger" : "warning";

  return (
    <div>
      <Badge tone={tone}>{outcome.label}</Badge>
      {outcome.detail !== null && <p className="mt-1 text-sm text-ink-700">{outcome.detail}</p>}
    </div>
  );
}

/** Asia/Kolkata, because that is where every student reading it is. */
export const submittedOn = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
