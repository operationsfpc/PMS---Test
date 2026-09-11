import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
const OUTPUT_FILE = join(ROOT, "supabase/schema.sql");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort();

console.log(`Found ${files.length} migration files.`);

const lastMigration = files.length > 0 ? files[files.length - 1]?.slice(0, 4) : "0073";

let schemaSql = `-- =============================================================================
-- FACE Prep Campus — Placement Management System (PMS)
-- Complete Database Schema (Consolidated Migrations 0001 - ${lastMigration})
-- Generated automatically for Supabase execution.
-- =============================================================================

`;

for (const file of files) {
  const filePath = join(MIGRATIONS_DIR, file);
  const content = readFileSync(filePath, "utf8");
  schemaSql += `\n-- =============================================================================\n`;
  schemaSql += `-- Migration: ${file}\n`;
  schemaSql += `-- =============================================================================\n\n`;
  schemaSql += content.trim();
  schemaSql += `\n\n`;
}

writeFileSync(OUTPUT_FILE, schemaSql, "utf8");
console.log(`Successfully generated schema file at: ${OUTPUT_FILE}`);
