-- 0048 — The board behind a school mark, who awarded a diploma, and telling a
-- student their form was sent back.
--
-- Three requests from 2026-08-18, in one migration because they touch one
-- function between them (`submit_srf`), and replacing that function twice in
-- two migrations is two chances to lose a field:
--
--   1. "in the student registration form, a field for board has to be added
--      for 10th and 12th standard marks, a field has to be added for capturing
--      the university while entering the diploma marks."
--   3. "the campus placement coordinator should be able to reject the form with
--      comments. The rejected form should come to the students as rejected
--      form. They should be able to edit it and resubmit it."
--
-- Item 3 needed almost nothing HERE: 0020 has permitted the student's
-- srf_rejected -> srf_submitted since long before this, 0042 restricts the
-- decision itself to the campus placement coordinator, and
-- srf_rejection_reason has existed since 0003. What was missing was a button on
-- a screen (shipped alongside) and the one thing a screen cannot do: tell the
-- student without them going to look. That is the notification below.

-- ---------------------------------------------------------------- vocabulary
-- Mirrored by SCHOOL_BOARDS in src/domain/boards.ts, and the pairing is proved
-- by src/db/types-drift.test.ts. Order matters there, so it matters here.
--
-- ONE value for CISCE, not two. It reads ICSE at class 10 and ISC at class 12,
-- and that is a LABEL (`boardLabel`), not a fact about the student: separate
-- enum values would let a student record "ISC" against their tenth and nothing
-- downstream could tell that apart from a real answer.
create type school_board as enum (
  'state_board',
  'cbse',
  'cisce',
  'nios',
  'ib',
  'cambridge',
  'other'
);

-- ------------------------------------------------------------------- columns
-- NULLABLE, and deliberately so. Five students are already registered and
-- three are approved; there is no board on file for any of them, and inventing
-- one would assert a fact nobody has checked against a marksheet. The FORM
-- demands all three (`validateBoardSelection`), so every future submission
-- carries them, and `describeBoard(null)` reads "Not recorded" rather than
-- leaving a blank cell that looks like a claim.
alter table students
  add column if not exists tenth_board          school_board,
  add column if not exists tenth_board_state    text,
  add column if not exists tenth_board_other    text,
  add column if not exists twelfth_board        school_board,
  add column if not exists twelfth_board_state  text,
  add column if not exists twelfth_board_other  text,
  -- Who AWARDED the diploma. "University / Board" on screen: many diplomas come
  -- from a state technical-education board rather than a university, and a
  -- field called "University" invites that student to leave it blank.
  add column if not exists diploma_university   text;

-- --------------------------------------------------------------- constraints
-- BOTH directions, for both boards. A state against CBSE is not harmless
-- noise: it would be stored, shown to a coordinator beside the marksheet, and
-- read as a fact. The same pairs are refused by `validateBoardSelection`, so
-- the form and the database refuse for the same reason and with the same words.
alter table students
  add constraint tenth_board_state_only_for_state_board check (
    tenth_board_state is null or tenth_board = 'state_board'
  ),
  add constraint tenth_board_other_only_for_other check (
    tenth_board_other is null or tenth_board = 'other'
  ),
  add constraint twelfth_board_state_only_for_state_board check (
    twelfth_board_state is null or twelfth_board = 'state_board'
  ),
  add constraint twelfth_board_other_only_for_other check (
    twelfth_board_other is null or twelfth_board = 'other'
  );

-- The other half of each rule - a State Board with no state names 36 boards,
-- and Other with nothing typed names none. NOT NULL cannot express it (the
-- columns are nullable for the students who predate them), so it is stated as a
-- pair: once the board is known, its second answer must be there too.
alter table students
  add constraint tenth_state_board_names_its_state check (
    tenth_board is distinct from 'state_board' or tenth_board_state is not null
  ),
  add constraint tenth_other_board_is_named check (
    tenth_board is distinct from 'other' or tenth_board_other is not null
  ),
  add constraint twelfth_state_board_names_its_state check (
    twelfth_board is distinct from 'state_board' or twelfth_board_state is not null
  ),
  add constraint twelfth_other_board_is_named check (
    twelfth_board is distinct from 'other' or twelfth_board_other is not null
  );

-- ------------------------------------------------------- submit_srf, replaced
-- 0038's body, with seven fields added. Reproduced in full rather than patched
-- because Postgres cannot amend a function in place, and the arity is unchanged
-- so no grant or client call site moves.
create or replace function submit_srf(
  p_student      jsonb,
  p_semesters    jsonb,
  p_documents    jsonb,
  p_certificates jsonb default '[]'::jsonb
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
    -- The board, and the one extra answer it needs. Nothing is coalesced to a
    -- default: an unanswered board must fail the check constraint, not quietly
    -- become a CBSE nobody chose.
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
    -- srf_rejection_reason is deliberately LEFT ALONE. It is what lets the
    -- coordinator see, on the resubmitted form, what they asked for last time;
    -- approval clears it.
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

grant execute on function submit_srf(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ------------------------------------------- the student is told, not left to look
-- A screen can only tell somebody who visits it. A form sent back for changes
-- is the one thing in this flow that REQUIRES the student to act, so it is the
-- last thing that should wait to be noticed.
--
-- SECURITY DEFINER for the reason 0043's triggers are: the coordinator's own
-- UPDATE on `students` fires this, and `notifications` has no insert policy for
-- them - notifications are written by the system, on the student's behalf.
create or replace function notify_student_of_srf_rejection() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.srf_status = 'srf_rejected'
     and old.srf_status is distinct from 'srf_rejected' then

    -- D7's rule, applied here too: an opted-out student is not chased about a
    -- placement process they have left.
    if new.participation_status is distinct from 'opted_out' then
      insert into notifications (student_id, kind, title, body)
      values (
        new.id,
        'srf_rejected',
        'Your registration form was sent back for changes',
        coalesce(
          nullif(btrim(new.srf_rejection_reason), ''),
          'Your coordinator has asked for changes.'
        ) || ' Open your registration form to correct it and submit it again.'
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger notify_student_of_srf_rejection
  after update on students
  for each row execute function notify_student_of_srf_rejection();
