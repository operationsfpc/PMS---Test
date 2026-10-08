-- 0079_staff_invitation_email_dispatcher.sql
--
-- Automatic Email Dispatch for Staff Onboarding Invitations (Template AD1).
-- Ensures that when an admin invites a staff member or sets their role,
-- an official AD1 onboarding email is staged and sent via Resend automatically.

-- 1. Make notification_id nullable so email_deliveries can also carry staff/system emails
alter table email_deliveries alter column notification_id drop not null;
alter table email_deliveries add column if not exists subject text;
alter table email_deliveries add column if not exists html_body text;

-- 2. Helper to render canonical AD1 Staff Onboarding HTML email
create or replace function build_staff_invite_email_html(
  p_full_name   text,
  p_role_name   text,
  p_campuses    text,
  p_email       text,
  p_login_url   text default 'https://pms.faceprepcampus.com/login'
) returns text language plpgsql as $$
declare
  v_name text := replace(replace(replace(coalesce(p_full_name, 'Team Member'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_role text := replace(replace(replace(coalesce(p_role_name, 'Staff Member'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_campuses text := replace(replace(replace(coalesce(nullif(trim(p_campuses), ''), 'All Campuses (Organisation-wide)'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_email text := replace(replace(replace(coalesce(p_email, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_url text := coalesce(p_login_url, 'https://pms.faceprepcampus.com/login');
begin
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Invitation to FACE Prep Campus PMS as ' || v_role || '</title></head><body style="margin:0;padding:0;background-color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F1F5F9;padding:32px 12px;"><tr><td align="center"><table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);max-width:100%;"><tr><td height="4" style="background:linear-gradient(90deg,#3D3777 0%,#A46AFC 50%,#FFB800 100%);line-height:4px;font-size:4px;">&nbsp;</td></tr><tr><td style="background-color:#3D3777;padding:24px 32px;"><table border="0" cellpadding="0" cellspacing="0" style="width:170px;max-width:100%;"><tr><td align="left" valign="middle"><img src="https://pms.faceprepcampus.com/brand/faceprep-campus-light.png" alt="FACE Prep Campus" width="170" height="34" style="width:170px;height:34px;max-width:100%;display:block;border:0;"/><div style="font-size:11px;font-weight:600;color:#E0E7FF;letter-spacing:0.2px;width:170px;margin-top:6px;line-height:1.2;">Staff Onboarding</div></td></tr></table></td></tr><tr><td style="padding:36px 32px;"><h1 style="margin:0 0 16px 0;font-size:20px;color:#1E1B4B;font-weight:700;line-height:1.3;">Welcome to the Team, ' || v_name || '</h1><p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 20px 0;">You have been invited to join the FACE Prep Campus Placement Management System (PMS). Your role-based permissions have been provisioned as follows:</p><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;margin-bottom:24px;"><tr><td style="padding:12px 16px;font-size:13.5px;font-weight:600;color:#3D3777;width:140px;border-bottom:1px solid #E2E8F0;">Assigned Role:</td><td style="padding:12px 16px;font-size:14px;font-weight:600;color:#0F172A;border-bottom:1px solid #E2E8F0;">' || v_role || '</td></tr><tr><td style="padding:12px 16px;font-size:13.5px;font-weight:600;color:#3D3777;border-bottom:1px solid #E2E8F0;">Campus Scope:</td><td style="padding:12px 16px;font-size:14px;color:#334155;border-bottom:1px solid #E2E8F0;">' || v_campuses || '</td></tr><tr><td style="padding:12px 16px;font-size:13.5px;font-weight:600;color:#3D3777;">Authorized Email:</td><td style="padding:12px 16px;font-size:14px;color:#334155;">' || v_email || '</td></tr></table><table border="0" cellpadding="0" cellspacing="0" style="margin-top:8px;margin-bottom:8px;"><tr><td align="center" bgcolor="#3D3777" style="border-radius:6px;"><a href="' || v_url || '" target="_blank" style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;display:inline-block;padding:13px 28px;letter-spacing:0.2px;">Sign In to PMS &rarr;</a></td></tr></table><p style="font-size:13.5px;line-height:1.6;color:#64748B;margin:20px 0 0 0;">Use your <strong style="color:#0F172A;">Google account registered to ' || v_email || '</strong> to sign in. If you encounter any issues, contact your administrator.</p><p style="font-size:14px;line-height:1.6;color:#334155;margin:24px 0 0 0;">Warm regards,<br><strong style="color:#1E1B4B;">Placement Cell,</strong><br><strong style="color:#1E1B4B;">FACE Prep Campus</strong></p></td></tr><tr><td style="background-color:#F8FAFC;padding:22px 32px;border-top:1px solid #E2E8F0;font-size:12px;color:#64748b;line-height:1.6;"><p style="margin:0 0 4px 0;font-weight:600;color:#334155;">FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd</p><p style="margin:0;">For questions, write to <a href="mailto:pms@faceprepcampus.com" style="color:#3D3777;font-weight:600;text-decoration:underline;">pms@faceprepcampus.com</a></p></td></tr></table></td></tr></table></body></html>';
end;
$$;

-- 3. Trigger function to enqueue staff invitation email upon insert
create or replace function enqueue_staff_invitation_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role_name text;
  v_campuses  text;
  v_html      text;
  v_subject   text;
begin
  case new.role
    when 'admin' then v_role_name := 'Administrator';
    when 'campus_manager' then v_role_name := 'Campus Manager';
    when 'central_placement_coordinator' then v_role_name := 'Central Placement Coordinator';
    when 'key_account_manager' then v_role_name := 'Key Account Manager';
    when 'campus_placement_coordinator' then v_role_name := 'Campus Placement Coordinator';
    when 'account_executive' then v_role_name := 'Account Executive';
    when 'delivery_head' then v_role_name := 'Delivery Head';
    when 'er_head' then v_role_name := 'Enterprise Relations Head';
    when 'enterprise_relations' then v_role_name := 'Enterprise Relations';
    when 'ceo' then v_role_name := 'Chief Executive Officer';
    else v_role_name := replace(new.role::text, '_', ' ');
  end case;

  -- Aggregate campuses if assigned
  select string_agg(c.name, ', ' order by c.name)
    into v_campuses
    from (
      select campus_id from staff_campus_invitations where lower(email) = lower(new.email)
      union
      select a.campus_id from staff_campus_assignments a
        join profiles p on p.id = a.profile_id
       where lower(p.email) = lower(new.email)
    ) map
    join campuses c on c.id = map.campus_id;

  v_subject := 'Invitation to FACE Prep Campus PMS as ' || v_role_name;
  v_html := build_staff_invite_email_html(new.full_name, v_role_name, v_campuses, new.email);

  insert into email_deliveries (recipient_email, status, subject, html_body)
  values (lower(trim(new.email)), 'queued', v_subject, v_html);

  return new;
end;
$$;

drop trigger if exists staff_invitation_enqueues_email on staff_invitations;
create trigger staff_invitation_enqueues_email
  after insert on staff_invitations
  for each row execute function enqueue_staff_invitation_email();

-- 4. Update process_email_deliveries to support both student notifications and direct/staff deliveries
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
  v_subject text;
  v_payload jsonb;
  v_api_key text := 're_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp';
  v_from text := 'FACE Prep Campus <pms@faceprepcampus.com>';
begin
  for v_rec in
    select d.id as delivery_id,
           d.recipient_email,
           d.subject as custom_subject,
           d.html_body as custom_html,
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
    -- Check if custom HTML and subject are directly provided (e.g. staff invitation)
    if v_rec.custom_html is not null and trim(v_rec.custom_html) <> '' then
      v_subject := coalesce(v_rec.custom_subject, 'Invitation to FACE Prep Campus PMS');
      v_html := v_rec.custom_html;
    else
      -- Determine recipient display name for student notification
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

      v_subject := coalesce(v_rec.notif_title, v_title);

      -- Build canonical HTML
      v_html := build_notification_email_html(
        v_subject,
        v_title,
        v_subtitle,
        v_recipient_name,
        v_rec.notif_body,
        v_button,
        v_url
      );
    end if;

    -- Build Resend JSON payload
    v_payload := jsonb_build_object(
      'from', v_from,
      'to', jsonb_build_array(v_rec.recipient_email),
      'reply_to', 'pms@faceprepcampus.com',
      'subject', v_subject,
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
