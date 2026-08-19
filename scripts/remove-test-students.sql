-- ============================================================================
-- REMOVE TEST DATA — run this BEFORE go-live.
-- ============================================================================
-- Removes the 100 test students injected by scripts/seed-100-test-students.sql.
-- All child rows cascade automatically (semesters · preferences · skill scores
-- · applications · round entries · notifications · audit rows).
--
-- Campus, degree and branch rows are intentionally kept: they represent real
-- FPC partner colleges and will be needed when actual rosters are imported.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste → Run.
--   OR via Management API:
--     TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
--     curl -s -X POST "https://api.supabase.com/v1/projects/poscikalmgfpvbjfytgw/database/query" \
--          -H "Authorization: Bearer $TOKEN" \
--          -H "Content-Type: application/json" \
--          -d "{\"query\": $(jq -Rs . < scripts/remove-test-students.sql)}"
--
-- WHAT IS DELETED
--   • students WHERE email LIKE 'fpc.test.%@example.com'
--     (all 100 test students; cascades to every child table)
--
-- WHAT IS KEPT (deliberately)
--   • campuses:          SDNB Vaishnav · S-VYASA · Takshashila · Kamaraj · AMET
--   • degrees:           B.Sc · BCA
--   • branches:          Computer Science with AI · AI and ML
--   • campus_degrees:    all campus × degree links
--   • campus_programmes: all campus × programme × 2027 links
--   • skill_areas:       the 8 DEFAULT_SKILL_AREAS (seeded by 0037)
-- ============================================================================

begin;

-- ── Pre-flight check ──────────────────────────────────────────────────────────

do $check$ declare
  n integer;
begin
  select count(*) into n
  from   students
  where  email like 'fpc.test.%@example.com';

  if n = 0 then
    raise notice 'No test students found — nothing to remove.';
  else
    raise notice 'About to delete % test student(s).', n;
  end if;
end $check$;

-- ── Delete test students (cascades to all child tables) ───────────────────────

delete from students
where email like 'fpc.test.%@example.com';

commit;

-- ── Confirmation ──────────────────────────────────────────────────────────────

select
  'students'              as table_name,
  count(*)                as remaining_test_rows
from students
where email like 'fpc.test.%@example.com'

union all

select
  'student_skill_scores',
  count(*)
from student_skill_scores
where student_id not in (select id from students)   -- orphan check

union all

select
  'student_semesters',
  count(*)
from student_semesters
where student_id not in (select id from students)

union all

select
  'student_role_preferences',
  count(*)
from student_role_preferences
where student_id not in (select id from students);

-- Expected: all four rows show 0.
-- If any row shows > 0, cascade did not fire — investigate before go-live.
