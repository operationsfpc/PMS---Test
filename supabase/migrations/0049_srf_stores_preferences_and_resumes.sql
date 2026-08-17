-- 0049 — P10. The SRF stores the preferences and resumes it collects.
--
-- 2026-08-18 (Karthik): "preferences and resumes SUBMITTED AT THE TIME of
-- submitting SRF has to be recorded and saved. This has to be used while
-- publishing a drive."
--
-- 🔴 What was actually happening. The form has always asked for up to five role
-- categories and demanded one resume per category, refusing to submit without
-- them — and `submit_srf` wrote NEITHER. `student_role_preferences` has been an
-- empty table since 0003, and the resume files never left the browser: the
-- `File` was read to decide whether the upload box was non-empty, then dropped.
--
-- So a student who had only ever filled in the SRF had **no resume on file and
-- no recorded preference**, while `rankApplicants` scores role-preference match
-- and R7 promises the recruiter one resume per category. Nobody reported it
-- because /student/profile quietly covers for it, and because the form's own
-- validation made it look as though the files were being taken seriously.
--
-- Arity changes (6 parameters, was 4), so the OLD FUNCTION IS DROPPED
-- EXPLICITLY. `create or replace` would leave a second overload behind, and
-- PostgREST would then have to guess which one a payload meant.

drop function if exists submit_srf(jsonb, jsonb, jsonb, jsonb);

create or replace function submit_srf(
  p_student         jsonb,
  p_semesters       jsonb,
  p_documents       jsonb,
  p_certificates    jsonb default '[]'::jsonb,
  p_role_categories jsonb default '[]'::jsonb,
  p_resumes         jsonb default '[]'::jsonb
)
returns table (student_id uuid, srf_status srf_status)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_student_id uuid;
  v_slots      jsonb;
begin
  v_student_id := current_student_id();

  if v_student_id is null then
    raise exception 'We could not find your student record. Contact your placement coordinator.'
      using errcode = 'no_data_found';
  end if;

  with inserted as (
    insert into student_documents (student_id, kind, storage_path, size_bytes)
    select v_student_id,
           (d->>'kind')::document_kind,
           d->>'storage_path',
           (d->>'size_bytes')::int
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    returning id, storage_path
  )
  select coalesce(jsonb_object_agg(d->>'slot', i.id), '{}'::jsonb)
    into v_slots
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    join inserted i on i.storage_path = d->>'storage_path';

  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = p_student->>'whatsapp',
    alternate_contact     = p_student->>'alternate_contact',
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = (p_student->>'tenth_percentage')::numeric,
    tenth_board           = (p_student->>'tenth_board')::school_board,
    tenth_board_state     = p_student->>'tenth_board_state',
    tenth_board_other     = p_student->>'tenth_board_other',
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = (p_student->>'twelfth_percentage')::numeric,
    twelfth_board         = (p_student->>'twelfth_board')::school_board,
    twelfth_board_state   = p_student->>'twelfth_board_state',
    twelfth_board_other   = p_student->>'twelfth_board_other',
    diploma_institution   = p_student->>'diploma_institution',
    diploma_university    = p_student->>'diploma_university',
    diploma_marks         = (p_student->>'diploma_marks')::numeric,
    diploma_marks_scale   = (p_student->>'diploma_marks_scale')::marks_scale,
    diploma_marksheet_id  = (v_slots->>(p_student->>'diploma_marksheet_slot'))::uuid,
    passing_year          = (p_student->>'passing_year')::int,
    programme_level       = (p_student->>'programme_level')::programme_level,
    ug_degree             = p_student->>'ug_degree',
    ug_college            = p_student->>'ug_college',
    ug_branch             = p_student->>'ug_branch',
    ug_aggregate_declared = (p_student->>'ug_aggregate_declared')::numeric,
    ug_aggregate_scale    = (p_student->>'ug_aggregate_scale')::marks_scale,
    ug_aggregate_cgpa     = (p_student->>'ug_aggregate_cgpa')::numeric,
    ug_marksheet_id       = (v_slots->>(p_student->>'ug_marksheet_slot'))::uuid,
    technical_skills      = p_student->>'technical_skills',
    areas_of_interest     = p_student->>'areas_of_interest',
    areas_of_expertise    = p_student->>'areas_of_expertise',
    projects              = p_student->>'projects',
    achievements          = p_student->>'achievements',
    linkedin_url          = p_student->>'linkedin_url',
    github_url            = p_student->>'github_url',
    leetcode_url          = p_student->>'leetcode_url',
    hackerrank_url        = p_student->>'hackerrank_url',
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    consent_given_at      = now(),
    srf_status            = 'srf_submitted',
    srf_submitted_at      = now(),
    srf_draft             = null,
    srf_draft_saved_at    = null
  where id = v_student_id;

  delete from student_semesters where student_semesters.student_id = v_student_id;

  insert into student_semesters (
    student_id, semester_number, cgpa, declared_marks, marks_scale,
    current_arrears, history_of_arrears, marksheet_id
  )
  select v_student_id,
         (s->>'semester_number')::int,
         (s->>'cgpa')::numeric,
         (s->>'declared_marks')::numeric,
         (s->>'marks_scale')::marks_scale,
         (s->>'current_arrears')::int,
         (s->>'history_of_arrears')::int,
         (v_slots->>(s->>'marksheet_slot'))::uuid
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s;

  -- ------------------------------------------------------------ preferences
  -- Replaced wholesale: this IS the student's current answer to "which areas
  -- do you want to be considered for", and a resubmission that drops one means
  -- they no longer want it. Nothing downstream keeps history of the question.
  delete from student_role_preferences
   where student_role_preferences.student_id = v_student_id;

  insert into student_role_preferences (student_id, category)
  select v_student_id, c::role_category
    from jsonb_array_elements_text(coalesce(p_role_categories, '[]'::jsonb)) as c
  on conflict do nothing;

  -- --------------------------------------------------------------- resumes
  -- The PROFILE resume for each area: `drive_id is null`, which is exactly
  -- what `one_resume_per_category` (narrowed by 0033) keys on. A resume
  -- uploaded for ONE application carries a drive_id and is untouched here -
  -- deleting those would remove the CV a recruiter was actually sent.
  delete from student_documents
   where student_documents.student_id = v_student_id
     and student_documents.kind = 'resume'
     and student_documents.drive_id is null
     and (
       -- Replaced only where a new one has been supplied for the same area, or
       -- where the student has stopped asking for that area altogether. A
       -- resubmission that re-uploads two of three resumes keeps the third.
       student_documents.role_category::text in (
         select r->>'role_category' from jsonb_array_elements(coalesce(p_resumes, '[]'::jsonb)) as r
       )
       or student_documents.role_category::text not in (
         select c from jsonb_array_elements_text(coalesce(p_role_categories, '[]'::jsonb)) as c
       )
     );

  insert into student_documents (student_id, kind, role_category, storage_path, size_bytes)
  select v_student_id,
         'resume'::document_kind,
         (r->>'role_category')::role_category,
         r->>'storage_path',
         (r->>'size_bytes')::int
    from jsonb_array_elements(coalesce(p_resumes, '[]'::jsonb)) as r;

  -- Certificates. Only the undecided ones are the student's to replace.
  delete from student_certificates
   where student_certificates.student_id = v_student_id
     and student_certificates.status <> 'verified';

  insert into student_certificates (student_id, name, document_id)
  select v_student_id,
         c->>'name',
         (v_slots->>(c->>'document_slot'))::uuid
    from jsonb_array_elements(coalesce(p_certificates, '[]'::jsonb)) as c
   where lower(regexp_replace(btrim(c->>'name'), '\s+', ' ', 'g')) not in (
           select lower(regexp_replace(btrim(sc.name), '\s+', ' ', 'g'))
             from student_certificates sc
            where sc.student_id = v_student_id
         );

  return query
    select s.id, s.srf_status from students s where s.id = v_student_id;
