-- Migration 0072: Row Level Security for opt_out_requests
--
-- PRD §16.1: An opt-out request is student-initiated, approved by a placement
-- coordinator, and irreversible once granted.
--
-- Like self_placement_requests (0014, 0018), students may read and insert only
-- their own requests. Coordinators read requests within their campus or org,
-- and only staff may decide (update) them.

alter table opt_out_requests enable row level security;
alter table opt_out_requests force  row level security;

-- A student reads their own requests; coordinators read their campus or org.
drop policy if exists student_reads_own_opt_out on opt_out_requests;
create policy student_reads_own_opt_out on opt_out_requests for select
  using (
    student_id = current_student_id()
    or is_org_reader()
    or (is_campus_reader() and student_id in (select my_student_ids()))
  );

-- A student may raise only their own opt-out request.
drop policy if exists student_raises_own_opt_out on opt_out_requests;
create policy student_raises_own_opt_out on opt_out_requests for insert
  with check (student_id = current_student_id());

-- Approval and decline are the coordinator's. A student has no update policy,
-- so they cannot approve or alter their own request.
drop policy if exists staff_decides_opt_out on opt_out_requests;
create policy staff_decides_opt_out on opt_out_requests for all
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));

grant select, insert, update on opt_out_requests to authenticated;
