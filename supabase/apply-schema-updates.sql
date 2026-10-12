-- ============================================================================
-- Consolidated schema update: migrations 0097-0101
-- Safe to run multiple times - all operations are idempotent.
-- Run this in Supabase Dashboard > SQL Editor.
-- ============================================================================

-- ============================================================================
-- SCHEMA CHECKS: verify prerequisites exist before applying changes
-- ============================================================================
do $$
begin
  -- Check required tables
  if not exists (select 1 from information_schema.tables where table_name = 'notifications') then
    raise exception 'Missing required table: notifications';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'opt_out_requests') then
    raise exception 'Missing required table: opt_out_requests';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'students') then
    raise exception 'Missing required table: students';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'profiles') then
    raise exception 'Missing required table: profiles';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'staff_campus_assignments') then
    raise exception 'Missing required table: staff_campus_assignments';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'staff_campus_invitations') then
    raise exception 'Missing required table: staff_campus_invitations';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'drive_rounds') then
    raise exception 'Missing required table: drive_rounds';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'attendance') then
    raise exception 'Missing required table: attendance';
  end if;
  if not exists (select 1 from information_schema.tables where table_name = 'round_participants') then
    raise exception 'Missing required table: round_participants';
  end if;

  -- Check required enum type
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    raise exception 'Missing required type: attendance_status';
  end if;

  raise notice 'Schema checks passed. Applying migrations 0097-0101...';
end $$;

-- ============================================================================
-- 0097: Fix notification trigger bugs
-- ============================================================================
-- 1) notify_cpc_of_opt_out_submission: new.reason could be NULL, which makes
--    the entire body NULL via PostgreSQL's NULL concatenation. Fixed with coalesce.
-- 2) notify_cpc_of_srf_submission: trigger is ON students but re-queried the
--    students table instead of using NEW directly. Removed the redundant join.

create or replace function notify_cpc_of_opt_out_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_student_name text;
  v_campus_id uuid;
begin
  select s.full_name, s.campus_id
    into v_student_name, v_campus_id
    from students s
   where s.id = new.student_id;

  insert into notifications (student_id, kind, title, body)
  select p.id, 'opt_out_submitted',
    'Opt-Out Request Submitted',
    v_student_name || ' has submitted a request to opt out of campus placement drives.' ||
    E'\n\nReason: ' || coalesce(new.reason, 'Not provided') ||
    E'\n\nPlease review this request under /cpc/opt-outs.'
  from profiles p
  where p.role = 'campus_placement_coordinator'
    and exists (
      select 1 from staff_campus_assignments sca
      where sca.profile_id = p.id and sca.campus_id = v_campus_id
    );

  return new;
end;
$$;

drop trigger if exists notify_cpc_of_opt_out_submission on opt_out_requests;
create trigger notify_cpc_of_opt_out_submission
  after insert on opt_out_requests
  for each row execute function notify_cpc_of_opt_out_submission();

create or replace function notify_cpc_of_srf_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_student_name text;
  v_campus_id uuid;
begin
  if new.srf_status <> 'srf_submitted' or old.srf_status = 'srf_submitted' then
    return new;
  end if;

  v_student_name := new.full_name;
  v_campus_id := new.campus_id;

  insert into notifications (student_id, kind, title, body)
  select p.id, 'srf_submitted',
    'SRF Submitted for Verification',
    v_student_name || ' has submitted their Student Registration Form (SRF) for verification.' ||
    E'\n\n**Roll Number:** ' || coalesce(new.roll_number, 'Not provided') ||
    E'\n\nPlease review and verify the submission under /cpc/verification.'
  from profiles p
  where p.role = 'campus_placement_coordinator'
    and exists (
      select 1 from staff_campus_assignments sca
      where sca.profile_id = p.id and sca.campus_id = v_campus_id
    );

  return new;
end;
$$;

drop trigger if exists notify_cpc_of_srf_submission on students;
create trigger notify_cpc_of_srf_submission
  after update on students
  for each row execute function notify_cpc_of_srf_submission();

-- 0097 applied: notification trigger fixes

-- ============================================================================
-- 0098: Atomic campus assignment replacement
-- ============================================================================
-- Problem: setCampuses() deletes all assignments, then inserts new ones.
-- If the insert fails after the delete commits, the staff member has no campuses.
-- Fix: a single function that does both in one transaction.

create or replace function set_staff_campus_assignments(
  p_profile_id uuid,
  p_campus_ids uuid[]
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from staff_campus_assignments where profile_id = p_profile_id;
  insert into staff_campus_assignments (profile_id, campus_id)
  select p_profile_id, unnest(p_campus_ids);
end;
$$;

create or replace function set_staff_campus_invitations(
  p_email text,
  p_campus_ids uuid[]
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from staff_campus_invitations where email = p_email;
  insert into staff_campus_invitations (email, campus_id)
  select p_email, unnest(p_campus_ids);
end;
$$;

-- 0098 applied: atomic campus assignment functions

-- ============================================================================
-- 0099: Atomic round removal with renumbering
-- ============================================================================
-- Problem: removeRound() reads all rounds, deletes one, then renumbers.
-- Two coordinators removing rounds simultaneously can produce conflicting sequences.
-- Fix: a single function that deletes and renumbers in one transaction.

create or replace function remove_drive_round(p_round_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_drive_id uuid;
begin
  select drive_id into v_drive_id from drive_rounds where id = p_round_id;
  if v_drive_id is null then
    raise exception 'Round not found';
  end if;

  delete from drive_rounds where id = p_round_id;

  update drive_rounds
  set sequence = new_seq
  from (
    select id, row_number() over (order by sequence) as new_seq
    from drive_rounds
    where drive_id = v_drive_id
  ) as renumbered
  where drive_rounds.id = renumbered.id
    and drive_rounds.sequence <> renumbered.new_seq;
end;
$$;

-- 0099 applied: atomic round removal function

-- ============================================================================
-- 0100: Atomic batch attendance save
-- ============================================================================
-- Problem: attendance saved one student at a time in a loop.
-- Network failure partway leaves some recorded and others not.
-- Fix: a single function that updates all in one transaction.

create or replace function save_batch_attendance(
  p_round_id uuid,
  p_entries jsonb,
  p_marked_by uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update attendance a
  set status = (entry->>'status')::attendance_status,
      marked_by = p_marked_by,
      marked_at = now()
  from jsonb_array_elements(p_entries) as entry
  where a.round_id = p_round_id
    and a.application_id = (entry->>'applicationId')::uuid;
end;
$$;

-- 0100 applied: atomic batch attendance function

-- ============================================================================
-- 0101: Atomic participant scheduling with attendance rows
-- ============================================================================
-- Problem: scheduleParticipants() inserts into round_participants first,
-- then into attendance. If the attendance insert fails, participants are
-- scheduled but have no attendance rows (un-markable).
-- Fix: a single function that does both inserts in one transaction.

create or replace function schedule_round_participants(
  p_round_id uuid,
  p_application_ids uuid[],
  p_added_by uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into round_participants (round_id, application_id, added_by)
  select p_round_id, unnest(p_application_ids), p_added_by;

  insert into attendance (round_id, application_id, status)
  select p_round_id, unnest(p_application_ids), 'scheduled'::attendance_status;
end;
$$;

-- 0101 applied: atomic participant scheduling function

-- ============================================================================
-- All migrations 0097-0101 applied successfully.
-- ============================================================================
