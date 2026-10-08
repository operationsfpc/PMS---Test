-- =============================================================================
-- FACE Prep Campus — Placement Management System (PMS)
-- Complete Clean Drop & Database Reset Script
-- ⚠️ WARNING: Drops all tables, types, enums, views, triggers, and functions in public!
-- =============================================================================

-- 1. Drop the entire public schema and all its objects cleanly in cascade
drop schema if exists public cascade;

-- 2. Recreate the clean public schema
create schema public;

-- 3. Restore standard Supabase roles and permissions on public schema
grant all on schema public to postgres;
grant all on schema public to public;
grant all on schema public to anon;
grant all on schema public to authenticated;
grant all on schema public to service_role;

-- 4. Ensure standard cryptographic extensions are enabled
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
