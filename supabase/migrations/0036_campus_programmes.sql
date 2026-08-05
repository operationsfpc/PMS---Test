-- A programme belongs to a COLLEGE and a YEAR OF PASSING. F6 (UAT 2026-08-06).
--
-- "A separate page for degree and branches is not required for the admin. This
-- is always mapped to colleges for a particular year of Passing. Degree+Branch
-- is one field. This can be added or edited later under the colleges created.
-- Students can just select this from a drop down while filling the form."
--
-- `degrees` and `branches` were a global catalogue with no owner and no year.
-- Two consequences, both live:
--
--   * an Admin adding "AI and DS" added it for EVERY college, so a student at
--     a college that has never run it could select it and then be judged
--     eligible for drives targeting it;
--   * a branch that stopped running in 2026 was still offered to the 2028
--     cohort, because nothing recorded which year a programme belonged to.
--
-- The catalogue tables stay: they are referenced by `students`, by the drive
-- targeting tables and by the roster import, and normalising the names in one
-- place is still right. What changes is that a college now says which of them
-- it actually runs, and for whom.

create table if not exists campus_programmes (
  id           uuid primary key default gen_random_uuid(),
  campus_id    uuid not null references campuses(id) on delete cascade,
  degree_id    uuid not null references degrees(id)  on delete restrict,
  -- Nullable: an MBA has no branches, and demanding one would force an Admin
  -- to invent a name that then appears in a student's dropdown.
  branch_id    uuid references branches(id) on delete restrict,
  passing_year integer not null,
  created_at   timestamptz not null default now(),

  -- ⚠️ ASSUMPTION — UNCONFIRMED (A34). Wide enough for a cohort that graduated
  -- five years ago and one that starts next year; narrow enough to refuse a
  -- typo like 2072. Mirrors src/domain/programmes.ts.
  constraint passing_year_is_plausible check (passing_year between 2015 and 2100)
);

-- One row per cohort: the same branch NEXT year is a different cohort and is
-- allowed, the same branch twice in one year is a duplicate in a dropdown.
create unique index if not exists one_programme_per_campus_year
  on campus_programmes (campus_id, degree_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), passing_year);

create index if not exists campus_programmes_campus_idx
  on campus_programmes (campus_id, passing_year);

/**
 * A branch belongs to exactly one degree, so a row naming both must agree.
 *
 * Without this, "B.E + Finance" is storable, appears in the student's dropdown
 * as a real option, and lands on their record — where every eligibility rule
 * then reads a degree and a branch that never went together.
 */
create or replace function branch_belongs_to_the_degree() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.branch_id is not null
     and not exists (
       select 1 from branches
        where id = new.branch_id and degree_id = new.degree_id
     ) then
    raise exception 'branch_belongs_to_the_degree: that branch is not part of that degree'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists campus_programme_branch_matches on campus_programmes;
create trigger campus_programme_branch_matches
  before insert or update on campus_programmes
  for each row execute function branch_belongs_to_the_degree();

alter table campus_programmes enable row level security;
alter table campus_programmes force  row level security;

-- Everyone signed in may READ it: a student needs the dropdown, and staff need
-- to know what a college runs before they target a drive at it.
create policy anyone_reads_campus_programmes
  on campus_programmes for select
  using (auth.uid() is not null);

-- Only an Admin maintains it, under the college (F6). Three separate commands
-- rather than `for all`, which would also cover SELECT and silently narrow the
-- read policy above to Admins only.
create policy admin_adds_campus_programmes
  on campus_programmes for insert with check (is_admin());

create policy admin_edits_campus_programmes
  on campus_programmes for update using (is_admin()) with check (is_admin());

create policy admin_removes_campus_programmes
  on campus_programmes for delete using (is_admin());

grant select, insert, update, delete on campus_programmes to authenticated;

/**
 * The backfill. WITHOUT THIS, 0036 IS AN OUTAGE.
 *
 * `campus_programmes` starts empty, and the registration form now offers only
 * what it contains. So the moment this migration lands, every student already
 * on the roster opens their form and finds no degree to select - blocked, on a
 * form they may be halfway through, because a table that did not exist until
 * now has nothing in it.
 *
 * Their college has been running their programme for years. Every distinct
 * (campus, degree, branch, passing year) on the roster IS, by definition,
 * something that college runs, so that is where the seed comes from.
 *
 * A FUNCTION rather than a bare INSERT, for two reasons: it is testable
 * against a seeded database (a bare statement in a migration runs once, on an
 * empty schema, and proves nothing), and it is idempotent, so an Admin can run
 * it again after importing a new roster without creating duplicates.
 */
create or replace function backfill_campus_programmes() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_added integer;
begin
  insert into campus_programmes (campus_id, degree_id, branch_id, passing_year)
  select distinct s.campus_id, s.degree_id, s.branch_id, s.passing_year
    from students s
   where s.campus_id is not null
     and s.degree_id is not null
     -- The plausible range is the table's own (A34); a roster row outside it
     -- is bad data, and importing it here would just move the problem.
     and s.passing_year between 2015 and 2100
  on conflict do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- Run once, now, as part of the same migration. A backfill that only a human
-- remembers to run is not a backfill.
select backfill_campus_programmes();

comment on function backfill_campus_programmes is
  'F6: seeds campus_programmes from the roster. Idempotent - safe after any roster import.';

comment on table campus_programmes is
  'F6: degree+branch is one choice, and it belongs to a college for a passing year.';
