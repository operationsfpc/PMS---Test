import { describe, expect, it } from "vitest";
import { parseRoster, ROSTER_COLUMNS } from "./roster-import";

/**
 * Roster import (PRD §3).
 *
 * The format is `public/templates/student-roster-template.xlsx`, confirmed as
 * canonical on 2026-08-02.
 *
 * A roster is the ONLY way a student can ever sign in - migration 0009 refuses
 * any address not on it. A silently dropped row is therefore a student locked
 * out of placements, so every rejection is reported with its row number rather
 * than skipped.
 */
const header = [...ROSTER_COLUMNS];
const row = ["TEC001", "Asha Ramanathan", "asha@example.com", "B.E", "CSE", "2027"];

describe("parseRoster", () => {
  it("accepts a well-formed roster", () => {
    const result = parseRoster([header, row]);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toMatchObject({
      rollNumber: "TEC001",
      fullName: "Asha Ramanathan",
      email: "asha@example.com",
      passingYear: 2027,
    });
  });

  it("rejects a file whose columns do not match the template", () => {
    const result = parseRoster([
      ["roll", "name"],
      ["x", "y"],
    ]);
    expect(result.fatal).toMatch(/column/i);
    expect(result.accepted).toEqual([]);
  });

  it("reports an empty file rather than silently importing nothing", () => {
    expect(parseRoster([]).fatal).toMatch(/empty/i);
  });

  it("normalises the email, because login matches on it exactly", () => {
    const result = parseRoster([
      header,
      [...row.slice(0, 2), "  ASHA@Example.COM ", ...row.slice(3)],
    ]);
    expect(result.accepted[0]?.email).toBe("asha@example.com");
  });

  it("rejects a row with no email, naming the row", () => {
    const result = parseRoster([header, [...row.slice(0, 2), "", ...row.slice(3)]]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.row).toBe(2);
    expect(result.rejected[0]?.reason).toMatch(/email/i);
  });

  /**
   * A row missing any of these is a student who can never be imported, and so
   * can never sign in. Each is reported with its row number rather than
   * skipped - a silently dropped row is a student locked out of placements.
   */
  it("rejects a row with no roll number", () => {
    const result = parseRoster([header, ["", ...row.slice(1)]]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/roll number/i);
  });

  it("rejects a row with no name", () => {
    const result = parseRoster([header, [row[0] ?? "", "", ...row.slice(2)]]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/name/i);
  });

  it("rejects a row with no degree", () => {
    const result = parseRoster([header, [...row.slice(0, 3), "", ...row.slice(4)]]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/degree/i);
  });

  it("rejects a malformed email", () => {
    const result = parseRoster([header, [...row.slice(0, 2), "not-an-email", ...row.slice(3)]]);
    expect(result.rejected[0]?.reason).toMatch(/email/i);
  });

  it("rejects a non-numeric passing year", () => {
    const result = parseRoster([header, [...row.slice(0, 5), "next year"]]);
    expect(result.rejected[0]?.reason).toMatch(/passing year/i);
  });

  it("rejects a duplicate email within the same file, keeping the first", () => {
    const result = parseRoster([header, row, row]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]?.row).toBe(3);
    expect(result.rejected[0]?.reason).toMatch(/duplicate/i);
  });

  it("rejects a duplicate roll number within the same file", () => {
    const other = ["TEC001", "Other Person", "other@example.com", "B.E", "CSE", "2027"];
    const result = parseRoster([header, row, other]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/roll number/i);
  });

  it("ignores entirely blank rows, which spreadsheets are full of", () => {
    const result = parseRoster([header, row, ["", "", "", "", "", ""]]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it("keeps good rows when a bad one sits between them", () => {
    const good2 = ["TEC002", "Bala", "bala@example.com", "B.E", "CSE", "2027"];
    const result = parseRoster([
      header,
      row,
      ["TEC003", "Broken", "", "B.E", "CSE", "2027"],
      good2,
    ]);

    expect(result.accepted.map((s) => s.rollNumber)).toEqual(["TEC001", "TEC002"]);
    expect(result.rejected).toHaveLength(1);
  });
});

/**
 * Real spreadsheets are ragged: a row that ends early has no cells at all
 * beyond its last value, and an exported file can carry holes. Neither may
 * throw - the importer's whole job is to explain bad input, not die on it.
 */
describe("ragged files", () => {
  it("treats missing trailing cells as blank rather than crashing", () => {
    const result = parseRoster([header, ["TEC001"]]);

    expect(result.fatal).toBeNull();
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/name/i);
  });

  it("skips a row that is entirely holes", () => {
    const holes: string[] = [];
    holes.length = 6;

    const result = parseRoster([header, holes]);

    expect(result.fatal).toBeNull();
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("survives a missing row entirely", () => {
    const rows: (readonly string[])[] = [header];
    rows.length = 3;

    const result = parseRoster(rows);

    expect(result.fatal).toBeNull();
    expect(result.accepted).toEqual([]);
  });
});

/**
 * 0040: one email identifies one person.
 *
 * A file of 200 students that clashes on one row must say WHICH row. The
 * database refuses the whole batch, so without this the administrator gets a
 * single failure for a file they cannot see the fault in - and the fault is
 * usually a colleague who is also on the roster, which is what caused P8.
 */
describe("addresses already claimed elsewhere", () => {
  const header = ROSTER_COLUMNS.join(",");
  const row = (email: string) => `R1,Asha,${email},B.E,CSE,2027`;

  it("rejects a student whose address belongs to a staff account, naming it", () => {
    const result = parseRoster(
      [ROSTER_COLUMNS as unknown as string[], row("sainaveen@faceprep.in").split(",")],
      new Map([["sainaveen@faceprep.in", "staff"]]),
    );

    expect(result.rejected).toEqual([
      {
        row: 2,
        reason:
          "sainaveen@faceprep.in is already a staff account. One person is either a student or staff, never both — use a different address.",
      },
    ]);
    expect(result.accepted).toEqual([]);
  });

  it("rejects a student already on the roster", () => {
    const result = parseRoster(
      [ROSTER_COLUMNS as unknown as string[], row("priya@gmail.com").split(",")],
      new Map([["priya@gmail.com", "student"]]),
    );

    expect(result.rejected[0]?.reason).toBe("priya@gmail.com is already on the student roster.");
  });

  it("catches a clash that differs only by case", () => {
    const result = parseRoster(
      [ROSTER_COLUMNS as unknown as string[], row("SaiNaveen@FacePrep.in").split(",")],
      new Map([["sainaveen@faceprep.in", "staff"]]),
    );

    expect(result.rejected[0]?.reason).toContain("already a staff account");
  });

  it("accepts everyone when nothing is claimed, and needs no map at all", () => {
    expect(header).toContain("roll_number");
    const result = parseRoster([
      ROSTER_COLUMNS as unknown as string[],
      row("brand.new@gmail.com").split(","),
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });
});
