import { describe, expect, it } from "vitest";
import { canGoLive, type DriveReadiness, decidePif, missingBeforeGoLive } from "./drive-lifecycle";

/**
 * The PIF/drive lifecycle (domain-model §3).
 *
 * One record, three owners: the AE drafts it, the Delivery Head approves and
 * classifies it, the Central CPC completes and publishes it. The rules that
 * decide when it may move are here, so the form, the approval queue and the
 * database triggers all obey one definition.
 */

const ready: DriveReadiness = {
  companyName: "Zoho",
  roleTitle: "Software Engineer",
  roleCategory: "software_technical",
  jobDescription: "Build things.",
  locations: ["Chennai"],
  ctcMinLpa: 6,
  driveType: "placement",
  offerCategory: "dream",
  hasEligibilityCriteria: true,
  roundCount: 2,
  applicationStart: "2026-09-01T00:00:00Z",
  applicationEnd: "2026-09-10T00:00:00Z",
  onHold: false,
};

describe("missingBeforeGoLive", () => {
  it("reports nothing missing for a complete drive", () => {
    expect(missingBeforeGoLive(ready)).toEqual([]);
  });

  it.each([
    ["companyName", { companyName: "  " }],
    ["roleTitle", { roleTitle: "" }],
    ["jobDescription", { jobDescription: "" }],
    ["locations", { locations: [] }],
    ["ctcMinLpa", { ctcMinLpa: null }],
    ["offerCategory", { offerCategory: null }],
    ["eligibility", { hasEligibilityCriteria: false }],
    ["rounds", { roundCount: 0 }],
    ["applicationStart", { applicationStart: null }],
    ["applicationEnd", { applicationEnd: null }],
  ] as const)("reports %s when it is absent", (_label, patch) => {
    const result = missingBeforeGoLive({ ...ready, ...patch });
    expect(result.length).toBeGreaterThan(0);
  });

  it("lists every missing field at once, not just the first", () => {
    const result = missingBeforeGoLive({
      ...ready,
      companyName: "",
      roleTitle: "",
      roundCount: 0,
    });
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects an application window that ends before it starts", () => {
    const result = missingBeforeGoLive({
      ...ready,
      applicationStart: "2026-09-10T00:00:00Z",
      applicationEnd: "2026-09-01T00:00:00Z",
    });
    expect(result.join(" ")).toMatch(/window/i);
  });
});

describe("canGoLive", () => {
  it("allows a complete, approved, unheld drive", () => {
    expect(canGoLive("approved", ready)).toEqual({ ok: true });
  });

  it("refuses while the drive is on hold, however complete it is", () => {
    const result = canGoLive("approved", { ...ready, onHold: true });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reasons.join(" ")).toMatch(/hold/i);
  });

  it("refuses a drive that has not been approved by the Delivery Head", () => {
    const result = canGoLive("submitted", ready);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reasons.join(" ")).toMatch(/approved/i);
  });

  it("refuses an incomplete drive and says what is missing", () => {
    const result = canGoLive("approved", { ...ready, roundCount: 0 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reasons.length).toBeGreaterThan(0);
  });
});

describe("decidePif", () => {
  it("approves a submitted PIF and records the Delivery Head's category", () => {
    expect(decidePif("submitted", { decision: "approve", offerCategory: "super_dream" })).toEqual({
      ok: true,
      next: "approved",
    });
  });

  it("requires an offer category at approval, because it is immutable afterwards", () => {
    const result = decidePif("submitted", { decision: "approve", offerCategory: null });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/offer category/i);
  });

  it("rejects with a reason", () => {
    expect(decidePif("submitted", { decision: "reject", reason: "Duplicate of PIF-204" })).toEqual({
      ok: true,
      next: "rejected",
    });
  });

  it("refuses a rejection with no reason", () => {
    const result = decidePif("submitted", { decision: "reject", reason: " " });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/reason/i);
  });

  it("refuses to decide anything that is not awaiting approval", () => {
    const result = decidePif("draft", { decision: "approve", offerCategory: "regular" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/submitted/i);
  });

  it("never reopens a rejected PIF - rejection is permanent", () => {
    const result = decidePif("rejected", { decision: "approve", offerCategory: "regular" });
    expect(result.ok).toBe(false);
  });
});
