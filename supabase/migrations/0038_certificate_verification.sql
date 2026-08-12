-- A certificate is verified by the coordinator, like a CGPA. Asked for
-- 2026-08-06: "skill certifications uploaded by students will also need
-- verification of campus placement coordinator similar to CGPA approval. This
-- is applicable for first upload as well as subsequent additions."
--
-- 0034 stored a name and a document and stopped there. Nothing recorded
-- whether anybody had ever opened the file, so a recruiter reading a profile
-- could not tell a checked certificate from a claim typed a minute earlier -
-- and the coordinator had no screen on which to check one.
--
-- Decided PER CERTIFICATE, not folded into the registration form's approval
-- the way semesters are (0031). A certificate can arrive at any time: the
-- profile page has accepted one since F20, including the day after approval.
-- Verifying at approval would have left every later upload with no path at
-- all, and "subsequent additions" is half the request.

alter table student_certificates
  add column status           verification_status not null default 'pending',
  add column verified_by      uuid references profiles(id),
  add column verified_at      timestamptz,
  add column rejection_reason text;

-- Mirrors student_semesters' own `verified_has_verifier`: a verified claim
-- must name who made it, or the audit trail cannot answer "who checked this".
alter table student_certificates
  add constraint certificate_verified_has_verifier
    check (status <> 'verified' or verified_by is not null);

-- F1's rule, and for the same reason: the reason is the only thing the
-- student is told, so a rejection without one is not a decision they can act
-- on. `btrim` because a space is not a reason.
alter table student_certificates
  add constraint certificate_rejected_has_reason
    check (status <> 'rejected' or btrim(coalesce(rejection_reason, '')) <> '');

create index student_certificates_pending_idx
  on student_certificates (status) where status = 'pending';

-- Existing certificates are unverified claims - nobody has ever checked one,
-- because until now there was nowhere to do it. `pending` is the honest
-- default and puts them all in the queue, which is what was asked for.

-- The decision itself. Campus staff for their own students, operators
-- org-wide; the same shape as every other student-scoped write (0018).
create policy staff_decides_certificates
  on student_certificates for update
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));

-- 0034 granted select/insert/delete only, so verification was not merely
-- unpoliced - it was ungranted. A policy alone would still have failed.
grant update on student_certificates to authenticated;

-- Q4 applied to certificates: verified data is not the student's to remove.
-- Deleting one would also destroy the coordinator's record of having checked
-- it. A rejected one they may remove - that is how a replacement is made.
drop policy student_removes_own_certificates on student_certificates;

create policy student_removes_own_certificates
  on student_certificates for delete
  using (student_id = current_student_id() and status <> 'verified');

-- 0034 never audited this table. A verification is a claim a named person
-- made about a document, which is exactly what PRD §19 exists to record.
create trigger audit_certificates
  after insert or update or delete on student_certificates
  for each row execute function audit_row();

comment on column student_certificates.status is
  'Verified by the campus coordinator, like a CGPA (2026-08-06). Applies to the first upload and every later one.';

-- ---------------------------------------------------------------------------
-- submit_srf, around a verified certificate.
--
-- 0035 replaced the certificate list wholesale: delete everything, insert the
-- payload. Both halves break the moment a certificate can be verified.
--
--   1. The delete would destroy the coordinator's decision. The new delete
--      policy stops the student's own DELETE, but this function is SECURITY
--      INVOKER, so it would simply match nothing - RLS is a filter, not an
--      error.
--   2. The insert would then re-declare that same certificate and collide
--      with `one_certificate_per_name`, raising 23505 and failing the WHOLE
--      submission.
--
-- (2) is not hypothetical. It is precisely what made the SRF unsubmittable
-- for every student before 0027: an RLS-filtered delete matching nothing,
-- followed by a unique violation with no visible cause. Eight 409s in the
-- edge logs and one useless "please try again" on screen.
--
-- So: delete only what is still undecided, and insert only what is not
-- already on file. A verified certificate survives a re-submission untouched,
-- and re-declaring it is a no-op rather than a failure.
--
-- This deliberately differs from the semester lines a few statements above,
-- where the collision IS the answer. A semester is only ever verified at
-- approval, after which the form is read-only, so a verified line and a
-- re-submission cannot co-occur. A certificate is verified on its own
-- schedule, so they co-occur constantly.
--
-- The body is 0035's, unchanged apart from the certificate block. Reproduced
-- rather than patched because Postgres cannot amend a function in place.
-- ---------------------------------------------------------------------------

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

  -- Certificates. Only the undecided ones are the student's to replace.
  delete from student_certificates
   where student_certificates.student_id = v_student_id
     and student_certificates.status <> 'verified';

  -- Only what is not already on file. Compared exactly as
  -- `one_certificate_per_name` compares it, so the guard and the check can
  -- never disagree about whether two names are the same certificate.
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
