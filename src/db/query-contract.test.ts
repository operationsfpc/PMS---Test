import { DRIVE_COLUMNS, STUDENT_COLUMNS } from "@features/student/drives-view";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

/**
 * Every column a PostgREST select asks for must actually exist.
 *
 * The unit tests for these views hand the client a hand-written object, so a
 * select string can drift from the schema and stay green forever - the fake
 * simply returns whatever the test wrote. That gap shipped a real defect: a
 * migration dropped campuses.city while the query still asked for it, and the
 * whole suite passed. Vitest cannot catch it and neither can tsc, because the
 * select is an opaque string.
 *
 * So the string is parsed and checked against information_schema instead.
 */

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

interface Embed {
  readonly table: string;
  readonly spec: string;
}

/** Splits on commas that are not inside a nested embed. */
function splitTopLevel(spec: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of spec) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parse(spec: string): { columns: string[]; embeds: Embed[] } {
  const columns: string[] = [];
  const embeds: Embed[] = [];

  for (const part of splitTopLevel(spec)) {
    const embed = /^(\w+)\s*\(([\s\S]*)\)$/.exec(part);
    if (embed?.[1] !== undefined && embed[2] !== undefined) {
      embeds.push({ table: embed[1], spec: embed[2] });
    } else {
      columns.push(part);
    }
  }

  return { columns, embeds };
}

async function columnsOf(table: string): Promise<string[]> {
  const rows = await t.sql(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return rows.map((r) => String(r.column_name));
}

/** Walks a select spec, returning every "table.column" that does not exist. */
async function missingColumns(rootTable: string, spec: string): Promise<string[]> {
  const missing: string[] = [];
  const { columns, embeds } = parse(spec);

  const available = await columnsOf(rootTable);
  if (available.length === 0) {
    return [`${rootTable} (table does not exist)`];
  }
  for (const column of columns) {
    if (!available.includes(column)) missing.push(`${rootTable}.${column}`);
  }

  for (const embed of embeds) {
    missing.push(...(await missingColumns(embed.table, embed.spec)));
  }

  return missing;
}

describe("the student drives view asks only for columns that exist", () => {
  it("selects a real student shape", async () => {
    expect(await missingColumns("students", STUDENT_COLUMNS)).toEqual([]);
  });

  it("selects a real drive shape", async () => {
    expect(await missingColumns("drives", DRIVE_COLUMNS)).toEqual([]);
  });
});
