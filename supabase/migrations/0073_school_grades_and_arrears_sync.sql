-- 0073 — School grades for Cambridge/Other boards, and syncing declared arrears on SRF submission.
--
-- 1. Cambridge International (IGCSE/O-Level/A-Level) and Other boards evaluate on
--    letter/scale grades rather than percentages. The SRF collects tenth_grade and
--    twelfth_grade, which must be stored on `students` so campus coordinators can
--    verify them against the uploaded Statement of Results.
-- 2. When a student declares semesters on the SRF, their current and history of arrears
--    are entered per semester. Syncing the latest semester's arrears to `students`
--    ensures the verification queue and reporting accurately display declared standing arrears.

alter table students
  add column if not exists tenth_grade   text,
  add column if not exists twelfth_grade text;

-- Replace submit_srf to store tenth_grade and twelfth_grade, and sync declared arrears.
create or replace function submit_srf(
  p_student          jsonb,
  p_semesters        jsonb,
  p_documents        jsonb,
  p_certificates     jsonb default '[]'::jsonb,
  p_role_categories  jsonb default '[]'::jsonb,
  p_resumes          jsonb default '[]'::jsonb
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
    tenth_grade           = p_student->>'tenth_grade',
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = (p_student->>'twelfth_percentage')::numeric,
    twelfth_board         = (p_student->>'twelfth_board')::school_board,
    twelfth_board_state   = p_student->>'twelfth_board_state',
    twelfth_board_other   = p_student->>'twelfth_board_other',
    twelfth_grade         = p_student->>'twelfth_grade',
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

  -- Sync declared arrears onto the student record from the latest declared semester
  update students
     set current_arrears    = latest.current_arrears,
         history_of_arrears = latest.history_of_arrears
    from (
      select current_arrears, history_of_arrears
        from student_semesters
       where student_id = v_student_id
       order by semester_number desc
       limit 1
    ) as latest
   where id = v_student_id;

  -- ------------------------------------------------------------ preferences
  delete from student_role_preferences
   where student_role_preferences.student_id = v_student_id;

  insert into student_role_preferences (student_id, category)
  select v_student_id, c::role_category
    from jsonb_array_elements_text(coalesce(p_role_categories, '[]'::jsonb)) as c
  on conflict do nothing;

  -- --------------------------------------------------------------- resumes
  delete from student_documents
   where student_documents.student_id = v_student_id
     and student_documents.kind = 'resume'
     and student_documents.drive_id is null
     and (
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

-- Backfill existing students so their current_arrears and history_of_arrears
-- match the declared values from their latest semester.
update students
   set current_arrears    = latest.current_arrears,
       history_of_arrears = latest.history_of_arrears
  from (
    select distinct on (student_id) student_id, current_arrears, history_of_arrears
      from student_semesters
     order by student_id, semester_number desc
  ) as latest
 where students.id = latest.student_id;

