import { describe, expect, it } from "vitest";
import {
  marksheetSlotKey,
  missingMarksheets,
  requiredMarksheets,
  semesterMarksheetKey,
} from "./marksheets";

/**
 * Which documents a declared academic record must be evidenced by.
 *
 * The SRF asked for these uploads and discarded them. Nothing was stored, so
 * the coordinator's verification queue - whose entire purpose is checking a
 * declared CGPA against the marksheet that proves it - had nothing to check
 * against. A queue that shows a number and no evidence is not verification;
 * it is a coordinator clicking Approve on a student's own typing.
 */

const sem = (...numbers: readonly number[]) =>
  numbers.map((semesterNumber) => ({ semesterNumber }));

describe("requiredMarksheets", () => {
  it("always requires the 10th and 12th marksheets", () => {
    const slots = requiredMarksheets({ programmeLevel: "ug", semesters: [] });

    expect(slots.map((s) => s.key)).toEqual(["tenth", "twelfth"]);
    expect(slots.map((s) => s.kind)).toEqual(["tenth_marksheet", "twelfth_marksheet"]);
  });

  it("requires one marksheet per declared semester, named by its number", () => {
    const slots = requiredMarksheets({ programmeLevel: "ug", semesters: sem(1, 2, 3) });

    expect(slots.map((s) => s.key)).toEqual([
      "tenth",
      "twelfth",
      "semester-1",
      "semester-2",
      "semester-3",
    ]);
    expect(slots.at(-1)).toEqual({
      key: "semester-3",
      kind: "semester_marksheet",
      label: "Semester 3 marksheet",
      semesterNumber: 3,
    });
  });

  it("orders semesters by number however they were declared", () => {
    const slots = requiredMarksheets({ programmeLevel: "ug", semesters: sem(3, 1, 2) });

    expect(slots.map((s) => s.semesterNumber)).toEqual([null, null, 1, 2, 3]);
  });

  it("asks for one marksheet per semester even if a number is declared twice", () => {
    // validateSemesters rejects the duplicate, but the upload list is rendered
    // while the form is still invalid. Two identical file inputs would race to
    // write the same semester's evidence.
    const slots = requiredMarksheets({ programmeLevel: "ug", semesters: sem(1, 1) });

    expect(slots.filter((s) => s.key === "semester-1")).toHaveLength(1);
  });

  it("also requires a consolidated UG marksheet from a postgraduate", () => {
    // A PG student declares one aggregate CGPA standing in for a whole degree
    // (0017). Unevidenced, it is the single largest unverifiable number on the
    // form. ASSUMPTION - UNCONFIRMED (A31).
    const slots = requiredMarksheets({ programmeLevel: "pg", semesters: sem(1) });

    expect(slots.map((s) => s.key)).toEqual(["tenth", "twelfth", "ug_consolidated", "semester-1"]);
    expect(slots[2]?.kind).toBe("ug_consolidated_marksheet");
  });

  it("never asks an undergraduate for a consolidated UG marksheet", () => {
    const slots = requiredMarksheets({ programmeLevel: "ug", semesters: sem(1, 2) });

    expect(slots.some((s) => s.key === "ug_consolidated")).toBe(false);
  });

  it("carries a semester number only on semester marksheets", () => {
    const slots = requiredMarksheets({ programmeLevel: "pg", semesters: sem(2) });

    expect(slots.filter((s) => s.semesterNumber !== null).map((s) => s.kind)).toEqual([
      "semester_marksheet",
    ]);
  });
});

