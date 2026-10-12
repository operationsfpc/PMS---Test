-- Migration 0084: Fix email dispatch to properly track Resend responses
--
-- Problem: Migration 0078 uses pg_net fire-and-forget, marking emails as 'sent'
-- without checking if Resend API succeeded.
--
-- Solution: Use pg_net's response tracking to verify delivery before marking as sent.

create or replace function process_email_deliveries_fixed(p_batch_limit int default 50)
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
  v_from text := 'FACE Prep Campus <pms@faceprepcampus.com>';
  v_request_id bigint;
  v_response record;
  v_timeout int := 0;
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
    -- Determine recipient display name
    v_recipient_name := coalesce(
      nullif(trim(v_rec.student_name), ''),
      nullif(trim(v_rec.profile_name), ''),
      'Candidate'
    );
    
    -- Map notification kind to title, subtitle, button, URL
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

    -- Build canonical HTML
    v_html := build_notification_email_html(
      coalesce(v_rec.notif_title, v_title),
      v_title,
      v_subtitle,
      v_recipient_name,
      v_rec.notif_body,
      v_button,
      v_url
    );

    -- Build Resend JSON payload
    v_payload := jsonb_build_object(
      'from', v_from,
      'to', jsonb_build_array(v_rec.recipient_email),
      'reply_to', 'placements@faceprep.in',
      'subject', coalesce(v_rec.notif_title, v_title),
      'html', v_html
    );

    -- Send via pg_net and get request_id
    select net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    ) into v_request_id;

    -- Wait for response (up to 5 seconds)
    v_timeout := 0;
    loop
      select * into v_response
        from net.http_response
       where id = v_request_id;

      exit when v_response is not null or v_timeout >= 50;
      perform pg_sleep(0.1);
      v_timeout := v_timeout + 1;
    end loop;

    -- Check response and update delivery status
    if v_response is not null and v_response.status_code = 200 then
      -- Success: extract message ID from response body and mark as sent
      update email_deliveries
         set status = 'sent',
             provider_message_id = v_response.body::jsonb->>'id',
             updated_at = now()
       where id = v_rec.delivery_id;
      v_count := v_count + 1;
    else
      -- Failed: mark as failed with error
      update email_deliveries
         set status = 'failed',
             error = coalesce(
               'HTTP ' || v_response.status_code::text,
               'Timeout or no response'
             ),
             updated_at = now()
       where id = v_rec.delivery_id;
    end if;
  end loop;

  return v_count;
end;
$$;

-- Replace the cron job to use the fixed function
do $$
begin
  perform cron.unschedule('dispatch-pending-emails-every-minute');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'dispatch-pending-emails-fixed',
  '* * * * *',
  'select process_email_deliveries_fixed(50);'
);
