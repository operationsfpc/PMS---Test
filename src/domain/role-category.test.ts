import { describe, expect, it } from "vitest";
import { ROLE_CATEGORY_LABELS, roleCategoryLabel, roleCategoryStyle } from "./role-category";
import { ROLE_CATEGORIES } from "./types";

describe("role-category", () => {
  it("provides labels for all defined role categories", () => {
    for (const cat of ROLE_CATEGORIES) {
      expect(ROLE_CATEGORY_LABELS[cat]).toBeDefined();
      expect(roleCategoryLabel(cat)).toBe(ROLE_CATEGORY_LABELS[cat]);
    }
  });

  it("handles null or empty role category safely", () => {
    expect(roleCategoryLabel(null)).toBe("");
    expect(roleCategoryLabel(undefined)).toBe("");
    expect(roleCategoryStyle(null).bg).toBe("bg-slate-50");
  });

  it("provides distinct semantic pastel styles for categories", () => {
    const swStyle = roleCategoryStyle("software_technical");
    const salesStyle = roleCategoryStyle("sales");
    expect(swStyle.text).toContain("violet");
    expect(salesStyle.text).toContain("amber");
  });
});
