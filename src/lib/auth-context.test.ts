import { isTestPreviewAllowed } from "@lib/auth-context";
import { describe, expect, it } from "vitest";

/**
 * This one rule decides three things: whether the header offers "Preview as",
 * whether a stored preview role is honoured, and whether `RoleGuard` lets the
 * previewed role through. It has to be wrong in the same direction everywhere.
 */
describe("who may preview a role", () => {
  it("refuses an account with no email at all", () => {
    expect(isTestPreviewAllowed(undefined)).toBe(false);
  });

  it("refuses an account whose email is blank", () => {
    expect(isTestPreviewAllowed("")).toBe(false);
    expect(isTestPreviewAllowed("   ")).toBe(false);
  });

  it("still allows the two accounts the override was written for", () => {
    expect(isTestPreviewAllowed("radhika@faceprep.in")).toBe(true);
    expect(isTestPreviewAllowed("thanush@faceprep.in")).toBe(true);
  });

  it("refuses everyone else, whatever the build mode", () => {
    expect(isTestPreviewAllowed("someone.else@faceprep.in")).toBe(false);
  });
});
