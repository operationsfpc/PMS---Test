-- The academic history the SRF actually collects. Asked for 2026-08-06.
--
-- The form asked for two school percentages and jumped straight to the degree.
-- It had nowhere to record WHICH school issued them, no diploma at all - the
-- route most polytechnic students take into an engineering degree - and no way
-- to say that a college reports percentages rather than a CGPA.
--
-- That last one is not cosmetic. Every cutoff in this system is a CGPA on the
-- 10-point scale (`drives.min_overall_cgpa`), so a student whose college
-- reports 78% had two options: mistype it as a CGPA of 7.8, which is wrong by
-- a fifth of a grade and decides eligibility, or be refused outright by the
-- 0..10 check constraint.

create type marks_scale as enum ('cgpa', 'percentage');

alter type document_kind add value if not exists 'diploma_marksheet';

-- --------------------------------------------------------------- the schools
alter table students
  add column if not exists tenth_institution   text,
  add column if not exists twelfth_institution text;

-- --------------------------------------------------------------- the diploma
-- Optional to declare. Once declared it is a mark like any other, and the
-- constraint below refuses one with nothing behind it.
alter table students
  add column if not exists diploma_institution   text,
  add column if not exists diploma_marks         numeric(5,2) check (diploma_marks between 0 and 100),
  add column if not exists diploma_marks_scale   marks_scale,
  add column if not exists diploma_marksheet_id  uuid references student_documents(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diploma_is_all_or_nothing') then
    alter table students add constraint diploma_is_all_or_nothing check (
      -- No diploma at all, or a complete one: a figure, the scale it is on,
      -- and the document that proves it. A half-declared diploma is a mark
      -- nobody can verify.
      (diploma_marks is null and diploma_marks_scale is null and diploma_marksheet_id is null)
      or (diploma_marks is not null and diploma_marks_scale is not null
          and diploma_marksheet_id is not null)
    );
  end if;
end $$;

-- ------------------------------------------- the completed undergraduate one
-- A PG student's aggregate said nothing about WHERE or IN WHAT.
alter table students
  add column if not exists ug_degree  text,
  add column if not exists ug_college text,
  add column if not exists ug_branch  text,
  -- What the student actually typed, beside the CGPA it normalises to.
  add column if not exists ug_aggregate_declared numeric(5,2)
    check (ug_aggregate_declared between 0 and 100),
  add column if not exists ug_aggregate_scale    marks_scale;

-- ------------------------------------------------------------- college marks
-- BOTH figures are stored, deliberately:
--
--   cgpa           - normalised to the 10-point scale. The ONLY thing a cutoff
--                    can be compared against, and what every existing reader
--                    (eligibility, ranking, the dashboards) already assumes.
--   declared_marks - what the student typed, on `marks_scale`. What a
--                    coordinator checks against the marksheet, because a
--                    converted CGPA is a number they cannot find on it.
--
-- Storing only the first loses the audit trail; only the second makes every
-- comparison re-derive a figure it could get wrong. The conversion itself is
-- one constant in src/domain/marks.ts (A33).
alter table student_semesters
  add column if not exists declared_marks numeric(5,2) check (declared_marks between 0 and 100),
  add column if not exists marks_scale    marks_scale not null default 'cgpa';

-- `cgpa` keeps its 0..10 check from 0003 and keeps its meaning: every row that
-- existed before this migration was a CGPA, which is exactly what the default
-- says.

-- ------------------------------------------------- the diploma's own evidence
-- Same hole the semester marksheet had: the foreign key says "a document", not
-- whose, and not that it is the right kind.
create or replace function enforce_diploma_marksheet_belongs_to_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  doc_kind document_kind;
begin
  if new.diploma_marksheet_id is null
     or new.diploma_marksheet_id is not distinct from old.diploma_marksheet_id then
    return new;
  end if;

  select student_id, kind into owner, doc_kind
    from student_documents where id = new.diploma_marksheet_id;

  if owner is distinct from new.id then
    raise exception 'A diploma can only be evidenced by that student''s own marksheet.'
      using errcode = 'check_violation';
  end if;

  if doc_kind <> 'diploma_marksheet' then
    raise exception 'A diploma must be evidenced by a diploma marksheet, not a %.', doc_kind
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_diploma_marksheet_belongs_to_student
  before insert or update on students
  for each row execute function enforce_diploma_marksheet_belongs_to_student();
