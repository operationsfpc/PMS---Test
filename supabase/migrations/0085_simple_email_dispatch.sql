-- Migration 0085: Simple email dispatch using pg_net
--
-- pg_net is async fire-and-forget by design. We can't wait for responses.
-- Instead, we trust that if the API call is made with correct credentials,
-- it will succeed. We mark as 'sent' immediately after making the call.
--
-- The key fix: use the correct from address and ensure API key is valid.

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
      when 'campus_drive_alert', 'cpc_drive_alert' then
        v_title := 'New Campus Placement Drive Active';
        v_button := 'View Drive Cohort';
        v_url := 'https://pms.faceprepcampus.com/cpc/drives';
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

-- Update cron job
do $$
begin
  perform cron.unschedule('dispatch-pending-emails-fixed');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'dispatch-emails-simple',
  '* * * * *',
  'select process_email_deliveries_simple(50);'
);
