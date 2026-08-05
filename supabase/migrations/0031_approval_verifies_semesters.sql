-- Approving a registration form verifies the semesters it declared.
--
-- Found 2026-08-05 while fixing why published drives were invisible to
-- eligible students. All three approved students carried
-- `student_semesters.status = 'pending'`: the coordinator approved the form
-- and the semester rows never moved, because `decide()` updates the students
-- row and nothing else.
--
-- `academicStandingFrom` counts only VERIFIED semesters - §7.2 requires
-- eligibility to be evaluated against verified data. With none verified it
-- returns null, the drives view falls back to `students.overall_cgpa`, and the
-- SRF deliberately never writes that column because an overall CGPA is not the
-- student's to declare. So every approved student is judged at a CGPA of ZERO.
--
-- Both live drives set no CGPA cutoff, so nothing is wrong today. The next
-- drive that sets one - which is the ordinary case - silently excludes the
-- whole cohort, and it looks exactly like the bug just fixed: an eligible
-- student sees an empty list and nobody can say why.
--
-- Approving IS the verification. The queue puts each declared figure beside
-- the marksheet that evidences it and asks the coordinator to compare them;
-- pressing approve is them saying they did. Recording that on the rows the
-- comparison was about keeps the claim where the eligibility rules read it.

create or replace function verify_semesters_on_srf_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.srf_status = 'srf_approved' and old.srf_status is distinct from 'srf_approved' then
    update student_semesters
       set status      = 'verified',
           -- `verified_has_verifier` insists a verified line names who
           -- verified it. The decider is the coordinator who just approved;
           -- falling back to the caller covers a direct correction made
           -- without going through the queue.
           verified_by = coalesce(new.srf_decided_by, auth.uid()),
           verified_at = coalesce(new.srf_decided_at, now())
     where student_id = new.id
       and status = 'pending';
  end if;

  return new;
end;
$$;

-- SECURITY DEFINER, unlike everything else added this week, and for a specific
-- reason: `semesters_write_staff` scopes a coordinator to their own campus's
-- students via `my_student_ids()`, and this runs inside their own UPDATE on a
-- student they have already been allowed to decide. Leaving it as invoker
-- would make approval depend on a second, differently-shaped permission check
-- passing at the same moment. The trigger only ever touches the semesters of
-- the row being approved.
drop trigger if exists verify_semesters_on_srf_approval on students;

create trigger verify_semesters_on_srf_approval
  after update on students
  for each row execute function verify_semesters_on_srf_approval();

-- Students already approved before this existed.
--
-- This asserts nothing new on the coordinator's behalf. Approval is exactly
-- the claim being recorded, and `srf_decided_by` says who made it - so only
-- rows whose form was approved AND carries a decider are touched. Anything
-- else stays pending and gets checked properly.
update student_semesters ss
   set status      = 'verified',
       verified_by = s.srf_decided_by,
       verified_at = coalesce(s.srf_decided_at, now())
  from students s
 where ss.student_id = s.id
   and ss.status = 'pending'
   and s.srf_status = 'srf_approved'
   and s.srf_decided_by is not null;
