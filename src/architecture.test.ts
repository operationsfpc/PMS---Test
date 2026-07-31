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
