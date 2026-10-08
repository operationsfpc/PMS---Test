-- 0076_student_lifecycle_email_triggers.sql
--
-- Student lifecycle notification triggers and email outbox guarantee.
-- Ensures student communications adhere strictly to the email template standard:
--   - S1: Student Welcome & Registration invitation on roster import (srf_status = 'invited')
--   - S14: Student Profile Verified & Approved (srf_status = 'srf_approved')
--   - Outbox Trigger: Every student notification stages a queued row in email_deliveries
--     for dispatch via the canonical HTML template.

-- 1. Ensure email outbox trigger is active on notifications
create or replace function enqueue_notification_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_opted boolean;
begin
  select email, (participation_status = 'opted_out')
    into v_email, v_opted
    from students
   where id = new.student_id;

  -- Opted-out students or missing emails do not receive email
  if v_opted or v_email is null or trim(v_email) = '' then
    return new;
  end if;

  insert into email_deliveries (notification_id, recipient_email, status)
  values (new.id, lower(trim(v_email)), 'queued');

  return new;
end;
$$;

drop trigger if exists notification_enqueues_email on notifications;
create trigger notification_enqueues_email
  after insert on notifications
  for each row execute function enqueue_notification_email();

-- 2. S1: Student Roster Welcome & Registration Form (SRF) Invitation
create or replace function notify_student_of_roster_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_campus text;
  v_degree text;
  v_branch text;
  v_degree_branch text;
begin
  if new.srf_status = 'invited' and (tg_op = 'INSERT' or old.srf_status is distinct from 'invited') then
    if new.participation_status = 'opted_out' then
      return new;
    end if;

    select c.name into v_campus from campuses c where c.id = new.campus_id;
    select d.name into v_degree from degrees d where d.id = new.degree_id;
    select b.name into v_branch from branches b where b.id = new.branch_id;

    v_degree_branch := coalesce(v_degree, 'Not specified');
    if v_branch is not null and length(trim(v_branch)) > 0 then
      v_degree_branch := v_degree_branch || ' — ' || trim(v_branch);
    end if;

    insert into notifications (student_id, kind, title, body)
    values (
      new.id,
      'welcome',
      'Welcome to FACE Prep Campus Placements — Complete Your Profile',
      'Your placement account for **' || coalesce(v_campus, 'your campus') || '** is now active on the FACE Prep Campus Placement Management System.' || E'\n\n' ||
      'To participate in upcoming placement and internship drives, please complete your Student Registration Form (SRF) and upload your verified academic records.' || E'\n\n' ||
      '**Your Record**' || E'\n' ||
      '• **Roll Number:** ' || coalesce(new.roll_number, 'N/A') || E'\n' ||
      '• **Degree & Branch:** ' || v_degree_branch || E'\n' ||
      '• **Passing Year:** ' || coalesce(new.passing_year::text, 'N/A') || E'\n\n' ||
      'Please sign in with your registered Google account to complete your profile.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_student_of_roster_invitation on students;
create trigger notify_student_of_roster_invitation
  after insert or update of srf_status on students
  for each row execute function notify_student_of_roster_invitation();

-- 3. S14: Student Profile Verified & Approved
create or replace function notify_student_of_srf_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.srf_status = 'srf_approved' and (tg_op = 'INSERT' or old.srf_status is distinct from 'srf_approved') then
    if new.participation_status = 'opted_out' then
      return new;
    end if;

    insert into notifications (student_id, kind, title, body)
    values (
      new.id,
      'srf_approved',
      'Profile Verified: You Are Now Eligible for Placement Drives',
      'Great news! Your Student Registration Form (SRF) and uploaded marksheets have been verified and approved by your Campus Placement Coordinator.' || E'\n\n' ||
      '**Verified Academic Record**' || E'\n' ||
      '• **Status:** Active & Eligible' || E'\n\n' ||
      'You are now eligible to participate in upcoming campus placement and internship drives matching your profile.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_student_of_srf_approval on students;
create trigger notify_student_of_srf_approval
  after insert or update of srf_status on students
  for each row execute function notify_student_of_srf_approval();
