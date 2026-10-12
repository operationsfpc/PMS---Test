-- 0082_notify_students_on_drive_live.sql
--
-- When a drive goes live, eligible students must be notified so they can apply.
-- This migration adds a trigger that:
--   1. Finds all students who meet the drive's eligibility criteria
--   2. Creates a notification for each eligible student
--   3. The existing trigger from 0071 auto-creates email_deliveries
--
-- Eligibility criteria evaluated:
--   - Campus targeting (drive_target_campuses)
--   - Degree targeting (drive_eligible_degrees)
--   - Branch targeting (drive_eligible_branches)
--   - Passing year (eligible_passing_years)
--   - Minimum CGPA (min_overall_cgpa)
--   - Minimum 10th percentage (min_tenth_percentage)
--   - Minimum 12th percentage (min_twelfth_percentage)
--   - Arrears policy (arrears_policy)
--   - SRF status (srf_approved only)
--   - Participation status (active only, not opted_out or disbarred)

create or replace function notify_eligible_students_on_drive_live()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_student_rec record;
  v_notification_id uuid;
  v_drive_title text;
  v_body text;
  v_ctc_display text;
  v_students_notified integer := 0;
begin
  -- Only fire when status transitions TO 'live'
  if new.status <> 'live' or (tg_op = 'update' and old.status is not distinct from 'live') then
    return new;
  end if;

  -- Format CTC display
  if new.ctc_min_lpa is not null and new.ctc_max_lpa is not null then
    if new.ctc_min_lpa = new.ctc_max_lpa then
      v_ctc_display := new.ctc_min_lpa::text || ' LPA';
    else
      v_ctc_display := new.ctc_min_lpa::text || ' - ' || new.ctc_max_lpa::text || ' LPA';
    end if;
  else
    v_ctc_display := 'As per policy';
  end if;

  v_drive_title := new.company_name || ' — ' || coalesce(new.role_title, 'Placement Opportunity');

  -- Find all eligible students
  for v_student_rec in
    select distinct s.id, s.full_name, s.email
      from students s
     where s.srf_status = 'srf_approved'
       and s.participation_status = 'active'
       -- Campus targeting: if drive has target campuses, student must be in one
       and (
         not exists (select 1 from drive_target_campuses dtc where dtc.drive_id = new.id)
         or exists (
           select 1 from drive_target_campuses dtc
            where dtc.drive_id = new.id
              and dtc.campus_id = s.campus_id
         )
       )
       -- Degree targeting: if drive has eligible degrees, student must have one
       and (
         not exists (select 1 from drive_eligible_degrees ded where ded.drive_id = new.id)
         or exists (
           select 1 from drive_eligible_degrees ded
            where ded.drive_id = new.id
              and ded.degree_id = s.degree_id
         )
       )
       -- Branch targeting: if drive has eligible branches, student must have one
       and (
         not exists (select 1 from drive_eligible_branches deb where deb.drive_id = new.id)
         or exists (
           select 1 from drive_eligible_branches deb
            where deb.drive_id = new.id
              and deb.branch_id = s.branch_id
         )
       )
       -- Passing year
       and (
         array_length(new.eligible_passing_years, 1) is null
         or s.passing_year = any(new.eligible_passing_years)
       )
       -- Minimum CGPA
       and (
         new.min_overall_cgpa is null
         or s.overall_cgpa >= new.min_overall_cgpa
       )
       -- Minimum 10th percentage
       and (
         new.min_tenth_percentage is null
         or s.tenth_percentage >= new.min_tenth_percentage
       )
       -- Minimum 12th percentage
       and (
         new.min_twelfth_percentage is null
         or s.twelfth_percentage >= new.min_twelfth_percentage
       )
       -- Arrears policy
       and (
         new.arrears_policy = 'flexible'
         or (new.arrears_policy = 'no_arrears' and s.current_arrears = 0 and s.history_of_arrears = 0)
         or (new.arrears_policy = 'no_active_arrears' and s.current_arrears = 0)
       )
  loop
    -- Build notification body
    v_body := 'A new placement drive is now open for applications at your campus.' || E'\n\n' ||
              '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n';

    if new.application_end is not null then
      v_body := v_body || '**Application Deadline:** ' || to_char(new.application_end, 'DD Mon YYYY, HH12:MI AM') || E'\n';
    end if;

    v_body := v_body || E'\n' || 'Log in to the portal to view full details and submit your application.';

    -- Insert notification (trigger from 0071 will auto-create email_delivery)
    insert into notifications (student_id, kind, title, body, drive_id)
    values (
      v_student_rec.id,
      'drive_published',
      'New Drive: ' || v_drive_title,
      v_body,
      new.id
    )
    returning id into v_notification_id;

    v_students_notified := v_students_notified + 1;
  end loop;

  -- Log for debugging (visible in Postgres logs)
  raise notice 'Drive % went live: notified % eligible students', new.id, v_students_notified;

  return new;
end;
$$;

drop trigger if exists notify_eligible_students_on_drive_live on drives;
create trigger notify_eligible_students_on_drive_live
  after insert or update of status on drives
  for each row execute function notify_eligible_students_on_drive_live();

comment on trigger notify_eligible_students_on_drive_live on drives is
  'Notifies all eligible students when a drive goes live. Creates notifications which auto-enqueue emails via 0071.';
