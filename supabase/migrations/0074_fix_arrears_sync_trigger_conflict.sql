-- 0074: Fix submit_srf returning 400 due to protect_verified_academics conflict.
--
-- 0073 added auto-sync of declared arrears from the latest submitted semester
-- to `students.current_arrears` / `students.history_of_arrears` inside
-- `submit_srf` (security invoker). This fired the `protect_verified_academics`
-- trigger (0020) which unconditionally blocks students from writing those two
-- columns at any time — treating them as coordinator-only figures.
--
-- The original intent of that block was sound for `overall_cgpa` (set by
-- verification), but arrears declared per-semester by the student on the SRF
-- MUST be able to land on the student row for the verification queue and drive
-- eligibility to read them. Locking them only after `srf_approved` is the same
-- rule that already applies to tenth/twelfth percentage and grades.
--
-- Changes:
-- 1. `protect_verified_academics` — move `current_arrears` / `history_of_arrears`
--    from the unconditional "never the student's" check to the "locked after
--    approval" block (mirrors the treatment of school percentages and grades).
-- 2. `submit_srf` — compute arrears from `p_semesters` JSONB directly into variables
--    and update `students` in one shot with safe null handling, preventing check
--    constraint violations or multiple trigger invocations.

create or replace function protect_verified_academics() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_student boolean;
begin
  -- Trusted server context (migrations, service role, admin tooling).
  -- Student requests always carry a JWT; RLS already blocks anonymous writes.
  if auth.uid() is null then
    return new;
  end if;

  is_student := exists (select 1 from students where auth_user_id = auth.uid());

  -- Staff: not linked to any student record.
  if not is_student then
    return new;
  end if;

  -- ---------------------------------------------------------------- status
  -- The one transition a student owns: sending their own form for checking.
  -- Everything else about srf_status remains the coordinator's.
  if new.srf_status is distinct from old.srf_status then
    if not (
      new.srf_status = 'srf_submitted'
      and old.srf_status in ('invited', 'registered', 'srf_rejected')
    ) then
      raise exception 'Verified academic data can only be changed by a placement coordinator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- -------------------------------------------------------------- marks
  -- Their own declaration until approved, locked afterwards.
  -- current_arrears / history_of_arrears are synced from the student's own
  -- semester declarations during SRF submission, so they are treated the same
  -- as tenth/twelfth percentage/grades: the student may write them before approval,
  -- and the coordinator owns them after.
  if old.srf_status = 'srf_approved' then
    if new.tenth_percentage   is distinct from old.tenth_percentage
    or new.twelfth_percentage is distinct from old.twelfth_percentage
    or new.tenth_grade        is distinct from old.tenth_grade
    or new.twelfth_grade      is distinct from old.twelfth_grade
    or new.current_arrears    is distinct from old.current_arrears
    or new.history_of_arrears is distinct from old.history_of_arrears then
      raise exception 'Verified academic data can only be changed by a placement coordinator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- --------------------------------------------------- never the student's
  -- Identity and standing come from the roster and from verification, never
  -- from the form. overall_cgpa is set by the coordinator after checking each
  -- semester; degree_id / branch_id / roll_number come from the roster;
  -- participation_status is an administrative decision.
  if new.overall_cgpa         is distinct from old.overall_cgpa
  or new.degree_id            is distinct from old.degree_id
  or new.branch_id            is distinct from old.branch_id
  or new.roll_number          is distinct from old.roll_number
  or new.participation_status is distinct from old.participation_status then
    raise exception 'Verified academic data can only be changed by a placement coordinator'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;


