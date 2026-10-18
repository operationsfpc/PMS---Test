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
/**
 * Comments, gone — block and line, however many lines they span.
 *
 * Done over the whole file rather than line by line, because the last line of
 * a wrapped comment looks like ordinary code - it starts with a word rather
 * than with an asterisk, and a line-by-line filter waves it straight through.
 */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");
}

function withoutStringLiterals(line: string): string {
  return line
    .replaceAll(/"(?:[^"\\]|\\.)*"/g, '""')
    .replaceAll(/'(?:[^'\\]|\\.)*'/g, "''")
    .replaceAll(/`(?:[^`\\]|\\.)*`/g, "``");
}

const ESCAPE = /\\u[0-9a-fA-F]{4}/;

/**
 * Internal rule codes: R9, D10, F15, Q4, and section marks like 12.3.
 *
 * Reported 2026-08-17 against the placement overview: "the Package section
 * copy contains internal technical notation ((R9))". These codes are how the
 * PRD and this codebase talk to each other, and they are genuinely useful in
 * comments - which is why they belong there and nowhere near a screen. To a
 * coordinator, "at their placement record (R9)" is a reference to a document
 * they have never been given.
 */
const RULE_CODE = /\((?:[RDFQ]\d+|\u00a7[\d.]+)\)/;

const POINTS_AT_NAV = /under (?:<strong>|“)([^<”]+?)(?:<\/strong>|”)/g;

/**
 * Every group heading and item label the sidebar actually renders.
 *
 * Read out of the source rather than imported: this file runs on the text of
 * the screens, and a nav the test assembles by hand is a nav that can drift
 * from the one the app builds.
 */
function sidebarLabels(): string[] {
  const shell = readFileSync(join(SRC, "components", "app-shell.tsx"), "utf8");
  return [...shell.matchAll(/(?:heading|label): "([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("a refusal that sends the reader somewhere", () => {
  /**
   * UAT 2026-10-18: the shortlisting door told a reader to follow the drive
   * "under “My drives”", a sidebar label removed on 2026-08-18 when every
   * non-student was given one Drives group of three status tabs. The sentence
   * was polite, plausible and impossible to act on — the reader scanned the
   * sidebar for a word that was not there and had no second move.
   */
  it("names a group the sidebar really shows", () => {
    const nav = sidebarLabels();
    expect(nav.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      if (file.endsWith("app-shell.tsx")) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const match of line.matchAll(POINTS_AT_NAV)) {
            const phrase = (match[1] ?? "").trim();
            if (!nav.some((label) => label.toLowerCase() === phrase.toLowerCase())) {
              offenders.push(`${relative(SRC, file)}:${index + 1} — “${phrase}”`);
            }
          }
        });
    }

    expect(
      offenders,
      "No sidebar entry carries these labels, so the sentence offers a way out " +
        "that does not exist. Name a group the reader is actually given.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("leaves no link pointing at a page no sidebar can return to", () => {
    // `/my-drives` was reachable only from PIF-approval mail: follow the link,
    // click a drive, and there was no way back. A mail destination must be a
    // page the recipient's own sidebar shows, or the reader lands on a screen
    // the product no longer admits to having.
    const shell = readFileSync(join(SRC, "components", "app-shell.tsx"), "utf8");
    const navTargets = [...shell.matchAll(/to: "([^"]+)"/g)].map((m) => m[1] ?? "");
    const mail = readFileSync(join(SRC, "domain", "email-delivery.ts"), "utf8");
    const linkTargets = [...mail.matchAll(/portalUrl\}\/([a-z0-9/_-]+)/g)].map((m) => m[1] ?? "");

    const orphans = linkTargets.filter(
      (path) =>
        // Sign-in is the one screen deliberately outside every sidebar.
        path !== "login" && !navTargets.includes(`/${path}`),
    );

    expect(navTargets.length).toBeGreaterThan(0);
    expect(linkTargets.length).toBeGreaterThan(0);
    expect(orphans).toEqual([]);
  });
});

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

  it.each(files.map((f) => relative(SRC, f)))("%s shows no internal rule code", (relPath) => {
    // Comments are where these codes belong, so they go first.
    const offenders = withoutComments(readFileSync(join(SRC, relPath), "utf8"))
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => RULE_CODE.test(withoutStringLiterals(line)))
      .map(({ line, number }) => `${number}: ${line.trim()}`);

    expect(
      offenders,
      "R9, D10, \u00a712.3 and the like are internal shorthand. On a screen they " +
        "point at a document the reader has never seen. Say the thing instead.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
