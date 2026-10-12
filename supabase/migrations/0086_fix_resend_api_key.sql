-- Migration 0086: Fix email dispatch with valid Resend API key
--
-- Problem: Migration 0085 had an invalid/expired API key.
-- 49 emails were marked 'sent' but never reached Resend.
-- 951+ emails are still queued and also failing silently.
--
-- Fix:
-- 1. Update process_email_deliveries_simple with valid API key
-- 2. Reset all 'sent' emails without provider_message_id back to 'queued'
-- 3. Cron job will reprocess them with the correct key

-- 1. Replace function with valid API key
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
  v_api_key text := 're_ecLxihcX_8EW4KqF3KwxceLpJEz9LiVY8';
  v_from text := 'FACE Prep Campus <pms@faceprepcampus.com>';
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

    case lower(coalesce(v_rec.kind, ''))
      when 'welcome' then
        v_title := 'Complete Your Placement Profile';
        v_subtitle := 'Please fill in all the required details to complete your placement profile.';
        v_button := 'Complete Registration';
        v_url := 'https://pms.faceprepcampus.com/srf';
      when 'drive_published' then
        v_title := 'New Placement Drive Announced';
        v_button := 'View Drive & Apply';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'shortlisted' then
        v_title := 'You Are Shortlisted';
        v_button := 'View Application Status';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'round_scheduled' then
        v_title := 'Round Schedule Released';
        v_button := 'View Drive Dashboard';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'round_cleared' then
        v_title := 'Round Cleared';
        v_button := 'View Drive Progress';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'round_not_selected' then
        v_title := 'Application Status Update';
        v_button := 'Explore Open Drives';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'offer' then
        v_title := 'Placement Offer Extended';
        v_button := 'View Offer & Letter';
        v_url := 'https://pms.faceprepcampus.com/student/notifications';
      when 'srf_rejected' then
        v_title := 'Registration Form Requires Changes';
        v_button := 'Open Registration Form';
        v_url := 'https://pms.faceprepcampus.com/srf';
      when 'srf_approved' then
        v_title := 'Placement Profile Approved';
        v_button := 'Explore Open Drives';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'campus_drive_alert', 'cpc_drive_alert' then
        v_title := 'New Campus Placement Drive Active';
        v_button := 'View Drive Cohort';
        v_url := 'https://pms.faceprepcampus.com/cpc/drives';
      when 'verification_queue_digest', 'cpc_verification' then
        v_title := 'Student Profiles Pending Verification';
        v_button := 'Open Verification Queue';
        v_url := 'https://pms.faceprepcampus.com/cpc/verification';
      when 'pif_approved', 'ae_pif_approved' then
        v_title := 'Placement Initiation Form Approved';
        v_button := 'View Sourced Drives';
        v_url := 'https://pms.faceprepcampus.com/my-drives';
      else
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

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    );

    update email_deliveries
       set status = 'sent',
           updated_at = now()
     where id = v_rec.delivery_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- 2. Reset emails that were marked 'sent' but never actually delivered
update email_deliveries
   set status = 'queued',
       updated_at = now()
 where status = 'sent'
   and provider_message_id is null;

-- 3. Log results
do $$
declare
  v_queued_count int;
  v_reset_count int;
begin
  select count(*) into v_queued_count
    from email_deliveries where status = 'queued';
  select count(*) into v_reset_count
    from email_deliveries where status = 'queued' and updated_at > now() - interval '1 minute';

  raise notice 'Migration 0086: Reset % emails to queued. Total queued: %. Cron will process 50/min.', v_reset_count, v_queued_count;
end $$;