describe("missingMarksheets", () => {
  const academics = { programmeLevel: "ug", semesters: sem(1, 2) } as const;

  it("reports every required document that has not been provided", () => {
    expect(missingMarksheets(academics, ["tenth", "semester-1"]).map((s) => s.key)).toEqual([
      "twelfth",
      "semester-2",
    ]);
  });

  it("is empty once every required document is provided", () => {
    expect(missingMarksheets(academics, ["tenth", "twelfth", "semester-1", "semester-2"])).toEqual(
      [],
    );
  });

  it("does not let an unrelated document satisfy a requirement", () => {
    // A student who uploaded semester 5, then deleted that semester line, has
    // still not evidenced semesters 1 and 2.
    expect(missingMarksheets(academics, ["semester-5"]).map((s) => s.key)).toEqual([
      "tenth",
      "twelfth",
      "semester-1",
      "semester-2",
    ]);
  });

  it("reports the label, so the form can name what is missing", () => {
    expect(missingMarksheets(academics, []).map((s) => s.label)).toEqual([
      "10th marksheet",
      "12th marksheet",
      "Semester 1 marksheet",
      "Semester 2 marksheet",
    ]);
  });
});

describe("keys", () => {
  it("derives a semester's key from its number", () => {
    expect(semesterMarksheetKey(4)).toBe("semester-4");
  });

  it("keys a slot the same way whichever route it was built by", () => {
    const slot = requiredMarksheets({ programmeLevel: "ug", semesters: sem(4) }).at(-1);

    expect(slot?.key).toBe(semesterMarksheetKey(4));
    expect(marksheetSlotKey({ kind: "semester_marksheet", semesterNumber: 4 })).toBe("semester-4");
  });

  it("keys the non-semester kinds without a number", () => {
    expect(marksheetSlotKey({ kind: "tenth_marksheet", semesterNumber: null })).toBe("tenth");
    expect(marksheetSlotKey({ kind: "twelfth_marksheet", semesterNumber: null })).toBe("twelfth");
    expect(marksheetSlotKey({ kind: "ug_consolidated_marksheet", semesterNumber: null })).toBe(
      "ug_consolidated",
    );
  });
});

/**
 * Diploma, added 2026-08-06: "after 10th and 12th marks, there should be an
 * option to add diploma marks … diploma marks and college name is optional.
 * marks + marksheet upload field (both optional)".
 *
 * Optional to DECLARE, not optional to evidence. The moment a student puts a
 * diploma figure on the form it is a mark a coordinator has to verify, and an
 * unverifiable mark is the exact defect this whole area exists to prevent.
 */
describe("diploma marks", () => {
  const ug = { programmeLevel: "ug" as const, semesters: [{ semesterNumber: 1 }] };

  it("asks for no diploma marksheet when no diploma marks were declared", () => {
    const slots = requiredMarksheets({ ...ug, hasDiplomaMarks: false });

    expect(slots.some((s) => s.key === "diploma")).toBe(false);
  });

  it("requires the marksheet once diploma marks are declared", () => {
    const slots = requiredMarksheets({ ...ug, hasDiplomaMarks: true });

    expect(slots.map((s) => s.key)).toEqual(["tenth", "twelfth", "diploma", "semester-1"]);
    expect(slots.find((s) => s.key === "diploma")).toEqual({
      key: "diploma",
      kind: "diploma_marksheet",
      label: "Diploma marksheet",
      semesterNumber: null,
    });
  });

  it("places the diploma after school and before the degree, as the form does", () => {
    const slots = requiredMarksheets({
      programmeLevel: "pg",
      semesters: [{ semesterNumber: 1 }],
      hasDiplomaMarks: true,
    });

    expect(slots.map((s) => s.key)).toEqual([
      "tenth",
      "twelfth",
      "diploma",
      "ug_consolidated",
      "semester-1",
    ]);
  });

  it("treats an absent flag as no diploma, so existing callers are unaffected", () => {
    expect(requiredMarksheets(ug).some((s) => s.key === "diploma")).toBe(false);
  });

  it("reports a missing diploma marksheet by name", () => {
    expect(
      missingMarksheets({ ...ug, hasDiplomaMarks: true }, ["tenth", "twelfth", "semester-1"]).map(
        (s) => s.label,
      ),
    ).toEqual(["Diploma marksheet"]);
  });

  it("keys it the same way whichever route built it", () => {
    expect(marksheetSlotKey({ kind: "diploma_marksheet", semesterNumber: null })).toBe("diploma");
  });
});
