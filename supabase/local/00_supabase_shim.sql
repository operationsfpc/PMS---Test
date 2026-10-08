-- Local-only shim. Supabase provides all of this in the real project; PGlite does not.
-- Loaded ONLY by the test harness, never deployed.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique not null,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;

grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Mock pg_cron and pg_net for local PGlite test environment
create schema if not exists cron;
create schema if not exists net;

create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(job_name text) returns boolean language sql as $$ select true $$;
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language sql as $$ select 1::bigint $$;