-- Replace submit_srf to compute arrears directly from p_semesters JSONB safely,
-- updating in the single primary statement with safe null/scale handling.
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
  v_student_id   uuid;
  v_slots        jsonb;
  v_latest_curr  integer;
  v_latest_hist  integer;
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

  -- Pre-extract latest semester arrears with safe defaults
  select
    coalesce((s->>'current_arrears')::int, 0),
    coalesce((s->>'history_of_arrears')::int, 0)
    into v_latest_curr, v_latest_hist
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s
   order by (s->>'semester_number')::int desc
   limit 1;

  if v_latest_curr is null then
    select current_arrears, history_of_arrears
      into v_latest_curr, v_latest_hist
      from students where id = v_student_id;
  end if;

  v_latest_curr := greatest(coalesce(v_latest_curr, 0), 0);
  v_latest_hist := greatest(coalesce(v_latest_hist, 0), v_latest_curr);

  -- Single UPDATE: carries profile, grades, and arrears atomically
  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = nullif(p_student->>'whatsapp', ''),
    alternate_contact     = nullif(p_student->>'alternate_contact', ''),
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = nullif(p_student->>'tenth_percentage', '')::numeric,
    tenth_board           = nullif(p_student->>'tenth_board', '')::school_board,
    tenth_board_state     = nullif(p_student->>'tenth_board_state', ''),
    tenth_board_other     = nullif(p_student->>'tenth_board_other', ''),
    tenth_grade           = nullif(p_student->>'tenth_grade', ''),
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = nullif(p_student->>'twelfth_percentage', '')::numeric,
    twelfth_board         = nullif(p_student->>'twelfth_board', '')::school_board,
    twelfth_board_state   = nullif(p_student->>'twelfth_board_state', ''),
    twelfth_board_other   = nullif(p_student->>'twelfth_board_other', ''),
    twelfth_grade         = nullif(p_student->>'twelfth_grade', ''),
    diploma_institution   = nullif(p_student->>'diploma_institution', ''),
    diploma_university    = nullif(p_student->>'diploma_university', ''),
    diploma_marks         = nullif(p_student->>'diploma_marks', '')::numeric,
    diploma_marks_scale   = nullif(p_student->>'diploma_marks_scale', '')::marks_scale,
    diploma_marksheet_id  = nullif(v_slots->>(p_student->>'diploma_marksheet_slot'), '')::uuid,
    passing_year          = nullif(p_student->>'passing_year', '')::int,
    programme_level       = nullif(p_student->>'programme_level', '')::programme_level,
    ug_degree             = nullif(p_student->>'ug_degree', ''),
    ug_college            = nullif(p_student->>'ug_college', ''),
    ug_branch             = nullif(p_student->>'ug_branch', ''),
    ug_aggregate_declared = nullif(p_student->>'ug_aggregate_declared', '')::numeric,
    ug_aggregate_scale    = nullif(p_student->>'ug_aggregate_scale', '')::marks_scale,
    ug_aggregate_cgpa     = nullif(p_student->>'ug_aggregate_cgpa', '')::numeric,
    ug_marksheet_id       = nullif(v_slots->>(p_student->>'ug_marksheet_slot'), '')::uuid,
    technical_skills      = p_student->>'technical_skills',
    areas_of_interest     = p_student->>'areas_of_interest',
    areas_of_expertise    = p_student->>'areas_of_expertise',
    projects              = p_student->>'projects',
    achievements          = p_student->>'achievements',
    linkedin_url          = nullif(p_student->>'linkedin_url', ''),
    github_url            = nullif(p_student->>'github_url', ''),
    leetcode_url          = nullif(p_student->>'leetcode_url', ''),
    hackerrank_url        = nullif(p_student->>'hackerrank_url', ''),
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    current_arrears       = v_latest_curr,
    history_of_arrears    = v_latest_hist,
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
         coalesce((s->>'current_arrears')::int, 0),
         greatest(coalesce((s->>'history_of_arrears')::int, 0), coalesce((s->>'current_arrears')::int, 0)),
         nullif(v_slots->>(s->>'marksheet_slot'), '')::uuid
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s;

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
         nullif(v_slots->>(c->>'document_slot'), '')::uuid
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

comment on function protect_verified_academics is
  '0074: arrears moved from the unconditional block to the post-approval block '
  'so students can declare their own arrears during SRF submission. '
  'overall_cgpa, degree, branch, roll_number, participation_status remain '
  'always coordinator-owned.';


-- 3. Automatic trigger to keep students.current_arrears and history_of_arrears
-- in sync whenever student_semesters is inserted, updated, or deleted.
create or replace function sync_student_arrears_from_semesters() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student_id uuid;
  v_current_arrears integer;
  v_history_of_arrears integer;
begin
  v_student_id := coalesce(new.student_id, old.student_id);

  select
    coalesce(current_arrears, 0),
    coalesce(history_of_arrears, 0)
    into v_current_arrears, v_history_of_arrears
    from student_semesters
   where student_id = v_student_id
   order by semester_number desc
   limit 1;

  if v_current_arrears is not null then
    update students
       set current_arrears    = greatest(v_current_arrears, 0),
           history_of_arrears = greatest(coalesce(v_history_of_arrears, 0), greatest(v_current_arrears, 0))
     where id = v_student_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_student_arrears_on_semesters_change on student_semesters;
create trigger sync_student_arrears_on_semesters_change
  after insert or update or delete on student_semesters
  for each row execute function sync_student_arrears_from_semesters();

-- 4. Backfill all existing students to match their latest declared semester
update students
   set current_arrears    = latest.current_arrears,
       history_of_arrears = greatest(coalesce(latest.history_of_arrears, 0), coalesce(latest.current_arrears, 0))
  from (
    select distinct on (student_id) student_id, current_arrears, history_of_arrears
      from student_semesters
     order by student_id, semester_number desc
  ) as latest
 where students.id = latest.student_id;

