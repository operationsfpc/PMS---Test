import { describe, expect, it } from "vitest";
import { decideSrf } from "./srf-decision";
import { SRF_STATUSES } from "./types";

/**
 * The CPC's verification decision (PRD §4.2).
 *
 * Only a submitted form can be decided. Approval is what unlocks every drive
 * the student will ever see (R5), so an accidental approval of a draft, or a
 * second approval of an already-approved student, must be refused here rather
 * than relied upon to be prevented by the UI.
 *
 * A1 (assumption, authorised 2026-08-02): a rejected student may fix their form
 * and resubmit. Rejection is therefore NOT terminal, unlike a rejected PIF.
 */
describe("decideSrf", () => {
  it("approves a submitted form", () => {
    expect(decideSrf("srf_submitted", { decision: "approve" })).toEqual({
      ok: true,
      next: "srf_approved",
    });
  });

  it("rejects a submitted form when a reason is given", () => {
    expect(
      decideSrf("srf_submitted", { decision: "reject", reason: "10th marksheet unreadable" }),
    ).toEqual({
      ok: true,
      next: "srf_rejected",
    });
  });

  it("refuses a rejection with no reason, because the student must know what to fix", () => {
    const result = decideSrf("srf_submitted", { decision: "reject", reason: "   " });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/reason/i);
  });

  it.each(SRF_STATUSES.filter((s) => s !== "srf_submitted"))(
    "refuses to decide a form in %s",
    (status) => {
      const result = decideSrf(status, { decision: "approve" });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toMatch(/submitted/i);
    },
  );

  it("allows a rejected student to be decided again once they resubmit (A1)", () => {
    // Resubmission returns them to srf_submitted, which is decidable.
    expect(decideSrf("srf_submitted", { decision: "approve" }).ok).toBe(true);
  });
});
