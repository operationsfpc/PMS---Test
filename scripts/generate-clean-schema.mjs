import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
const SEED_FILE = join(ROOT, "scripts/seed-complete-reference-data.sql");
const OUTPUT_SCHEMA = join(ROOT, "supabase/schema.sql");
const OUTPUT_FULL_SETUP = join(ROOT, "supabase/full-setup.sql");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort();

console.log(`Found ${files.length} migration files.`);

const lastMigration = files.length > 0 ? files[files.length - 1]?.slice(0, 4) : "0080";

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

writeFileSync(OUTPUT_SCHEMA, schemaSql, "utf8");
console.log(`Successfully generated schema file at: ${OUTPUT_SCHEMA}`);

let fullSetupSql = schemaSql;
fullSetupSql += `\n-- =============================================================================\n`;
fullSetupSql += `-- Master Reference Data & Seed Setup\n`;
fullSetupSql += `-- =============================================================================\n\n`;
fullSetupSql += readFileSync(SEED_FILE, "utf8");

writeFileSync(OUTPUT_FULL_SETUP, fullSetupSql, "utf8");
console.log(`Successfully generated full setup file at: ${OUTPUT_FULL_SETUP}`);
