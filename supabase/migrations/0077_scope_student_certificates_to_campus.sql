-- 0077: Scope student_certificates SELECT policy to campus coordinator's assigned students.
--
-- Previously in 0034, student_reads_own_certificates allowed any campus staff to SELECT:
--   using (student_id = current_student_id() or is_org_reader() or is_campus_staff())
--
-- Because is_campus_staff() had no campus scoping, campus coordinators fetched certificates
-- from ALL colleges. However, the students table RLS policy (0018) strictly forbade reading
-- student records from other campuses. As a result, PostgREST returned `students: null` for
-- cross-campus rows, showing up on the coordinator's queue as "Unknown student".
--
-- Align the SELECT policy with 0018 and 0042 so campus coordinators only fetch certificates
-- for students on their assigned campuses.

drop policy if exists student_reads_own_certificates on student_certificates;

create policy student_reads_own_certificates
  on student_certificates for select
  using (
    student_id = current_student_id()
    or is_org_reader()
    or (is_campus_reader() and student_id in (select my_student_ids()))
  );
