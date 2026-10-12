-- Migration 0087: Fix all schema mismatches
-- 
-- Issues fixed:
-- 1. Migration 0082 trigger uses wrong enum values ('no_arrears', 'no_active_arrears')
--    Should use: 'no_history' (strictest) and 'no_standing' (no current arrears)
-- 2. Email dispatch function missing notification kind handlers

-- ============================================================================
-- FIX 1: Correct arrear_policy enum values in migration 0082 trigger
-- ============================================================================
-- Migration 0082 uses:
--   'no_arrears' (current=0 AND history=0) → should be 'no_history'
--   'no_active_arrears' (current=0) → should be 'no_standing'

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
       -- Campus targeting
       and (
         not exists (select 1 from drive_target_campuses dtc where dtc.drive_id = new.id)
         or exists (
           select 1 from drive_target_campuses dtc
            where dtc.drive_id = new.id
              and dtc.campus_id = s.campus_id
         )
       )
       -- Degree targeting
       and (
         not exists (select 1 from drive_eligible_degrees ded where ded.drive_id = new.id)
         or exists (
           select 1 from drive_eligible_degrees ded
            where ded.drive_id = new.id
              and ded.degree_id = s.degree_id
         )
       )
       -- Branch targeting
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
       -- Arrears policy (FIXED: use correct enum values)
       and (
         new.arrears_policy = 'flexible'
         or (new.arrears_policy = 'no_history' and s.current_arrears = 0 and s.history_of_arrears = 0)
         or (new.arrears_policy = 'no_standing' and s.current_arrears = 0)
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

    -- Insert notification
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

  raise notice 'Drive % went live: notified % eligible students', new.id, v_students_notified;

  return new;
end;
$$;

-- ============================================================================
-- FIX 2: Update email dispatch to handle ALL notification kinds
-- ============================================================================
-- The database uses these notification kinds:
-- - welcome (handled)
-- - srf_approved (MISSING)
-- - srf_rejected (MISSING)
-- - drive_published (handled)
-- - shortlisted (handled)
-- - round_scheduled (MISSING)
-- - round_cleared (MISSING)
-- - round_not_selected (MISSING)
-- - offer (MISSING)
-- - campus_drive_alert (handled)
-- - cpc_drive_alert (handled)

create or replace function process_email_deliveries_simple(p_batch_limit int default 50)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_rec record;
  v_count int := 0;
  v_title text;
  v_subtitle text;
  v_button text;
  v_url text;
  v_recipient_name text;
  v_html text;
  v_payload jsonb;
  v_api_key text := 're_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp';
  v_from text := 'FACE Prep Campus <onboarding@resend.dev>';
begin
  for v_rec in
    select d.id as delivery_id,
           d.recipient_email,
           n.kind,
           n.title as notif_title,
           n.body as notif_body,
           s.full_name as student_name,
           p.full_name as profile_name
      from email_deliveries d
      left join notifications n on n.id = d.notification_id
      left join students s on s.id = n.student_id
      left join profiles p on lower(p.email) = lower(d.recipient_email)
     where d.status = 'queued'
     order by d.updated_at asc
     limit p_batch_limit
     for update of d skip locked
  loop
    v_recipient_name := coalesce(
      nullif(trim(v_rec.student_name), ''),
      nullif(trim(v_rec.profile_name), ''),
      'Candidate'
    );
    
    v_title := coalesce(v_rec.notif_title, 'Placement Notification');
    v_subtitle := null;
    v_button := 'View on PMS Portal';
    v_url := 'https://pms.faceprepcampus.com/student';

    -- Handle ALL notification kinds used in the database
    case lower(coalesce(v_rec.kind, ''))
      when 'welcome' then
        v_title := 'Complete Your Placement Profile';
        v_subtitle := 'Please fill in all the required details to complete your placement profile.';
        v_button := 'Complete Registration';
        v_url := 'https://pms.faceprepcampus.com/srf';
        
      when 'srf_approved' then
        v_title := 'Profile Verified: You Are Now Eligible for Placement Drives';
        v_subtitle := 'Your SRF and marksheets have been verified. You can now apply to drives.';
        v_button := 'View Available Drives';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'srf_rejected' then
        v_title := 'Profile Verification Requires Attention';
        v_subtitle := 'Please review the feedback and update your profile.';
        v_button := 'Update Profile';
        v_url := 'https://pms.faceprepcampus.com/srf';
        
      when 'drive_published' then
        v_title := 'New Placement Drive Announced';
        v_button := 'View Drive & Apply';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'shortlisted' then
        v_title := 'You Are Shortlisted';
        v_subtitle := 'You have been shortlisted for the next round.';
        v_button := 'View Application Status';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'round_scheduled' then
        v_title := 'Round Scheduled';
        v_subtitle := 'A new round has been scheduled for your application.';
        v_button := 'View Round Details';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'round_cleared' then
        v_title := 'Congratulations! You Cleared the Round';
        v_subtitle := 'You have advanced to the next round.';
        v_button := 'View Next Steps';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'round_not_selected' then
        v_title := 'Application Update';
        v_subtitle := 'Unfortunately, you were not selected for the next round.';
        v_button := 'View Status';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'offer' then
        v_title := 'Offer Letter Available';
        v_subtitle := 'You have received an offer. View the details now.';
        v_button := 'View Offer';
        v_url := 'https://pms.faceprepcampus.com/student/offers';
        
      when 'campus_drive_alert', 'cpc_drive_alert' then
        v_title := 'New Campus Placement Drive Active';
        v_button := 'View Drive Cohort';
        v_url := 'https://pms.faceprepcampus.com/cpc/drives';
        
      else
        -- Fallback: use the notification title as-is
        null;
    end case;

    v_html := build_notification_email_html(
      coalesce(v_rec.notif_title, v_title),
      v_title,
      v_subtitle,
      v_recipient_name,
      v_rec.notif_body,
      v_button,
      v_url
    );

    v_payload := jsonb_build_object(
      'from', v_from,
      'to', jsonb_build_array(v_rec.recipient_email),
      'reply_to', 'placements@faceprep.in',
      'subject', coalesce(v_rec.notif_title, v_title),
      'html', v_html
    );

    -- Make async API call via pg_net
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    );

    -- Mark as sent (pg_net is async, we trust the call was made)
    update email_deliveries
       set status = 'sent',
           updated_at = now()
     where id = v_rec.delivery_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Update cron job to use the fixed function
do $$
begin
  perform cron.unschedule('dispatch-emails-simple');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'dispatch-emails-fixed',
  '* * * * *',
  'select process_email_deliveries_simple(50);'
);

-- ============================================================================
-- Summary
-- ============================================================================
comment on function process_email_deliveries_simple is
  'Fixed: handles all 11 notification kinds used in the database (was missing 6 kinds)';
