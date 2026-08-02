-- City -> Campus -> Degree -> Branch, completed.
--
-- Two things happen here, and the second is the urgent one.
--
-- 1. City becomes a real table and a campus gains a complete, mandatory
--    identity. Confirmed 2026-08-02.
--
-- 2. RLS is enabled on the reference and identity tables. 0008 granted
--    insert+update on EVERY table to `authenticated` but enabled RLS on only
--    nine, leaving four proven escalation paths from student to admin. See
--    src/db/org-hierarchy.test.ts, which reproduces all four.
--
-- Precondition: `campuses` is empty in every environment (verified against
-- production 2026-08-02), so the restructure needs no backfill.

create table cities (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  state  text not null
);

-- City was free text on the campus. One city, one row, one state - stored
-- once so "Chennai"/"chennai" can never become two cities in a report.
alter table campuses drop column city;

alter table campuses
  add column city_id                uuid not null references cities(id),
  add column code                   text not null unique,
  add column address                text not null,
  add column primary_contact_name   text not null,
  add column primary_contact_email  text not null,
  add column primary_contact_phone  text not null;

-- Deactivate, never delete: a campus has students, applications and offers
-- hanging off it, and a branch is referenced by every student in it.
-- `authenticated` was never granted DELETE, so this is the only retirement
-- path that exists.
alter table campuses add column is_active boolean not null default true;
alter table branches add column is_active boolean not null default true;

-- ---------------------------------------------------------------------------
-- Reference and identity tables are admin-write, everyone-read.
-- ---------------------------------------------------------------------------

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select current_app_role() = 'admin'
$$;

-- NOTE: deliberately no FORCE. The login guards in 0009 (enforce_login_allowlist,
-- claim_student_record, accept_staff_invitation) are SECURITY DEFINER and must
-- keep bypassing these policies, or no one can ever sign in again.
alter table cities                   enable row level security;
alter table campuses                 enable row level security;
alter table degrees                  enable row level security;
alter table branches                 enable row level security;
alter table campus_degrees           enable row level security;
alter table profiles                 enable row level security;
alter table staff_campus_assignments enable row level security;
alter table staff_invitations        enable row level security;
alter table settings                 enable row level security;

-- Readable by anyone signed in: students need campuses, degrees and branches
-- to read a drive, and the app needs settings for the offer bands.
create policy read_cities            on cities                   for select using (true);
create policy read_campuses          on campuses                 for select using (true);
create policy read_degrees           on degrees                  for select using (true);
create policy read_branches          on branches                 for select using (true);
create policy read_campus_degrees    on campus_degrees           for select using (true);
create policy read_profiles          on profiles                 for select using (true);
create policy read_assignments       on staff_campus_assignments for select using (true);
create policy read_settings          on settings                 for select using (true);

-- Staff invitations are an allowlist of pending accounts. A student reading it
-- learns nothing they should, so it is admin-only in both directions.
create policy read_invitations       on staff_invitations for select using (is_admin());

create policy write_cities           on cities                   for all using (is_admin()) with check (is_admin());
create policy write_campuses         on campuses                 for all using (is_admin()) with check (is_admin());
create policy write_degrees          on degrees                  for all using (is_admin()) with check (is_admin());
create policy write_branches         on branches                 for all using (is_admin()) with check (is_admin());
create policy write_campus_degrees   on campus_degrees           for all using (is_admin()) with check (is_admin());
create policy write_profiles         on profiles                 for all using (is_admin()) with check (is_admin());
create policy write_assignments      on staff_campus_assignments for all using (is_admin()) with check (is_admin());
create policy write_invitations      on staff_invitations for all using (is_admin()) with check (is_admin());
create policy write_settings         on settings                 for all using (is_admin()) with check (is_admin());

-- 0008's blanket grant only covered tables that existed then.
grant select, insert, update on cities to authenticated;
