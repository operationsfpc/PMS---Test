-- 0078_cron_email_dispatcher.sql
--
-- Direct PostgreSQL Email Dispatcher via pg_net and pg_cron.
-- Dispatches queued emails directly from email_deliveries to Resend API.
-- Completely self-contained in PostgreSQL (no Edge Function deployment or CLI permissions required).

do $$ begin
  create extension if not exists pg_cron;
exception when others then null; end $$;

do $$ begin
  create extension if not exists pg_net;
exception when others then null; end $$;

-- 1. Helper to render canonical FACE Prep Campus branded HTML email
create or replace function build_notification_email_html(
  p_subject text,
  p_title text,
  p_subtitle text,
  p_recipient text,
  p_body text,
  p_button_label text,
  p_url text
) returns text language plpgsql as $$
declare
  v_escaped_subject text;
  v_escaped_title text;
  v_escaped_subtitle text;
  v_escaped_recipient text;
  v_escaped_url text;
  v_escaped_button text;
  v_body_html text;
  v_subtitle_html text := '';
  v_button_html text := '';
begin
  v_escaped_subject := replace(replace(replace(coalesce(p_subject, 'Notification'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_escaped_title := replace(replace(replace(coalesce(p_title, 'Notification'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_escaped_recipient := replace(replace(replace(coalesce(p_recipient, 'Candidate'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_escaped_url := coalesce(p_url, 'https://pms.faceprepcampus.com/student');
  v_escaped_button := coalesce(p_button_label, 'View on PMS Portal');
  
  -- Format markdown-like bold (**text**) and newlines in body
  v_body_html := replace(replace(replace(coalesce(p_body, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_body_html := regexp_replace(v_body_html, '\*\*(.*?)\*\*', '<strong style="color: #151228;">\1</strong>', 'g');
  v_body_html := replace(v_body_html, E'\n', '<br>');

  if p_subtitle is not null and trim(p_subtitle) <> '' then
    v_escaped_subtitle := replace(replace(replace(p_subtitle, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_subtitle_html := '<p style="margin:0 0 18px;color:#64748b;font-size:14.5px;line-height:1.5;">' || v_escaped_subtitle || '</p>';
  end if;

  if v_escaped_url is not null and trim(v_escaped_url) <> '' then
    v_button_html := '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;"><tr><td bgcolor="#3d3777" style="border-radius:6px;"><a href="' || v_escaped_url || '" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 22px;color:#fff;font-size:15px;font-weight:bold;line-height:1;text-decoration:none;">' || v_escaped_button || ' &rarr;</a></td></tr></table>';
  end if;

  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>' || v_escaped_subject || '</title><style>@media screen and (max-width:620px){.email-shell{width:100%!important}.email-padding{padding-left:22px!important;padding-right:22px!important}}</style></head><body style="margin:0;padding:0;background:#f7f6fb;color:#151228;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f6fb;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:100%;background:#fff;border:1px solid #e2e0ea;border-radius:10px;overflow:hidden;"><tr><td style="height:4px;background:#ffb800;font-size:4px;line-height:4px;">&nbsp;</td></tr><tr><td class="email-padding" style="padding:24px 32px;background:#3d3777;"><div style="width:170px;max-width:100%;"><img src="https://pms.faceprepcampus.com/brand/faceprep-campus-light.png" width="170" alt="FACE Prep Campus" style="display:block;width:170px;max-width:100%;height:auto;border:0;"><p style="margin:8px 0 0;color:#ddd8f0;font-size:11px;font-weight:600;width:170px;letter-spacing:0.2px;line-height:1.2;text-transform:none;">Placement Management System</p></div></td></tr><tr><td class="email-padding" style="padding:34px 32px 28px;"><h1 style="margin:0 0 6px;color:#151228;font-size:22px;font-weight:700;line-height:1.3;">' || v_escaped_title || '</h1>' || v_subtitle_html || '<p style="margin:0 0 18px;color:#3f3d56;font-size:16px;line-height:1.55;">Dear <strong style="color:#151228;">' || v_escaped_recipient || '</strong>,</p><p style="margin:0;color:#3f3d56;font-size:15px;line-height:1.65;">' || v_body_html || '</p>' || v_button_html || '<p style="margin:28px 0 0;color:#3f3d56;font-size:15px;line-height:1.55;">Warm regards,<br><strong style="color:#151228;">Placement Cell,</strong><br><strong style="color:#151228;">FACE Prep Campus</strong></p></td></tr><tr><td class="email-padding" style="padding:22px 32px;background:#f8fafc;border-top:1px solid #e2e0ea;font-size:12px;color:#64748b;line-height:1.6;"><p style="margin:0 0 4px 0;font-weight:600;color:#334155;">FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd</p><p style="margin:0;">For questions, contact your coordinator or write to <a href="mailto:hello@faceprep.in" style="color:#3d3777;font-weight:600;text-decoration:underline;">hello@faceprep.in</a></p></td></tr></table></td></tr></table></body></html>';
end;
$$;

-- 2. Dispatch processor that queries queued deliveries and posts to Resend directly
create or replace function process_email_deliveries(p_batch_limit int default 50)
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
      join notifications n on n.id = d.notification_id
      left join students s on s.id = n.student_id
      left join profiles p on lower(p.email) = lower(d.recipient_email)
     where d.status = 'queued'
     order by d.updated_at asc
     limit p_batch_limit
     for update of d skip locked
  loop
    -- Determine recipient display name
    v_recipient_name := coalesce(nullif(trim(v_rec.student_name), ''), nullif(trim(v_rec.profile_name), ''), 'Candidate');
    
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

    -- Send directly via pg_net async HTTP POST to Resend
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    );

    -- Mark delivery as sent
    update email_deliveries
       set status = 'sent',
           updated_at = now()
     where id = v_rec.delivery_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- 3. Reset and schedule cron job to call process_email_deliveries() every minute
do $$
begin
  perform cron.unschedule('dispatch-pending-emails-every-minute');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'dispatch-pending-emails-every-minute',
  '* * * * *',
  'select process_email_deliveries(50);'
);
