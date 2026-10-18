import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Rules about the stylesheet, which no component test can see.
 *
 * Tailwind v4 emits NOTHING for a colour name it does not know. It does not
 * warn, and the class stays in the markup looking intentional. So
 * `bg-warning/5` sat in ten screens for months and painted nothing: a student's
 * UNREAD notification was marked with a colour that did not exist, and read
 * exactly like a read one.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const THEME = readFileSync(join(SRC, "styles", "theme.css"), "utf8");

/**
 * Only names this project (or shadcn, which it borrows conventions from)
 * resolves through `--color-*`. Tailwind's own palette is deliberately left
 * alone: `bg-white` and `text-neutral-300` are real with no token behind them.
 */
const CUSTOM_NAMES = [
  "brand",
  "ink",
  "gold",
  "violet",
  "surface",
  "surface-muted",
  "line",
  "destructive",
  "warning",
  "accent",
  "foreground",
  "background",
  "primary",
  "secondary",
  "muted",
  "input",
  "popover",
  "card",
  "info",
] as const;

const UTILITIES = "text|bg|border|ring|fill|stroke|divide|outline|from|via|to|shadow";

function componentFiles(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out = out.concat(componentFiles(full));
      continue;
    }
    if (extname(entry) === ".tsx" && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

function isDefined(name: string): boolean {
  return new RegExp(`--color-${name}(?![\\w-])`).test(THEME);
}

function undefinedColourUses(): string[] {
  const offenders: string[] = [];

  for (const file of componentFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");

    lines.forEach((line, index) => {
      for (const name of CUSTOM_NAMES) {
        if (isDefined(name)) continue;
        // A bare use only: `bg-surface-muted` is its own token, and a step like
        // `brand-500` is answered by the ramp, not by `--color-brand`.
        const used = new RegExp(`(?:${UTILITIES})-${name}(?![-\\w])`);
        if (used.test(line)) {
          offenders.push(`${relative(SRC, file)}:${index + 1} — ${name}`);
        }
      }
    });
  }

  return offenders;
}

describe("the colour tokens the screens ask for", () => {
  it("are all defined in the theme", () => {
    // Read the other way round: every name below is a colour a component paints
    // with `undefined`, and the element simply never gets its colour.
    expect(undefinedColourUses()).toEqual([]);
  });

  it("include the warning and accent ramps the notices depend on", () => {
    for (const name of ["warning", "accent", "destructive"]) {
      expect(THEME).toContain(`--color-${name}:`);
    }
  });
});

describe("the pointer cursor", () => {
  /**
   * Tailwind v4's preflight sets `cursor: default` on every button, so a control
   * only looks pressable if something overrides that. Deciding this per call
   * site is how sixty buttons ended up showing an arrow over a working action.
   */
  it("comes from one base rule, not from a class on each button", () => {
    expect(THEME).toMatch(/button:not\(:disabled\)[\s\S]{0,400}?cursor:\s*pointer/);
  });
});
