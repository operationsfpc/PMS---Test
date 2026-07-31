/**
 * Generates TypeScript types from the migrations by introspecting a real
 * PostgreSQL instance (PGlite). Equivalent to `supabase gen types typescript`
 * but needs no Docker and no network, so types can never drift from migrations.
 */
import { writeFileSync } from "node:fs";
import { createTestDb } from "../src/db/harness.ts";

const PG_TO_TS = {
  uuid: "string", text: "string", varchar: "string", bpchar: "string",
  int2: "number", int4: "number", int8: "number", numeric: "number",
  float4: "number", float8: "number", bool: "boolean",
  timestamptz: "string", timestamp: "string", date: "string",
  jsonb: "Json", json: "Json", _text: "string[]", _int4: "number[]",
};

const { sql } = await createTestDb();

const enums = await sql(`
  select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname order by 1`);

const columns = await sql(`
  select c.relname as table_name, a.attname as column_name,
         format_type(a.atttypid, null) as sql_type, t.typname as udt,
         a.attnotnull as not_null, (ad.adbin is not null) as has_default
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname, a.attnum`);

const enumNames = new Set(enums.map((e) => e.name));
const tsType = (udt) =>
  enumNames.has(udt) ? `Enums["${udt}"]` : (PG_TO_TS[udt] ?? "unknown");

const byTable = new Map();
for (const col of columns) {
  if (!byTable.has(col.table_name)) byTable.set(col.table_name, []);
  byTable.get(col.table_name).push(col);
}

let out = `/**
 * GENERATED FILE — do not edit.
 * Run \`pnpm db:types\` after changing anything in supabase/migrations.
 */

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Enums {
`;
for (const e of enums) {
  out += `  ${e.name}: ${e.labels.map((l) => `"${l}"`).join(" | ")};\n`;
}
out += "}\n\n";

for (const [table, cols] of [...byTable].sort()) {
  const pascal = table.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());
  out += `export interface ${pascal}Row {\n`;
  for (const c of cols) {
    out += `  ${c.column_name}: ${tsType(c.udt)}${c.not_null ? "" : " | null"};\n`;
  }
  out += "}\n\n";
  out += `export type ${pascal}Insert = `;
  const required = cols.filter((c) => c.not_null && !c.has_default).map((c) => c.column_name);
  const optional = cols.filter((c) => !(c.not_null && !c.has_default)).map((c) => c.column_name);
  out += required.length > 0 ? `Pick<${pascal}Row, ${required.map((r) => `"${r}"`).join(" | ")}>` : "{}";
  if (optional.length > 0) {
    out += ` & Partial<Pick<${pascal}Row, ${optional.map((o) => `"${o}"`).join(" | ")}>>`;
  }
  out += ";\n\n";
}

writeFileSync("src/db/database.types.ts", out);
console.log(`Generated ${byTable.size} tables and ${enums.length} enums.`);
