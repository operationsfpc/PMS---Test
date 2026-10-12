-- Migration 0091: Row Level Security for placement_record_overrides and disbarment_decisions
--
-- These two tables had no RLS — any authenticated user could read/modify them.
-- placement_record_overrides: Central CPC overrides which offer counts as the
--   student's placement record. Students should see their own; only staff writes.
-- disbarment_decisions: Central CPC disbars students from placement. Students
--   should see their own; only staff writes.

-- ── placement_record_overrides ───────────────────────────────────────────────

alter table placement_record_overrides enable row level security;
alter table placement_record_overrides force  row level security;

drop policy if exists student_reads_own_override on placement_record_overrides;
create policy student_reads_own_override on placement_record_overrides for select
  using (
    student_id = current_student_id()
    or is_org_reader()
    or (is_campus_reader() and student_id in (select my_student_ids()))
  );

drop policy if exists staff_writes_override on placement_record_overrides;
create policy staff_writes_override on placement_record_overrides for all
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));

grant select on placement_record_overrides to authenticated;

-- ── disbarment_decisions ─────────────────────────────────────────────────────

alter table disbarment_decisions enable row level security;
alter table disbarment_decisions force  row level security;

drop policy if exists student_reads_own_disbarment on disbarment_decisions;
create policy student_reads_own_disbarment on disbarment_decisions for select
  using (
    student_id = current_student_id()
    or is_org_reader()
    or (is_campus_reader() and student_id in (select my_student_ids()))
  );

drop policy if exists staff_writes_disbarment on disbarment_decisions;
create policy staff_writes_disbarment on disbarment_decisions for all
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));

grant select on disbarment_decisions to authenticated;
