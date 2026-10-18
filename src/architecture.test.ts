import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Executable architecture rules — CLAUDE.md "the golden rule".
 *
 * These replace dependency-cruiser, which does not yet support TypeScript 7.
 * Being a test rather than a separate tool means the boundaries are enforced by
 * the same red/green loop as everything else.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out = out.concat(sourceFiles(full));
      continue;
    }
    if ([".ts", ".tsx"].includes(extname(entry)) && !entry.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
  let match = pattern.exec(source);
  while (match !== null) {
    if (match[1] !== undefined) specifiers.push(match[1]);
    match = pattern.exec(source);
  }
  return specifiers;
}

function filesUnder(subdir: string): string[] {
  try {
    return sourceFiles(join(SRC, subdir));
  } catch {
    return []; // Directory does not exist yet.
  }
}

/**
 * The opening tag of the `<button` found at `start`, or null when the file
 * runs out before the tag closes.
 *
 * Brace depth is tracked because `onClick={() => …}` holds a `>` that is the
 * end of an arrow, not the end of the tag.
 */
function buttonTag(source: string, start: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + "<button".length; i < source.length; i++) {
    const char = source[i] as string;
    if (quote !== null) {
      if (char === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") {
      if (depth === 0) return null;
      depth--;
    } else if (char === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

describe("src/domain is pure", () => {
  const domainFiles = filesUnder("domain");

  it("has domain files to check", () => {
    expect(domainFiles.length).toBeGreaterThan(0);
  });

  it.each(domainFiles.map((f) => relative(SRC, f)))(
    "%s imports nothing outside the domain",
    (relPath) => {
      const offenders = importsOf(join(SRC, relPath)).filter((spec) => {
        // Relative imports that stay inside src/domain are fine.
        if (spec.startsWith(".")) return spec.includes("../");
        // Node built-ins and every package are forbidden: the domain must be
        // pure logic with zero runtime dependencies.
        return true;
      });

      expect(
        offenders,
        `src/domain must not depend on React, Supabase, I/O or feature code. ` +
          `Found: ${offenders.join(", ")}`,
      ).toEqual([]);
    },
  );
});

describe("features are isolated", () => {
  const featureFiles = filesUnder("features");
  it.each(featureFiles.length > 0 ? featureFiles.map((f) => relative(SRC, f)) : ["(none yet)"])(
    "%s does not reach into a sibling feature",
    (relPath) => {
      if (relPath === "(none yet)") return;

      const owningFeature = relPath.split("/")[1];
      const offenders = importsOf(join(SRC, relPath)).filter((spec) => {
        const match = /^@features\/([^/]+)/.exec(spec);
        return match !== null && match[1] !== owningFeature;
      });

      expect(
        offenders,
        `Features must not import each other. Share via @domain or @components. ` +
          `Found: ${offenders.join(", ")}`,
      ).toEqual([]);
    },
  );
});

/**
 * A control that changes something must look like a control.
 *
 * Reported 2026-10-18 against the UAT deploy: "the button are still hyper
 * links". A dozen of them were hand-rolled `<button>`s wearing
 * `text-brand-600 hover:underline` — the exact drawing of a link — and staff
 * read "Save link", "Select all" and "Mark read" as pages to visit rather than
 * things to press, so they stopped pressing them.
 *
 * Navigation keeps its underline: a `<Link>` and an `<a>` to a document are
 * links, correctly. Only `<button>` is forbidden the styling.
 */
describe("an action never wears a link's clothes", () => {
  const screens = sourceFiles(SRC).filter((file) => extname(file) === ".tsx");

  it("has screens to check", () => {
    expect(screens.length).toBeGreaterThan(0);
  });

  it.each(screens.map((file) => relative(SRC, file)))("%s gives no button an underline", (rel) => {
    const source = readFileSync(join(SRC, rel), "utf8");
    const offenders: string[] = [];
    let at = source.indexOf("<button");
    while (at !== -1) {
      const tag = buttonTag(source, at);
      if (tag === null) break;
      if (tag.includes("underline")) {
        offenders.push(`line ${source.slice(0, at).split("\n").length}`);
      }
      at = source.indexOf("<button", at + 1);
    }

    expect(
      offenders,
      `A button is a control, not a link — use <Button> from @components/ui. ` +
        `Underlined at: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the shared Button's quiet variant a shaped control", () => {
    const ui = readFileSync(join(SRC, "components/ui.tsx"), "utf8");
    const ghost = /ghost:\s*"([^"]*)"/.exec(ui);
    if (ghost?.[1] === undefined) throw new Error("Button has no ghost variant to check");

    expect(ghost[1]).not.toMatch(/underline/);
    expect(ghost[1]).toMatch(/bg-/);
  });
});
