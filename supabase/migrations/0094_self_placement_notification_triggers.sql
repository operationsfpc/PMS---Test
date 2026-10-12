-- Migration 0094: Self-placement notification triggers
--
-- Two triggers:
-- 1) Notify student when self-placement is approved or declined (AFTER UPDATE on status)
-- 2) Notify CPC when student submits self-placement proof (AFTER INSERT)

-- 1. Notify student when self-placement decision is made
create or replace function notify_student_of_self_placement_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_body text;
begin
  -- Only fire when status changes from pending to verified or rejected
  if old.status = new.status or old.status <> 'pending' then
    return new;
  end if;

  if new.status = 'verified' then
    v_title := 'Self-Placement Offer Approved';
    v_body := 'Your self-placement offer from **' || new.company_name || '** has been approved.' ||
      E'\n\n**Role:** ' || coalesce(new.role_title, 'Not specified') ||
      case
        when new.ctc_lpa is not null then E'\n**CTC:** ₹' || new.ctc_lpa || ' LPA'
        when new.stipend_monthly is not null then E'\n**Stipend:** ₹' || new.stipend_monthly || '/month'
        else ''
      end ||
      E'\n\nYour placement record has been updated.';
  elsif new.status = 'rejected' then
    v_title := 'Self-Placement Offer Declined';
    v_body := 'Your self-placement offer from **' || new.company_name || '** has been declined.';
  else
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (new.student_id, 'self_placement_decision', v_title, v_body);

  return new;
end;
$$;

drop trigger if exists notify_student_of_self_placement_decision on self_placement_requests;
create trigger notify_student_of_self_placement_decision
  after update on self_placement_requests
  for each row execute function notify_student_of_self_placement_decision();

-- 2. Notify CPC when student submits self-placement proof
create or replace function notify_cpc_of_self_placement_submission()
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
  select p.id, 'self_placement_submitted',
    'Self-Placement Proof Submitted',
    v_student_name || ' has submitted a self-placement offer proof.' ||
    E'\n\n**Company:** ' || new.company_name ||
    E'\n**Role:** ' || coalesce(new.role_title, 'Not specified') ||
    E'\n\nPlease review this submission under /cpc/off-campus.'
  from profiles p
  where p.role = 'campus_placement_coordinator'
    and exists (
      select 1 from staff_campus_assignments sca
      where sca.profile_id = p.id and sca.campus_id = v_campus_id
    );

  return new;
end;
$$;

drop trigger if exists notify_cpc_of_self_placement_submission on self_placement_requests;
create trigger notify_cpc_of_self_placement_submission
  after insert on self_placement_requests
  for each row execute function notify_cpc_of_self_placement_submission();
