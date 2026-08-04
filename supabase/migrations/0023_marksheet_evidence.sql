-- Every declared figure is evidenced by the document that proves it.
--
-- `student_semesters.marksheet_id` was created in 0003 for exactly this and
-- nothing ever wrote it. The SRF marked the marksheet uploads REQUIRED, let
-- the student pick their files, and then discarded every one: the files never
-- left the browser, no storage object was created, no `student_documents` row
-- was recorded, and no semester line was ever linked to anything.
--
-- The consequence was not cosmetic. A coordinator opening the verification
-- queue saw a declared CGPA and no document to check it against, which makes
-- "verified" a signature on the student's own typing - and a verified semester
-- is what R5 reads to decide whether that student may apply to a drive
-- (0017). The evidence chain had a hole exactly where the business rule
-- depends on it.
--
-- The application now uploads and links them. This migration is why that
-- cannot quietly stop being true.

-- ------------------------------------------------------------------- A31
-- A postgraduate declares ONE aggregate CGPA standing in for an entire
-- completed degree (0017). Unevidenced, it is the largest unverifiable number
-- on the form, so it is evidenced like any other declared mark.
-- ASSUMPTION - UNCONFIRMED: that a consolidated UG marksheet is the document
-- a PG student can actually produce. Cheap to reverse: drop the enum value's
-- use and the column.
alter type document_kind add value if not exists 'ug_consolidated_marksheet';

alter table students
  add column if not exists ug_marksheet_id uuid references student_documents(id);

-- ------------------------------------------------------ evidence is required
-- Safe as a plain NOT NULL: `student_semesters` has no rows on any deployed
-- project (checked against Mumbai, 2026-08-06), and nothing but the SRF has
-- ever inserted into it. A line with no marksheet is a number nobody can
-- check, and it would sit in the queue looking exactly like one that had been
-- evidenced.
alter table student_semesters
  alter column marksheet_id set not null;

-- --------------------------------------------------- evidence must be theirs
-- The foreign key says "a document". It does not say WHOSE document, or that
-- it is a marksheet at all. Without this, one student's marksheet could
-- evidence another's CGPA, or a resume could - and the coordinator, following
-- a correctly-signed link to a real PDF, would have no way to tell.
--
-- A trigger rather than a CHECK: the rule spans two tables.
create or replace function enforce_marksheet_belongs_to_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  doc_kind document_kind;
begin
  if new.marksheet_id is null then
    return new;
  end if;

  select student_id, kind into owner, doc_kind
    from student_documents where id = new.marksheet_id;

  if owner is distinct from new.student_id then
    raise exception 'A semester can only be evidenced by that student''s own marksheet.'
      using errcode = 'check_violation';
  end if;

  if doc_kind <> 'semester_marksheet' then
    raise exception 'A semester must be evidenced by a semester marksheet, not a %.', doc_kind
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_marksheet_belongs_to_student
  before insert or update on student_semesters
  for each row execute function enforce_marksheet_belongs_to_student();

-- The same rule for the postgraduate aggregate, which has the same hole.
create or replace function enforce_ug_marksheet_belongs_to_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  doc_kind document_kind;
begin
  if new.ug_marksheet_id is null
     or new.ug_marksheet_id is not distinct from old.ug_marksheet_id then
    return new;
  end if;

  select student_id, kind into owner, doc_kind
    from student_documents where id = new.ug_marksheet_id;

  if owner is distinct from new.id then
    raise exception 'A student''s UG aggregate can only be evidenced by their own marksheet.'
      using errcode = 'check_violation';
  end if;

  if doc_kind <> 'ug_consolidated_marksheet' then
    raise exception 'The UG aggregate must be evidenced by a consolidated UG marksheet.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_ug_marksheet_belongs_to_student
  before insert or update on students
  for each row execute function enforce_ug_marksheet_belongs_to_student();
