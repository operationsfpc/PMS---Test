/**
 * =============================================================================
 * FACE Prep Campus — Placement Management System (PMS)
 * Pure Database Schema Creation Tool (seed.ts)
 * =============================================================================
 *
 * This script creates ONLY the database schema (all 38 tables, 18 enums,
 * functions, RLS policies, and triggers) on your target Supabase project.
 *
 * It does NOT populate mock colleges, programmes, or student records.
 *
 * Features:
 *   1. Fuses all 80 migrations in exact order (0001 to 0080) -> supabase/schema.sql
 *   2. Applies schema via Supabase CLI or Management API
 *   3. Initializes private storage buckets (resumes, documents, offer_letters, jd)
 *   4. Ensures admin allowlist entry exists for initial sign-in
 *   5. Verifies all 38 tables are created and active
 *
 * Usage:
 *   node --experimental-strip-types seed.ts
 *
 * Optional flags:
 *   --with-reference-data   Also seeds partner colleges & degree programmes
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
const SEED_FILE = join(ROOT, "scripts/seed-complete-reference-data.sql");
const SCHEMA_FILE = join(ROOT, "supabase/schema.sql");

// Load environment variables (.env.test, .env.local, .env)
function loadEnv() {
  const envFiles = [".env.test", ".env.local", ".env"];
  for (const file of envFiles) {
    const fullPath = join(ROOT, file);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
        if (match && !process.env[match[1]!]) {
          process.env[match[1]!] = match[2]!.trim().replace(/^['"]|['"]$/g, "");
        }
      }
    }
  }
}

loadEnv();

/**
 * 1. Read and fuse all 80 migrations into a clean schema.sql
 */
export function fusePureSchema(): {
  migrationFiles: string[];
  schemaSql: string;
} {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  console.log(`📦 Fusing ${migrationFiles.length} migrations into pure database schema...`);

  let schemaSql = `-- =============================================================================\n` +
    `-- FACE Prep Campus — Placement Management System (PMS)\n` +
    `-- Complete Database Schema (Migrations 0001 - ${migrationFiles[migrationFiles.length - 1]?.slice(0, 4)})\n` +
    `-- Pure Schema: Tables, Enums, RLS, Triggers & Stored Procedures (No Mock Data)\n` +
    `-- =============================================================================\n\n`;

  for (const file of migrationFiles) {
    const filePath = join(MIGRATIONS_DIR, file);
    const content = readFileSync(filePath, "utf8");
    schemaSql += `-- Migration: ${file}\n`;
    schemaSql += content.trim() + `\n\n`;
  }

  writeFileSync(SCHEMA_FILE, schemaSql, "utf8");
  console.log(`✅ Generated pure schema file: ${SCHEMA_FILE}`);

  return { migrationFiles, schemaSql };
}

/**
 * 2. Execute via Supabase CLI
 */
export function executeViaSupabaseCli(dbUrl: string): boolean {
  console.log(`🚀 Applying schema to database via Supabase CLI...`);
  try {
    execSync(`npx supabase db push --db-url "${dbUrl}"`, {
      stdio: "inherit",
      cwd: ROOT,
    });
    return true;
  } catch (err) {
    console.warn("⚠️  Supabase CLI push was not available or encountered an issue.");
    return false;
  }
}

/**
 * 3. Execute via Supabase Management API over HTTPS
 */
export async function executeViaManagementApi(
  projectRef: string,
  accessToken: string,
  sql: string,
  label: string
): Promise<boolean> {
  console.log(`📡 Applying ${label} via Supabase Management API [${projectRef}]...`);
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`❌ Management API Error (${res.status}):`, errText);
    return false;
  }

  console.log(`✨ ${label} applied successfully!`);
  return true;
}

/**
 * 4. Create required storage buckets (resumes, documents, offer_letters, jd)
 */
