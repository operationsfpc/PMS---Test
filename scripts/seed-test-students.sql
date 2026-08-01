-- ============================================================================
-- TEST DATA ONLY.  NOT A MIGRATION.  DO NOT MOVE INTO supabase/migrations/.
-- ============================================================================
-- Creates one test campus, one degree, two branches, and three rostered
-- students, so the student journey can be exercised before a real college
-- roster exists.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste this -> Run.
--
-- BEFORE YOU RUN IT: replace the three REPLACE-ME email addresses below.
--
-- ---------------------------------------------------------------------------
-- WHY THE EMAILS MATTER
-- ---------------------------------------------------------------------------
-- Sign-in is Google-only, and migration 0009 refuses any address that is not
-- on this roster. So each test student's email must be a REAL Google account
-- that you can actually sign in to.
--
--   * Plus-aliases DO NOT work (you@gmail.com + "+test1").  Google reports the
--     canonical address at sign-in, so the alias will never match the roster.
--   * Do NOT reuse karthikraja@faceprep.in.  It is already the founding Admin;
--     putting it here too would make one person both staff and student and
--     fire both claim triggers.
--   * Any Gmail address works - a personal one is fine for testing.
--
-- Re-running this script is safe: every insert is guarded by ON CONFLICT.
-- ============================================================================

begin;

-- --- Campus / degree / branch -----------------------------------------------

insert into campuses (name, city)
values ('Test Engineering College', 'Chennai')
on conflict (name) do nothing;

insert into degrees (name)
values ('B.E.')
on conflict (name) do nothing;

insert into branches (degree_id, name)
select d.id, b.name
from degrees d
cross join (values ('Computer Science and Engineering'), ('Mechanical Engineering')) as b(name)
where d.name = 'B.E.'
on conflict (degree_id, name) do nothing;

insert into campus_degrees (campus_id, degree_id)
select c.id, d.id
from campuses c, degrees d
where c.name = 'Test Engineering College' and d.name = 'B.E.'
on conflict do nothing;

-- --- Rostered students -------------------------------------------------------
-- srf_status stays 'invited': that is what the roster upload produces. It flips
-- to 'registered' automatically when the student first signs in (trigger
-- claim_student_record in 0009_guards.sql).

insert into students (
  campus_id, degree_id, branch_id,
  roll_number, full_name, email, passing_year
)
select
  c.id,
  d.id,
  br.id,
  s.roll_number,
  s.full_name,
  s.email,
  2027
from campuses c
join degrees d      on d.name = 'B.E.'
join branches br    on br.degree_id = d.id and br.name = s.branch
cross join (values
  -- roll_number , full_name        , email                        , branch
  ('TEC001', 'Test Student One',   'REPLACE-ME-1@gmail.com', 'Computer Science and Engineering'),
  ('TEC002', 'Test Student Two',   'REPLACE-ME-2@gmail.com', 'Computer Science and Engineering'),
  ('TEC003', 'Test Student Three', 'REPLACE-ME-3@gmail.com', 'Mechanical Engineering')
) as s(roll_number, full_name, email, branch)
where c.name = 'Test Engineering College'
on conflict (email) do nothing;

commit;

-- --- Check what landed -------------------------------------------------------
-- Expect three rows, srf_status = 'invited', auth_user_id = null.

select s.roll_number, s.full_name, s.email, s.srf_status, s.auth_user_id,
       c.name as campus, d.name as degree, br.name as branch
from students s
join campuses c on c.id = s.campus_id
join degrees  d on d.id = s.degree_id
left join branches br on br.id = s.branch_id
order by s.roll_number;
