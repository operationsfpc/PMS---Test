-- Submitting the registration form becomes ONE transaction.
--
-- Called out while fixing the re-submission bug (0027), 2026-08-05. The
-- repository wrote the form in four round trips: insert the marksheet rows,
-- update the student, delete the semester lines, insert the new ones.
-- PostgREST gives every request its own transaction, so a failure at step
-- three committed steps one and two and rolled back nothing.
--
-- The live database was found in exactly that state: a student row saying
-- `srf_submitted` while the student was being told - correctly - that
-- submission had failed, and semester lines that were never written.
--
-- A half-submitted form is worse than a failed one. A coordinator opening the
-- queue cannot see that anything is missing, so they verify what is in front
-- of them and sign marks off against evidence that does not exist. And the
-- student cannot repair it, because to them the form simply "did not submit".
--
-- SECURITY INVOKER, deliberately. This is a transaction boundary, not a
-- privilege: RLS, `protect_verified_academics` (0009) and every marksheet
-- ownership trigger (0023, 0024) still judge the caller exactly as they did
-- when the four statements were separate. The only thing that changes is that
-- they now all succeed together or leave nothing behind.
--
-- Business rules stay in src/domain and are applied before the call - CGPA
-- normalisation, profile-link tidying, which marksheets are required. This
-- function decides nothing. It writes, in order, and whitelists what it will
-- write.

create or replace function submit_srf(
  p_student   jsonb,
  p_semesters jsonb,
  p_documents jsonb
)
returns table (student_id uuid, srf_status srf_status)
language plpgsql
-- INVOKER is the whole point; stated rather than left to the default so that
-- nobody "tidies" it into a definer and silently disables every guard above.
security invoker
set search_path = public
as $$
declare
  v_student_id uuid;
  v_slots      jsonb;
begin
  -- Who is calling, from the session - never from the payload. A student may
  -- send whatever they like; it can only ever submit their own form.
  v_student_id := current_student_id();

  if v_student_id is null then
    raise exception 'We could not find your student record. Contact your placement coordinator.'
      using errcode = 'no_data_found';
  end if;

  -- 1. The evidence first, so the marks below have something to point at.
  --    `student_id` is taken from the session, so a payload naming another
  --    student files nothing against them.
  with inserted as (
    insert into student_documents (student_id, kind, storage_path, size_bytes)
    select v_student_id,
           (d->>'kind')::document_kind,
           d->>'storage_path',
           (d->>'size_bytes')::int
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    returning id, storage_path
  )
  -- Marry each new row back to the slot key the form used ("tenth",
  -- "semester-3", ...), so the writes below can reference documents that did
  -- not exist when the payload was built.
  select coalesce(
           jsonb_object_agg(d->>'slot', i.id),
           '{}'::jsonb
         )
    into v_slots
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    join inserted i on i.storage_path = d->>'storage_path';

  -- 2. The student's own row. Every column is named: a field the student does
  --    not own cannot be reached from here even if the payload carries it.
  --    `roll_number`, `campus_id`, `overall_cgpa`, `srf_status` and the rest
  --    are simply absent, and the 0009 trigger remains the backstop.
  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = p_student->>'whatsapp',
    alternate_contact     = p_student->>'alternate_contact',
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = (p_student->>'tenth_percentage')::numeric,
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = (p_student->>'twelfth_percentage')::numeric,
    diploma_institution   = p_student->>'diploma_institution',
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
    certifications        = p_student->>'certifications',
    achievements          = p_student->>'achievements',
    linkedin_url          = p_student->>'linkedin_url',
    github_url            = p_student->>'github_url',
    leetcode_url          = p_student->>'leetcode_url',
    hackerrank_url        = p_student->>'hackerrank_url',
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    consent_given_at      = now(),
    srf_status            = 'srf_submitted',
    srf_submitted_at      = now(),
    -- The draft has served its purpose. Left behind, the next visit would
    -- restore a copy of a form already submitted.
    srf_draft             = null,
    srf_draft_saved_at    = null
  where id = v_student_id;

  -- 3. Semester lines, replaced wholesale: the form shows the student's whole
  --    record, so what is on screen must be what ends up stored. Merging would
  --    silently keep a line the student deleted.
  --
  --    The delete is scoped by 0027 to rows still pending, so a line a
  --    coordinator has verified survives - and the insert below then collides
  --    with it, which is the correct answer to a student trying to replace a
  --    verified mark.
  delete from student_semesters where student_semesters.student_id = v_student_id;

  -- Written AFTER the student row, because the per-level cap trigger (0017)
  -- reads programme_level from it - inserting first would size a
  -- postgraduate's record against the undergraduate limit.
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

  return query
    select s.id, s.srf_status from students s where s.id = v_student_id;
end;
$$;

-- Students are the only callers. Staff edit these records directly, through
-- policies written for them.
grant execute on function submit_srf(jsonb, jsonb, jsonb) to authenticated;