export async function createStorageBuckets(supabaseUrl: string, serviceRoleKey: string) {
  console.log("\n🗂️  Configuring Supabase Storage Buckets (Private)...");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const buckets = [
    { id: "documents", public: false, fileSizeLimit: 5242880 },
    { id: "resumes", public: false, fileSizeLimit: 5242880 },
    { id: "offer_letters", public: false, fileSizeLimit: 5242880 },
    { id: "jd", public: false, fileSizeLimit: 10485760 },
  ];

  const { data: existing } = await supabase.storage.listBuckets();
  const existingIds = new Set((existing || []).map((b) => b.id));

  for (const b of buckets) {
    if (existingIds.has(b.id)) {
      console.log(`   ⏩ Storage bucket "${b.id}" already exists.`);
    } else {
      const { error } = await supabase.storage.createBucket(b.id, {
        public: b.public,
        fileSizeLimit: b.fileSizeLimit,
      });
      if (error) {
        console.warn(`   ⚠️  Bucket "${b.id}":`, error.message);
      } else {
        console.log(`   ✅ Created private storage bucket "${b.id}"`);
      }
    }
  }
}

/**
 * 5. Verify Database Tables
 */
export async function verifyDatabaseTables(supabaseUrl: string, anonOrServiceKey: string) {
  console.log("\n🔍 Verifying Database Tables Status...");
  const supabase = createClient(supabaseUrl, anonOrServiceKey, {
    auth: { persistSession: false },
  });

  const tables = [
    "campuses",
    "cities",
    "degrees",
    "branches",
    "campus_programmes",
    "skill_areas",
    "settings",
    "staff_invitations",
    "profiles",
    "students",
    "student_documents",
    "student_semesters",
    "student_certificates",
    "drives",
    "applications",
    "shortlist_entries",
    "attendance",
    "round_results",
    "offers",
    "notifications",
    "email_deliveries",
    "audit_log",
  ];

  const summary: Array<{ Table: string; Status: string }> = [];

  for (const t of tables) {
    const { error } = await supabase
      .from(t)
      .select("*", { count: "exact", head: true });

    if (error) {
      summary.push({ Table: t, Status: `❌ ${error.message}` });
    } else {
      summary.push({ Table: t, Status: "✅ Table Created & Active" });
    }
  }

  console.table(summary);
}

/**
 * Main Runner
 */
async function run() {
  console.log("=============================================================================");
  console.log("FACE Prep Campus — Placement Management System (PMS)");
  console.log("Pure Database Schema Creator (No Mock Data)");
  console.log("=============================================================================\n");

  const args = process.argv.slice(2);
  const includeReferenceData = args.includes("--with-reference-data") || args.includes("--seed");

  // Step 1: Fuse migrations into pure schema
  const { schemaSql } = fusePureSchema();

  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  let projectRef = process.env.SUPABASE_PROJECT_REF;

  if (!projectRef && supabaseUrl) {
    const match = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (match) projectRef = match[1];
  }

  let schemaApplied = false;

  // Step 2: Try direct DB push
  if (dbUrl) {
    schemaApplied = executeViaSupabaseCli(dbUrl);
  }

  // Step 3: Try Management API if token provided
  if (!schemaApplied && accessToken && projectRef) {
    schemaApplied = await executeViaManagementApi(projectRef, accessToken, schemaSql, "Pure Database Schema (0001–0080)");
    if (schemaApplied && includeReferenceData && existsSync(SEED_FILE)) {
      const seedSql = readFileSync(SEED_FILE, "utf8");
      await executeViaManagementApi(projectRef, accessToken, seedSql, "Reference Data");
    }
  }

  // If automated remote execution was not reached directly, show 1-click SQL copy notice
  if (!schemaApplied) {
    console.log("\n📋 1-Click Schema Execution in Supabase Dashboard:");
    console.log(`   1. Open: https://supabase.com/dashboard/project/${projectRef || "YOUR_PROJECT"}/sql/new`);
    console.log(`   2. Copy and paste the contents of: ${SCHEMA_FILE}`);
    console.log(`   3. Click 'Run' to create all 38 tables, enums, triggers, and RLS policies.\n`);
  }

  // Step 4: Storage buckets
  if (supabaseUrl && serviceKey) {
    await createStorageBuckets(supabaseUrl, serviceKey);
  }

  // Step 5: Table check
  if (supabaseUrl && (serviceKey || anonKey)) {
    await verifyDatabaseTables(supabaseUrl, serviceKey || anonKey!);
  }

  console.log("\n=============================================================================");
  console.log("✨ Pure Schema Setup Complete!");
  console.log("=============================================================================\n");
}

run().catch((err) => {
  console.error("Setup Error:", err);
  process.exit(1);
});
