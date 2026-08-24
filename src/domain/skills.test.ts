import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKILL_AREAS,
  joinMandatorySkills,
  normaliseSkillAreaName,
  parseSkillScore,
  parseSkillSheet,
  SKILL_AREA_NAME_MAX,
  SKILL_SCORE_MAX,
  SKILL_SCORE_MIN,
  skillAreaKey,
  splitMandatorySkills,
  validateSkillAreaName,
} from "./skills";

/**
 * PRD §5 — the Central Student Skill Repository.
 *
 * Institutional scores per student (aptitude, communication, coding, …),
 * maintained by the Central CPC, later fed into R11's shortlisting. The rules
 * here decide what counts as a valid area, a valid score, and a valid bulk
 * upload — getting any of them wrong feeds a wrong number into shortlisting.
 */

describe("DEFAULT_SKILL_AREAS", () => {
  it("carries the areas asked for on 2026-08-06", () => {
    expect(DEFAULT_SKILL_AREAS).toEqual([
      "Aptitude",
      "Communication skills",
      "Fundamentals of Programming",
      "Data Structures and Algorithms",
      "GitHub strength",
      "Programming skills",
      "AI skills",
      "AI-assisted Full Stack Development",
    ]);
  });

  it("contains no duplicates under the uniqueness key", () => {
    const keys = DEFAULT_SKILL_AREAS.map(skillAreaKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("normaliseSkillAreaName", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normaliseSkillAreaName("  AI   skills  ")).toBe("AI skills");
  });
});

describe("skillAreaKey", () => {
  it("is case- and spacing-insensitive", () => {
    expect(skillAreaKey("  ai   Skills ")).toBe(skillAreaKey("AI skills"));
  });
});

describe("validateSkillAreaName", () => {
  const existing = ["Aptitude", "AI skills"];

  it("accepts a new, distinct name", () => {
    expect(validateSkillAreaName("Cloud fundamentals", existing)).toBeNull();
  });

  it("refuses an empty name", () => {
    expect(validateSkillAreaName("   ", existing)).toBe("Give the skill area a name.");
  });

  it("refuses a name longer than the cap", () => {
    expect(validateSkillAreaName("x".repeat(SKILL_AREA_NAME_MAX + 1), existing)).toBe(
      `Keep the name to ${SKILL_AREA_NAME_MAX} characters or fewer.`,
    );
  });

  it("accepts a name exactly at the cap", () => {
    expect(validateSkillAreaName("x".repeat(SKILL_AREA_NAME_MAX), existing)).toBeNull();
  });

  it("refuses a duplicate, however it is cased or spaced", () => {
    expect(validateSkillAreaName("  ai   SKILLS ", existing)).toBe(
      '"AI skills" already exists — edit the scores under it instead.',
    );
  });
});

describe("parseSkillScore", () => {
  it("accepts an integer in range", () => {
    expect(parseSkillScore("4")).toEqual({ ok: true, score: 4 });
  });

  it("accepts up to two decimals and surrounding whitespace", () => {
    expect(parseSkillScore(" 3 ")).toEqual({ ok: true, score: 3 });
  });

  it("accepts both ends of the range", () => {
    expect(parseSkillScore(String(SKILL_SCORE_MIN))).toEqual({ ok: true, score: SKILL_SCORE_MIN });
    expect(parseSkillScore(String(SKILL_SCORE_MAX))).toEqual({ ok: true, score: SKILL_SCORE_MAX });
  });

  it("refuses a blank", () => {
    expect(parseSkillScore("  ")).toEqual({ ok: false, reason: "Enter a score." });
  });

  it("refuses a non-number", () => {
    expect(parseSkillScore("good")).toEqual({ ok: false, reason: '"good" is not a number.' });
  });

  it("refuses a score outside 1–5, naming the range (Karthik 2026-08-19: '1-5 SCALE')", () => {
    const reason = `A score is between ${SKILL_SCORE_MIN} and ${SKILL_SCORE_MAX}.`;
    expect(parseSkillScore("6")).toEqual({ ok: false, reason });
    expect(parseSkillScore("0")).toEqual({ ok: false, reason });
    // The old 0–100 world: a coordinator pasting last term's sheet must be told.
    expect(parseSkillScore("85")).toEqual({ ok: false, reason });
  });

  it("refuses fractions rather than silently rounding — the 5-point scale is whole numbers", () => {
    expect(parseSkillScore("3.5")).toEqual({
      ok: false,
      reason: "Whole numbers only on the 1–5 scale.",
    });
  });
});

describe("parseSkillSheet", () => {
  const areas = ["Aptitude", "AI skills"];
  const header = ["roll_number", "Aptitude", "AI skills"];

  it("reports an empty file as fatal", () => {
    const result = parseSkillSheet([], areas);
    expect(result.fatal).toBe("The file is empty.");
    expect(result.accepted).toEqual([]);
  });

  it("requires the first column to be roll_number", () => {
    const result = parseSkillSheet([["student", "Aptitude"]], areas);
    expect(result.fatal).toBe('The first column must be "roll_number".');
  });

  it("requires at least one skill column", () => {
    const result = parseSkillSheet([["roll_number"]], areas);
    expect(result.fatal).toBe("Add at least one skill column after roll_number.");
  });

  it("refuses a column that is not a known skill area", () => {
    const result = parseSkillSheet([["roll_number", "Aptitude", "Juggling"]], areas);
    expect(result.fatal).toBe(
      'Column "Juggling" is not a skill area. Add it as a skill area first, then import.',
    );
  });

  it("refuses the same skill column twice", () => {
    const result = parseSkillSheet([["roll_number", "Aptitude", "aptitude"]], areas);
    expect(result.fatal).toBe('Column "aptitude" appears more than once.');
  });

  it("accepts rows and canonicalises the area names to the known spelling", () => {
    const result = parseSkillSheet(
      [
        ["roll_number", "  APTITUDE ", "ai   skills"],
        ["21CSE1042", "4", "3"],
      ],
      areas,
    );
    expect(result.fatal).toBeNull();
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual([
      {
        row: 2,
        rollNumber: "21CSE1042",
        scores: [
          { area: "Aptitude", score: 4 },
          { area: "AI skills", score: 3 },
        ],
      },
    ]);
  });

  it("skips a blank cell rather than treating it as zero", () => {
    const result = parseSkillSheet([header, ["21CSE1042", "", "2"]], areas);
    expect(result.accepted).toEqual([
      { row: 2, rollNumber: "21CSE1042", scores: [{ area: "AI skills", score: 2 }] },
    ]);
  });

  it("skips fully blank rows without rejecting them", () => {
    const result = parseSkillSheet([header, ["", "", ""], ["21CSE1042", "5", "2"]], areas);
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it("rejects a row with no roll number, naming the spreadsheet row", () => {
    const result = parseSkillSheet([header, ["", "4", "2"]], areas);
    expect(result.rejected).toEqual([{ row: 2, reason: "Roll number is missing." }]);
  });

  it("rejects a duplicate roll number", () => {
    const result = parseSkillSheet(
      [header, ["21CSE1042", "4", "2"], ["21CSE1042", "3", "2"]],
      areas,
    );
    expect(result.rejected).toEqual([
      { row: 3, reason: 'Duplicate roll number "21CSE1042" — an earlier row already claims it.' },
    ]);
    expect(result.accepted).toHaveLength(1);
  });

  it("rejects a bad score, naming the column it sits in", () => {
    const result = parseSkillSheet([header, ["21CSE1042", "excellent", "2"]], areas);
    expect(result.rejected).toEqual([{ row: 2, reason: 'Aptitude: "excellent" is not a number.' }]);
    expect(result.accepted).toEqual([]);
  });

  it("rejects a row whose every score cell is blank — nothing to import", () => {
    const result = parseSkillSheet([header, ["21CSE1042", "", ""]], areas);
    expect(result.rejected).toEqual([{ row: 2, reason: "Every score cell on this row is blank." }]);
  });

  // Real spreadsheets arrive ragged: short rows, holes, empty header cells.
  it("treats an empty header row as a missing roll_number column", () => {
    expect(parseSkillSheet([[]], areas).fatal).toBe('The first column must be "roll_number".');
  });

  it("refuses a blank header cell — it is not a skill area", () => {
    const holed: string[] = ["roll_number"];
    holed[2] = "Aptitude"; // hole at index 1
    const result = parseSkillSheet([holed], areas);
    expect(result.fatal).toBe(
      'Column "" is not a skill area. Add it as a skill area first, then import.',
    );
  });

  it("skips a hole in the row list, as it does a blank row", () => {
    const rows: string[][] = [
      ["roll_number", "Aptitude"],
      ["21CSE1042", "5"],
    ];
    rows[3] = ["21CSE9001", "2"]; // hole at index 2
    const result = parseSkillSheet(rows, areas);
    expect(result.rejected).toEqual([]);
    expect(result.accepted.map((r) => r.rollNumber)).toEqual(["21CSE1042", "21CSE9001"]);
  });

  it("reads a hole in the roll cell as a missing roll number", () => {
    const row: string[] = [];
    row[1] = "5"; // hole at index 0
    const result = parseSkillSheet([["roll_number", "Aptitude"], row], areas);
    expect(result.rejected).toEqual([{ row: 2, reason: "Roll number is missing." }]);
  });

  it("treats a row shorter than the header as blank cells, not as an error", () => {
    const result = parseSkillSheet([header, ["21CSE1042"]], areas);
    expect(result.rejected).toEqual([{ row: 2, reason: "Every score cell on this row is blank." }]);
  });

  it("counts the header when numbering rows, matching what the spreadsheet shows", () => {
    const result = parseSkillSheet([header, ["21CSE1042", "4", "2"], ["", "1", "2"]], areas);
    expect(result.rejected).toEqual([{ row: 3, reason: "Roll number is missing." }]);
  });
});

/**
 * The PIF's mandatory-skills picker (spec 2026-08-21 part A, approved
 * 2026-08-24). The AE picks from the assessed-skills catalogue; anything
 * outside it is an explicit "other". Storage stays the comma-joined text
 * everything downstream already reads, so the two directions must round-trip.
 */
describe("splitMandatorySkills", () => {
  const catalogue = ["Aptitude", "Communication skills", "AI skills"];

  it("re-ticks catalogue names case-insensitively and keeps the rest as other", () => {
    expect(splitMandatorySkills("aptitude, Coding, AI  skills", catalogue)).toEqual({
      catalogue: ["Aptitude", "AI skills"],
      other: ["Coding"],
    });
  });

  it("returns nothing for blank storage", () => {
    expect(splitMandatorySkills("", catalogue)).toEqual({ catalogue: [], other: [] });
    expect(splitMandatorySkills("  ", catalogue)).toEqual({ catalogue: [], other: [] });
  });

  it("drops duplicates instead of listing a skill twice", () => {
    expect(splitMandatorySkills("Aptitude, aptitude, Coding, coding", catalogue)).toEqual({
      catalogue: ["Aptitude"],
      other: ["Coding"],
    });
  });
});

describe("joinMandatorySkills", () => {
  const catalogue = ["Aptitude", "Communication skills"];

  it("joins picked and other skills into the stored text", () => {
    expect(joinMandatorySkills(["Aptitude"], ["Testing"], catalogue)).toBe("Aptitude, Testing");
  });

  it("folds an other that names a catalogue skill into the catalogue side", () => {
    expect(joinMandatorySkills([], ["aptitude"], catalogue)).toBe("Aptitude");
  });

  it("ignores blanks and duplicates", () => {
    expect(
      joinMandatorySkills(["Aptitude", "Aptitude"], ["", "  ", "Testing", "testing"], catalogue),
    ).toBe("Aptitude, Testing");
  });

  it("returns an empty string when nothing is picked", () => {
    expect(joinMandatorySkills([], [], catalogue)).toBe("");
  });
});
