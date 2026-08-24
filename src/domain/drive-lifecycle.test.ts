import { describe, expect, it } from "vitest";
import {
  canGoLive,
  DRIVE_TAB_STATUSES,
  type DriveReadiness,
  decidePif,
  missingBeforeGoLive,
} from "./drive-lifecycle";
import { DRIVE_STATUSES, type DriveStatus } from "./types";

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
  hasJobDescriptionFile: false,
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
    [
      "jobDescription file only counts when present",
      { jobDescription: "", hasJobDescriptionFile: false },
    ],
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

  /**
   * J1 (2026-08-18, answer 2): the recruiter's own JD PDF is the document of
   * record and the typed text is optional. A drive whose JD arrived as an
   * attachment must not be refused publication for leaving the text blank —
   * that is exactly the Infosys drive of 2026-08-24, attached and viewable
   * yet "Missing: Job description" with no way to fix it on the publish form.
   */
  it("accepts an attached JD PDF in place of typed text", () => {
    const result = missingBeforeGoLive({
      ...ready,
      jobDescription: "",
      hasJobDescriptionFile: true,
    });
    expect(result).toEqual([]);
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

/**
 * Coverage of the two fields nothing exercised: a drive that reaches the
 * Central CPC without a role category or a drive type. Both are settable by
 * more than one role (Q1), which is exactly why neither can be assumed set.
 */
describe("missingBeforeGoLive names every unset field", () => {
  it("names the role category when it was never chosen", () => {
    const missing = missingBeforeGoLive({
      companyName: "Zoho",
      roleTitle: "MTS",
      roleCategory: null,
      jobDescription: "Build things",
      hasJobDescriptionFile: false,
      locations: ["Chennai"],
      ctcMinLpa: 6,
      driveType: "placement",
      offerCategory: "dream",
      hasEligibilityCriteria: true,
      roundCount: 2,
      applicationStart: "2026-01-01T00:00:00Z",
      applicationEnd: "2026-01-10T00:00:00Z",
      onHold: false,
    });

    expect(missing).toContain("Role category");
  });

  it("names the drive type when it was never chosen", () => {
    const missing = missingBeforeGoLive({
      companyName: "Zoho",
      roleTitle: "MTS",
      roleCategory: "software_technical",
      jobDescription: "Build things",
      hasJobDescriptionFile: false,
      locations: ["Chennai"],
      ctcMinLpa: 6,
      driveType: null,
      offerCategory: "dream",
      hasEligibilityCriteria: true,
      roundCount: 2,
      applicationStart: "2026-01-01T00:00:00Z",
      applicationEnd: "2026-01-10T00:00:00Z",
      onHold: false,
    });

    expect(missing).toContain("Drive type");
  });
});

/**
 * The three tabs the Central CPC works from (2026-08-18, Karthik):
 * "approved = yet to publish; published - page name can be live; completed.
 * drafts can be removed."
 *
 * One vocabulary for all three, because a status that belongs to no tab is a
 * drive nobody can find, and a status in two tabs is a drive counted twice.
 */
describe("DRIVE_TAB_STATUSES", () => {
  it("puts an approved drive - and only an approved drive - in Yet to publish", () => {
    expect(DRIVE_TAB_STATUSES["yet-to-publish"]).toEqual(["approved"]);
  });

  it("calls the published page Live, and holds every drive that is out there", () => {
    expect(DRIVE_TAB_STATUSES.live).toEqual(["live", "applications_closed", "in_rounds"]);
  });

  it("gives completed its own tab", () => {
    expect(DRIVE_TAB_STATUSES.completed).toEqual(["completed"]);
  });

  it("never shows the same drive under two tabs", () => {
    const all = Object.values(DRIVE_TAB_STATUSES).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  /**
   * ⚠️ A39. `draft` was removed as asked; `submitted` and `rejected` follow
   * from 0047 - raising is the AE's and approving is the Delivery Head's, so a
   * drive neither has finished with is not the Central CPC's to see. This test
   * exists so reversing that is one deliberate edit, not an accident.
   */
  it("deliberately shows the Central CPC no draft, submitted or rejected drive", () => {
    const shown = Object.values(DRIVE_TAB_STATUSES).flat();
    expect(shown).not.toContain("draft");
    expect(shown).not.toContain("submitted");
    expect(shown).not.toContain("rejected");
  });

  it("accounts for every drive status exactly once, shown or deliberately not", () => {
    const shown = Object.values(DRIVE_TAB_STATUSES).flat();
    const hidden: readonly DriveStatus[] = ["draft", "submitted", "rejected"];
    expect([...shown, ...hidden].sort()).toEqual([...DRIVE_STATUSES].sort());
  });
});
