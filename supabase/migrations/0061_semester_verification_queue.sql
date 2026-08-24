-- The semester (CGPA) verification queue — database half.
--
-- 2026-08-24 UAT (Karthik): "add request by students for cgpa which has to be
-- approved by campus placement coordinator is not showing up for approval.
-- similar request for certifications is showing up. but cgpa is not."
--
-- He was right twice over. Certificates got a dedicated queue (0038/0039);
-- semesters only ever verify as a side effect of SRF approval (0031). A
-- semester added AFTER approval — F13's whole point — sat `pending` forever,
-- which is why a student with three declared semesters was still judged at
-- CGPA 0 wherever no verified line existed.
--
-- Modelled on 0038, clause for clause:
--
-- 1. A rejection names its reason ON the row, where the student reads it.
-- 2. A REJECTED line becomes the student's to remove — the unique
--    (student_id, semester_number) key would otherwise block the corrected
--    re-declaration for good. Verified lines stay untouchable (Q4), and
--    pending ones were already removable (they are the student's own claim).
--
-- No new UPDATE policy: `semesters_write_staff` (0018) already lets the
-- campus CPC decide their own students' rows, which is exactly who the queue
-- belongs to (D3).

alter table student_semesters
  add column rejection_reason text;

alter table student_semesters
  add constraint semester_rejected_has_reason
    check (status <> 'rejected' or btrim(coalesce(rejection_reason, '')) <> '');

drop policy if exists semesters_delete_self on student_semesters;
create policy semesters_delete_self on student_semesters for delete
  using (
    student_id = current_student_id()
    and status in ('pending', 'rejected')
  );
