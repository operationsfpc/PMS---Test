-- Migration 0095: SRF submission notification trigger for CPC
--
-- Notify campus CPC when student submits or resubmits their SRF.
-- Fires AFTER UPDATE on students table when srf_status changes to 'srf_submitted'.

create or replace function notify_cpc_of_srf_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_student_name text;
  v_campus_id uuid;
begin
  -- Only fire when srf_status changes TO 'srf_submitted'
  if new.srf_status <> 'srf_submitted' or old.srf_status = 'srf_submitted' then
    return new;
  end if;

  select s.full_name, s.campus_id
    into v_student_name, v_campus_id
    from students s
   where s.id = new.id;

  -- Notify all campus coordinators for this campus
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
