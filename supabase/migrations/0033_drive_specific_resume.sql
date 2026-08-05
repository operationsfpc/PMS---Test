-- A resume per DRIVE, not only per role category. F14 (UAT 2026-08-06).
--
-- "Ask for a drive specific resume to be uploaded at the time of applying."
--
-- The SRF collects one resume per role category, and `one_resume_per_category`
-- (0003) enforces exactly that. It is the right rule for the PROFILE resume
-- and fatal for this one: the second software drive a student applies to would
-- hit a unique violation, and they would be told their application failed for
-- no reason they could act on.
--
-- So the index is narrowed to the profile resume - the row with no drive - and
-- a second one keeps the per-drive resumes to one each. A student re-thinking
-- their CV before the deadline replaces the row rather than accruing copies
-- nobody can tell apart.

alter table student_documents
  add column if not exists drive_id uuid references drives(id) on delete cascade;

comment on column student_documents.drive_id is
  'F14: set only on a resume uploaded for one application. NULL is the profile resume.';

-- The profile resume: still one per category, exactly as before.
drop index if exists one_resume_per_category;

create unique index one_resume_per_category
  on student_documents (student_id, role_category)
  where kind = 'resume' and drive_id is null;

-- The application resume: one per student per drive.
create unique index if not exists one_resume_per_drive
  on student_documents (student_id, drive_id)
  where kind = 'resume' and drive_id is not null;

-- A marksheet does not belong to a drive. Left unchecked, a bug elsewhere
-- would quietly delete a student's 10th marksheet when a drive was removed,
-- because of the cascade above.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'drive_document_is_a_resume') then
    alter table student_documents
      add constraint drive_document_is_a_resume
      check (drive_id is null or kind = 'resume');
  end if;
end $$;
