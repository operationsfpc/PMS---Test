import { describe, expect, it } from "vitest";
import { parseCsv, serialiseCsv } from "./csv";

/**
 * A small RFC 4180 reader, so importing a roster needs no dependency.
 *
 * College exports are messy: quoted names containing commas, Windows line
 * endings, a trailing newline, a UTF-8 BOM from Excel. Each of those silently
 * corrupts a naive `split(",")`, and a corrupted roster row is a student who
 * cannot sign in.
 */
describe("parseCsv", () => {
  it("reads a simple grid", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('name,city\n"Ramanathan, Asha",Chennai')).toEqual([
      ["name", "city"],
      ["Ramanathan, Asha", "Chennai"],
    ]);
  });

  it("understands a doubled quote as a literal quote", () => {
    expect(parseCsv('a\n"She said ""hi"""')).toEqual([["a"], ['She said "hi"']]);
  });

  it("handles Windows line endings", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([["a"], ["line one\nline two"]]);
  });

  it("strips the BOM Excel puts at the start of a file", () => {
    expect(parseCsv("\uFEFFroll_number,name\n1,Asha")[0]).toEqual(["roll_number", "name"]);
  });

  it("ignores a trailing newline rather than inventing a blank row", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });

  it("preserves genuinely empty fields", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   ")).toEqual([]);
  });
});

/** WS8 (2026-08-12): the shortlist leaves the building as a CSV Excel opens. */
describe("serialiseCsv", () => {
  it("writes a header row and one line per record", () => {
    expect(
      serialiseCsv(
        ["Name", "CGPA"],
        [
          { Name: "Priya", CGPA: 8.4 },
          { Name: "Arjun", CGPA: 7.1 },
        ],
      ),
    ).toBe("Name,CGPA\r\nPriya,8.4\r\nArjun,7.1");
  });

  it("quotes fields containing commas, quotes or newlines", () => {
    expect(serialiseCsv(["A"], [{ A: 'say "hi", twice' }])).toBe('A\r\n"say ""hi"", twice"');
    expect(serialiseCsv(["A"], [{ A: "two\nlines" }])).toBe('A\r\n"two\nlines"');
  });

  it("writes a blank for a missing value, never the string undefined", () => {
    expect(serialiseCsv(["A", "B"], [{ A: "x" }])).toBe("A,B\r\nx,");
  });

  it("round-trips through our own parser", () => {
    const csv = serialiseCsv(["A", "B"], [{ A: 'quote " comma ,', B: "plain" }]);
    expect(parseCsv(csv)).toEqual([
      ["A", "B"],
      ['quote " comma ,', "plain"],
    ]);
  });
});
