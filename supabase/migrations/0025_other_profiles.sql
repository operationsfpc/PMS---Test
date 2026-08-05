-- Profiles beyond the four the form names. Asked for 2026-08-06:
-- "in professional profiles, have field to enter others also. they can add
-- fields, give a name and mention the url/user name."
--
-- The SRF hard-coded LinkedIn, GitHub, LeetCode and HackerRank. A student with
-- a Kaggle profile, a Behance portfolio, a Codeforces handle or their own site
-- had nowhere to put it - and for many students that is the strongest evidence
-- they have.
--
-- A jsonb LIST rather than a child table, deliberately:
--   * these are display-only links, owned entirely by the student row, with no
--     independent lifecycle and nothing referencing them;
--   * every new table is another chance to get RLS wrong on a system whose
--     hard rule is "students can only ever see their own data" (PRD 21.2).
-- The existing student policies therefore cover this with no new surface, and
-- the audit trigger on `students` already records before/after.
--
-- The SHAPE is owned by src/domain/profile-links.ts. Postgres guarantees only
-- what it can cheaply guarantee: that this is a list.

alter table students
  add column if not exists other_profiles jsonb not null default '[]'::jsonb;

-- Empty list, never null, so no reader has to branch on absence.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'other_profiles_is_a_list') then
    alter table students add constraint other_profiles_is_a_list
      check (jsonb_typeof(other_profiles) = 'array');
  end if;
end $$;
