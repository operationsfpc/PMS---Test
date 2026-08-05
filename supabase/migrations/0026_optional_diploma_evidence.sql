-- The diploma marksheet becomes OPTIONAL. Asked for 2026-08-06: "need an
-- optional upload field as well here for mark sheet."
--
-- 0024 made a declared diploma all-or-nothing, marksheet included, on the
-- principle that a declared figure must be evidenced. That principle still
-- holds where it matters: a SEMESTER figure is what R5 reads to decide whether
-- a student may apply to a drive, and `student_semesters.marksheet_id` stays
-- NOT NULL.
--
-- A diploma figure feeds no cutoff. It is context for a recruiter, not an
-- eligibility input, so an unevidenced one cannot decide anything. Demanding a
-- document for it blocked registration over a scan a student may not have to
-- hand - for a qualification that is optional in the first place.
--
-- What is still required is the pair that makes the number READABLE: a figure
-- with no scale is meaningless, because 78.5 is a fine percentage and an
-- impossible CGPA.

alter table students drop constraint if exists diploma_is_all_or_nothing;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diploma_marks_have_a_scale') then
    alter table students add constraint diploma_marks_have_a_scale check (
      (diploma_marks is null and diploma_marks_scale is null)
      or (diploma_marks is not null and diploma_marks_scale is not null)
    );
  end if;
end $$;

-- The consolidated UG marksheet was never constrained - only ever required by
-- the application - so relaxing that side needs no DDL. The ownership and
-- kind triggers from 0023/0024 still apply to BOTH: optional to supply, but
-- if supplied it must be that student's own document, of the right kind.
