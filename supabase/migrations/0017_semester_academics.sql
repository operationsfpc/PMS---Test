-- Semester-wise academics. Confirmed 2026-08-04, supersedes the single
-- cumulative CGPA the SRF collected.
--
-- A student declares whether they are pursuing UG or PG:
--   UG -> one line per semester, at most 10.
--   PG -> a single aggregate for the UG they already finished, then one line
--         per PG semester, at most 4.
--
-- Each line carries CGPA (not GPA - cumulative to the end of that semester),
-- standing arrears and history of arrears. `student_semesters` already had
-- exactly that shape from 0003; what was missing was the programme level, the
-- per-level cap, and anywhere to put a postgraduate's UG result.
--
-- ELIGIBILITY reads the LATEST VERIFIED semester (src/domain/academics.ts).
-- students.overall_cgpa is kept for now because the roster importer and the
-- existing screens still write it, but it is no longer what decides whether a
-- student may apply.

create type programme_level as enum ('ug', 'pg');

alter table students
  add column programme_level    programme_level not null default 'ug',
  -- Postgraduates only: the one aggregate line standing in for a whole degree.
  add column ug_aggregate_cgpa  numeric(4,2) check (ug_aggregate_cgpa between 0 and 10);

-- The cap depends on the student's own programme level, which a CHECK
-- constraint cannot reach. 0003 allowed semester_number 1..12 for everyone.
create or replace function enforce_semester_cap() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  level programme_level;
  limit_for_level integer;
  used integer;
begin
  select programme_level into level from students where id = new.student_id;
  if not found then
    return new;
  end if;

  limit_for_level := case level when 'pg' then 4 else 10 end;

  if new.semester_number < 1 or new.semester_number > limit_for_level then
    raise exception
      'Semester % is outside the range for this programme (at most % semesters).',
      new.semester_number, limit_for_level
      using errcode = 'check_violation';
  end if;

  select count(*) into used
    from student_semesters
   where student_id = new.student_id
     and (tg_op = 'INSERT' or id <> new.id);

  if used + 1 > limit_for_level then
    raise exception 'This student has at most % semesters.', limit_for_level
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_semester_cap
  before insert or update on student_semesters
  for each row execute function enforce_semester_cap();
