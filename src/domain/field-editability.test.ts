import { describe, expect, it } from "vitest";
import { type EditableField, fieldEditability } from "./field-editability";

/**
 * R10 — decision Q4. There is NO Admin-unlock workflow.
 * Coordinators edit verified academic data directly and instantly (audit-logged).
 * Students may never touch verified academic data.
 */
describe("fieldEditability", () => {
  const freeForStudent: EditableField[] = [
    "areas_of_interest",
    "areas_of_expertise",
    "certifications",
    "projects",
    "technical_skills",
    "achievements",
    "resumes",
    "professional_links",
  ];

  const verifiedAcademic: EditableField[] = [
    "tenth_marks",
    "twelfth_marks",
    "degree",
    "branch",
    "verified_semester_data",
  ];

  describe("students", () => {
    it.each(freeForStudent)("may freely edit %s", (field) => {
      expect(fieldEditability(field, "student")).toBe("free");
    });

    it.each(verifiedAcademic)("may never edit verified academic field %s", (field) => {
      expect(fieldEditability(field, "student")).toBe("denied");
    });

    it("must submit new semester data for CPC verification against the marksheet", () => {
      expect(fieldEditability("new_semester_data", "student")).toBe("requires_cpc_verification");
    });
  });

  describe("coordinators", () => {
    it.each(["campus_placement_coordinator", "central_placement_coordinator"] as const)(
      "%s edits verified academic data directly, with no approval step",
      (role) => {
        for (const field of verifiedAcademic) {
          expect(fieldEditability(field, role)).toBe("free");
        }
      },
    );

    it("lets a coordinator enter new semester data without a second verification", () => {
      expect(fieldEditability("new_semester_data", "central_placement_coordinator")).toBe("free");
    });
  });

  describe("everyone else", () => {
    it.each(["account_executive", "delivery_head", "er_head", "ceo"] as const)(
      "denies %s any profile edit",
      (role) => {
        expect(fieldEditability("tenth_marks", role)).toBe("denied");
        expect(fieldEditability("projects", role)).toBe("denied");
      },
    );

    it("gives admin free rein", () => {
      expect(fieldEditability("tenth_marks", "admin")).toBe("free");
    });
  });
});
