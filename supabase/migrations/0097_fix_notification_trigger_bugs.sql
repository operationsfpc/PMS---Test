-- Migration 0097: Fix notification trigger bugs
--
-- 1) notify_cpc_of_opt_out_submission: new.reason could be NULL, which makes
--    the entire body NULL via PostgreSQL's NULL concatenation. Fixed with
--    coalesce.
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
