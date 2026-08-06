import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the student actually reads.
 *
 * Reported 2026-08-06 against the PIF: "the text part here which has a
 * description has the word `\u2014`, this should be removed."
 *
 * It is a real trap, not a typo. `"\u2014"` inside a JavaScript string is an
 * em dash; the SAME six characters as JSX TEXT are six characters, and React
 * renders them literally. Nothing flags it — it compiles, it type-checks, and
 * the only place it shows up is on the screen of whoever is using the form.
 *
 * So the rule is narrow and mechanical: an escape sequence may live in a
 * string literal, where it means what it says, and never in JSX text.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

function tsxFiles(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out = out.concat(tsxFiles(full));
      continue;
    }
    if (extname(entry) === ".tsx") out.push(full);
  }
  return out;
}

/**
 * Everything the compiler treats as a string, removed.
 *
 * A `\u2014` left standing after this is text between tags — the only place
 * the sequence survives to the screen.
 */
function withoutStringLiterals(line: string): string {
  return line
    .replaceAll(/"(?:[^"\\]|\\.)*"/g, '""')
    .replaceAll(/'(?:[^'\\]|\\.)*'/g, "''")
    .replaceAll(/`(?:[^`\\]|\\.)*`/g, "``");
}

const ESCAPE = /\\u[0-9a-fA-F]{4}/;

describe("user-facing copy", () => {
  const files = tsxFiles(SRC);

  it("has screens to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => relative(SRC, f)))(
    "%s renders no unicode escape as literal text",
    (relPath) => {
      const offenders = readFileSync(join(SRC, relPath), "utf8")
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => ESCAPE.test(withoutStringLiterals(line)))
        .map(({ line, number }) => `${number}: ${line.trim()}`);

      expect(
        offenders,
        "JSX text is not a string literal: React prints the escape sequence " +
          "verbatim. Type the character itself.\n" +
          offenders.join("\n"),
      ).toEqual([]);
    },
  );
});
