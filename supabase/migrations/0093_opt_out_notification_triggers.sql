-- Migration 0093: Opt-out notification triggers
--
-- Two triggers:
-- 1) Notify student when opt-out is approved or declined (AFTER UPDATE on status)
-- 2) Notify CPC when student submits opt-out (AFTER INSERT)

-- 1. Notify student when opt-out decision is made
create or replace function notify_student_of_opt_out_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_title text;
  v_body text;
begin
  -- Only fire when status changes from pending to verified or rejected
  if old.status = new.status or old.status <> 'pending' then
    return new;
  end if;

  if new.status = 'verified' then
    v_title := 'Opt-Out Request Approved';
    v_body := 'Your request to opt out of campus placement drives has been approved. You will no longer be considered for on-campus recruitment opportunities.';
  elsif new.status = 'rejected' then
    v_title := 'Opt-Out Request Declined';
    v_body := 'Your request to opt out has been declined.' ||
      case when new.reason is not null and length(trim(new.reason)) > 0
        then E'\n\nReason: ' || new.reason
        else ''
      end ||
      E'\n\nYou remain eligible for campus placement drives. Contact your placement coordinator if you have questions.';
  else
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (new.student_id, 'opt_out_confirmed', v_title, v_body);

  return new;
end;
$$;

drop trigger if exists notify_student_of_opt_out_decision on opt_out_requests;
create trigger notify_student_of_opt_out_decision
  after update on opt_out_requests
  for each row execute function notify_student_of_opt_out_decision();

-- 2. Notify CPC when student submits opt-out
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

  -- Notify all campus coordinators for this campus
  insert into notifications (student_id, kind, title, body)
  select p.id, 'opt_out_submitted',
    'Opt-Out Request Submitted',
    v_student_name || ' has submitted a request to opt out of campus placement drives.' ||
    E'\n\nReason: ' || new.reason ||
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
