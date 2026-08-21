import { describe, expect, it } from "vitest";
import { canCompleteDrive, completionReadiness, decideCompletion } from "./drive-completion";

/**
 * Batch C item 3 (2026-08-21, answer 3b): a drive is completed when every
 * applicant holds a terminal outcome (offer or not selected). The Central
 * CPC marks it; completing EARLY is allowed but demands a typed reason,
 * because real drives fizzle (the company walks away, students no-show) and
 * an audit trail beats a drive stuck "in rounds" forever.
 */
describe("completionReadiness", () => {
  it("is ready when every application has concluded", () => {
    expect(completionReadiness([{ stage: "selected" }, { stage: "not_selected" }])).toEqual({
      ready: true,
      undecided: 0,
    });
  });

  it("counts the students still undecided", () => {
    expect(
      completionReadiness([{ stage: "selected" }, { stage: "in_process" }, { stage: "applied" }]),
    ).toEqual({ ready: false, undecided: 2 });
  });

  it("a drive nobody applied to is trivially ready — there is nothing to decide", () => {
    expect(completionReadiness([])).toEqual({ ready: true, undecided: 0 });
  });
});

describe("canCompleteDrive", () => {
  it("is the Central Placement Coordinator's verb alone", () => {
    expect(canCompleteDrive("central_placement_coordinator")).toBe(true);
    expect(canCompleteDrive("delivery_head")).toBe(false);
    expect(canCompleteDrive("account_executive")).toBe(false);
  });
});

describe("decideCompletion", () => {
  it("allows a ready drive with no reason at all", () => {
    expect(decideCompletion({ ready: true, undecided: 0 }, "")).toEqual({ allowed: true });
  });

  it("refuses an early completion without a reason — the students deserve a why", () => {
    const decision = decideCompletion({ ready: false, undecided: 3 }, "  ");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/reason/i);
  });

  it("refuses a token reason — 'na' explains nothing", () => {
    expect(decideCompletion({ ready: false, undecided: 3 }, "na").allowed).toBe(false);
  });

  it("allows an early completion with a real reason", () => {
    expect(
      decideCompletion({ ready: false, undecided: 3 }, "Company closed the process after Round 2"),
    ).toEqual({ allowed: true });
  });
});