end;
$$;

grant execute on function submit_srf(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ------------------------------------------------ deleting a profile resume
-- Replacing a resume means deleting the row it replaces, and 0008 grants only
-- `select, insert, update` - no DELETE on anything. So the replace above needs
-- a grant, and a grant alone would be too wide: `documents_write_self` is a
-- `for all` policy, so DELETE would let a student remove their own MARKSHEETS
-- after a coordinator had verified them against a figure.
--
-- Narrowed to exactly what the student owns: their profile resume for an area.
-- Never a marksheet, never a certificate's document, and never the resume
-- attached to an application - that one is what a recruiter was sent.
grant delete on student_documents to authenticated;

drop policy if exists documents_write_self on student_documents;

create policy documents_insert_self on student_documents for insert
  with check (student_id = current_student_id());

create policy documents_update_self on student_documents for update
  using (student_id = current_student_id())
  with check (student_id = current_student_id());

create policy documents_delete_own_profile_resume on student_documents for delete
  using (
    student_id = current_student_id()
    and kind = 'resume'
    and drive_id is null
  );

-- The student owns their own preferences; staff read them (shortlisting ranks
-- on this, and publishing counts an audience with it). 0008 enabled RLS on
-- every table and this one has never had a policy, because nothing has ever
-- written to it.
-- The table has never had a grant either - nothing has ever written to it, so
-- nothing ever noticed. (A Supabase project also ships `grant all` on the
-- public schema, which is why this can look unnecessary against production and
-- is not: the local schema tests run without that drift.)
grant select, insert, update, delete on student_role_preferences to authenticated;

alter table student_role_preferences enable row level security;
alter table student_role_preferences force  row level security;

drop policy if exists role_preferences_read_self on student_role_preferences;
create policy role_preferences_read_self on student_role_preferences for select
  using (student_id = current_student_id());

drop policy if exists role_preferences_write_self on student_role_preferences;
create policy role_preferences_write_self on student_role_preferences for all
  using (student_id = current_student_id())
  with check (student_id = current_student_id());

drop policy if exists role_preferences_read_staff on student_role_preferences;
create policy role_preferences_read_staff on student_role_preferences for select
  using (
    is_org_reader()
    or (is_campus_staff() and student_id in (select my_student_ids()))
  );
