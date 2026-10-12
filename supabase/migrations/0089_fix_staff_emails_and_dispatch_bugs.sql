-- Migration 0089: Fix staff emails, trigger bugs, and dispatch correctness
--
-- Problems fixed:
--   1. process_email_deliveries_simple was missing custom HTML bypass from 0079,
--      so staff invitation emails (which have html_body/subject, no notification_id)
--      were rendered as blank generic templates.
--   2. notify_cpc_on_student_offer (0080) displayed CTC for internship offers,
--      but internships have ctc_lpa=NULL and stipend_monthly instead.
--   3. offer_reaches_student (0067) inserted notifications without drive_id,
--      so students could not navigate from the notification to the drive.
--   4. notify_eligible_students_on_drive_live (0082) used wrong arrear_policy
--      enum values ('no_arrears', 'no_active_arrears') instead of the actual
--      enum ('no_history', 'no_standing'). Also lacked a dedup guard, so a
--      drive status flip to 'live' created duplicate notifications.
--   5. Added missing 'meeting_link' notification kind handler.

-- ============================================================================
-- FIX 1: Restore custom HTML bypass + all 39 handlers + meeting_link
-- ============================================================================
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
  v_subject text;
  v_payload jsonb;
  v_api_key text := 're_ecLxihcX_8EW4KqF3KwxceLpJEz9LiVY8';
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
    -- Custom HTML bypass: staff invitations and other direct emails carry
    -- pre-built HTML in html_body with no notification_id.
    if v_rec.custom_html is not null and trim(v_rec.custom_html) <> '' then
      v_subject := coalesce(v_rec.custom_subject, 'FACE Prep Campus');
      v_html := v_rec.custom_html;
      v_recipient_name := coalesce(
        nullif(trim(v_rec.profile_name), ''),
        'Team Member'
      );
    else
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
        -- =====================================================================
        -- STUDENT COMMUNICATIONS (S1-S16)
        -- =====================================================================
        when 'welcome' then
          v_title := 'Complete Your Placement Profile';
          v_subtitle := 'Please fill in all the required details to complete your placement profile.';
          v_button := 'Complete Registration';
          v_url := 'https://pms.faceprepcampus.com/srf';

        when 'srf_approved' then
          v_title := 'Profile Verified: You Are Now Eligible for Placement Drives';
          v_subtitle := 'Your SRF and marksheets have been verified. You can now apply to drives.';
          v_button := 'Explore Open Drives';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'srf_rejected' then
          v_title := 'Registration Form Requires Changes';
          v_subtitle := 'Please review the feedback remarks and update your registration form.';
          v_button := 'Open Registration Form';
          v_url := 'https://pms.faceprepcampus.com/srf';

        when 'drive_published' then
          v_title := 'New Placement Drive Announced';
          v_button := 'View Drive & Apply';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'application_confirmed' then
          v_title := 'Application Successfully Submitted';
          v_subtitle := 'Your application has been recorded and is under evaluation.';
          v_button := 'View Application Status';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'shortlisted' then
          v_title := 'You Are Shortlisted';
          v_subtitle := 'You have been shortlisted for the next round.';
          v_button := 'View Application Status';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'round_scheduled' then
          v_title := 'Round Schedule Released';
          v_subtitle := 'The schedule for your upcoming round has been confirmed.';
          v_button := 'View Drive Dashboard';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'interview_slot', 'meeting_slot' then
          v_title := 'Interview Slot Scheduled';
          v_subtitle := 'Your individual interview slot has been scheduled.';
          v_button := 'Join Interview Room';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'meeting_link' then
          v_title := 'Meeting Link Shared';
          v_subtitle := 'A meeting link for your upcoming round has been shared.';
          v_button := 'View Drive Details';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'round_cleared' then
          v_title := 'Round Cleared';
          v_subtitle := 'You have advanced to the next round.';
          v_button := 'View Drive Progress';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'round_not_selected' then
          v_title := 'Application Status Update';
          v_subtitle := 'You were not selected to advance in this drive. Your placement status remains active.';
          v_button := 'Explore Open Drives';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'offer' then
          v_title := 'Placement Offer Extended';
          v_subtitle := 'Congratulations! Your formal offer letter is ready for download.';
          v_button := 'View Offer & Letter';
          v_url := 'https://pms.faceprepcampus.com/student/notifications';

        when 'offer_decision' then
          v_title := 'Offer Decision Recorded';
          v_subtitle := 'Your decision regarding the placement offer has been officially recorded.';
          v_button := 'View Placement Record';
          v_url := 'https://pms.faceprepcampus.com/student/notifications';

        when 'absent' then
          v_title := 'Absence Recorded';
          v_subtitle := 'You were marked absent for a scheduled round. Contact your coordinator if this is incorrect.';
          v_button := 'View Attendance Record';
          v_url := 'https://pms.faceprepcampus.com/student';

        when 'deadline_reminder' then
          v_title := 'Placement Drive Closing Soon';
          v_subtitle := 'Applications for this drive will close soon. Complete your application before the deadline.';
          v_button := 'Apply to Drive';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'interview_day_reminder' then
          v_title := 'Interview Day Reminder';
          v_subtitle := 'Your scheduled round takes place today. Please report on time with your college ID.';
          v_button := 'View Drive Details';
          v_url := 'https://pms.faceprepcampus.com/student/drives';

        when 'opt_out_confirmed' then
          v_title := 'Placement Opt-Out Acknowledged';
          v_subtitle := 'Your request to opt out of campus recruitment drives has been processed.';
          v_button := 'View Profile';
          v_url := 'https://pms.faceprepcampus.com/student/profile';

        -- =====================================================================
        -- CAMPUS COORDINATOR (C1-C7)
        -- =====================================================================
        when 'campus_drive_alert', 'cpc_drive_alert' then
          v_title := 'New Campus Placement Drive Active';
          v_button := 'View Drive Cohort';
          v_url := 'https://pms.faceprepcampus.com/cpc/drives';

        when 'campus_shortlist_ready' then
          v_title := 'Campus Candidate Shortlist Released';
          v_subtitle := 'The candidate shortlist has been finalized by Central Placements.';
          v_button := 'View Shortlisted Roster';
          v_url := 'https://pms.faceprepcampus.com/cpc/drives';

        when 'verification_queue_digest', 'cpc_verification' then
          v_title := 'Student Profiles Pending Verification';
          v_subtitle := 'There are student registration forms awaiting academic verification.';
          v_button := 'Open Verification Queue';
          v_url := 'https://pms.faceprepcampus.com/cpc/verification';

        when 'semester_pending_verification' then
          v_title := 'Semester Record Pending Verification';
          v_subtitle := 'A student has uploaded a new semester academic record for verification.';
          v_button := 'Verify Semester Record';
          v_url := 'https://pms.faceprepcampus.com/cpc/semesters';

        when 'attendance_pending' then
          v_title := 'Round Attendance Pending Submission';
          v_subtitle := 'A round has commenced and attendance records must be submitted.';
          v_button := 'Mark Round Attendance';
          v_url := 'https://pms.faceprepcampus.com/cpc/attendance';

        when 'campus_student_placed' then
          v_title := 'Campus Student Placement';
          v_subtitle := 'A candidate from your campus has secured a placement offer.';
          v_button := 'View Drive Progress';
          v_url := 'https://pms.faceprepcampus.com/cpc/drives';

        when 'off_campus_offer_proof' then
          v_title := 'Off-Campus Offer Verification Required';
          v_subtitle := 'A student has submitted an external offer letter for verification.';
          v_button := 'Review Off-Campus Queue';
          v_url := 'https://pms.faceprepcampus.com/cpc/off-campus';

        -- =====================================================================
        -- CENTRAL COORDINATOR (CP1-CP4)
        -- =====================================================================
        when 'drive_ready_to_publish' then
          v_title := 'Placement Drive Approved';
          v_subtitle := 'The PIF has been approved. Configure rounds and publish the drive.';
          v_button := 'Configure & Publish';
          v_url := 'https://pms.faceprepcampus.com/central/drives/yet-to-publish';

        when 'applications_closed' then
          v_title := 'Drive Applications Closed';
          v_subtitle := 'The student application deadline has passed. Proceed to candidate screening.';
          v_button := 'Open Shortlisting Console';
          v_url := 'https://pms.faceprepcampus.com/central/shortlisting';

        when 'attendance_finalized' then
          v_title := 'Round Attendance Finalized';
          v_subtitle := 'Campus coordinators have completed attendance marking.';
          v_button := 'Enter Round Results';
          v_url := 'https://pms.faceprepcampus.com/central/results';

        when 'all_rounds_completed' then
          v_title := 'Placement Drive Completed';
          v_subtitle := 'All scheduled rounds have concluded. Issue placement offers.';
          v_button := 'Issue Placement Offers';
          v_url := 'https://pms.faceprepcampus.com/central/offers';

        -- =====================================================================
        -- ACCOUNT EXECUTIVE (A1-A4)
        -- =====================================================================
        when 'pif_approved', 'ae_pif_approved' then
          v_title := 'Placement Initiation Form Approved';
          v_subtitle := 'Your PIF has been approved by the Delivery Head.';
          v_button := 'View Sourced Drives';
          v_url := 'https://pms.faceprepcampus.com/my-drives';

        when 'pif_revision' then
          v_title := 'PIF Requires Changes';
          v_subtitle := 'The Delivery Head has requested clarifications before approval.';
          v_button := 'Revise PIF Details';
          v_url := 'https://pms.faceprepcampus.com/ae/pif';

        when 'drive_live_to_ae' then
          v_title := 'Placement Drive Published';
          v_subtitle := 'Your recruitment drive is now live across campuses.';
          v_button := 'View Account Overview';
          v_url := 'https://pms.faceprepcampus.com/ae/overview';

        when 'drive_offers_milestone' then
          v_title := 'Drive Concluded Successfully';
          v_subtitle := 'Your placement drive has concluded with confirmed offers.';
          v_button := 'View Account Performance';
          v_url := 'https://pms.faceprepcampus.com/ae/overview';

        -- =====================================================================
        -- DELIVERY HEAD (DH1-DH3)
        -- =====================================================================
        when 'pif_submitted' then
          v_title := 'Placement Initiation Form Under Review';
          v_subtitle := 'A new PIF has been submitted and is ready for governance review.';
          v_button := 'Open PIF Approvals';
          v_url := 'https://pms.faceprepcampus.com/delivery-head/pif-approvals';

        when 'policy_override' then
          v_title := 'Placement Policy Override Request';
          v_subtitle := 'A placement policy override has been requested for candidate eligibility.';
          v_button := 'Review Policy Override';
          v_url := 'https://pms.faceprepcampus.com/delivery-head/pif-approvals';

        when 'weekly_digest' then
          v_title := 'Weekly Placement Operations Summary';
          v_subtitle := 'Here is the weekly executive operations summary across all institutions.';
          v_button := 'Open Operations Cockpit';
          v_url := 'https://pms.faceprepcampus.com/dashboard';

        -- =====================================================================
        -- LEADERSHIP (L1-L2)
        -- =====================================================================
        when 'weekly_placement_digest' then
          v_title := 'Weekly Campus Placement Executive Summary';
          v_subtitle := 'Here is the weekly placement performance report for your institution.';
          v_button := 'Open Leadership Dashboard';
          v_url := 'https://pms.faceprepcampus.com/dashboard';

        when 'super_dream_milestone' then
          v_title := 'Marquee Placement Success Milestone';
          v_subtitle := 'A student from your institution has secured a marquee placement offer.';
          v_button := 'View Placement Statistics';
          v_url := 'https://pms.faceprepcampus.com/dashboard';

        -- =====================================================================
        -- RECRUITER (R1-R4)
        -- =====================================================================
        when 'candidate_shortlist_recruiter' then
          v_title := 'Candidate Shortlist & Resume Pack';
          v_subtitle := 'The official candidate shortlist is ready for your review.';
          v_button := 'Open Candidate Pack';
          v_url := 'https://pms.faceprepcampus.com/login';

        when 'drive_sourcing_kickoff' then
          v_title := 'Your Campus Drive Is Live';
          v_subtitle := 'Your campus recruitment drive is now active across targeted partner campuses.';
          v_button := 'View Drive Status';
          v_url := 'https://pms.faceprepcampus.com/login';

        when 'interview_schedule_roster' then
          v_title := 'Interview Schedule & Candidate Roster';
          v_subtitle := 'The candidate schedule and venue logistics have been locked.';
          v_button := 'Access Interview Dossier';
          v_url := 'https://pms.faceprepcampus.com/login';

        when 'drive_concluded_summary' then
          v_title := 'Campus Drive Concluded';
          v_subtitle := 'Thank you for conducting your campus recruitment drive with us.';
          v_button := 'Download Placements Package';
          v_url := 'https://pms.faceprepcampus.com/login';

        -- =====================================================================
        -- ADMINISTRATOR (AD1-AD3)
        -- =====================================================================
        when 'staff_invitation' then
          v_title := 'Welcome to the Team';
          v_subtitle := 'You have been invited to join the FACE Prep Campus Placement Management System.';
          v_button := 'Sign In to PMS';
          v_url := 'https://pms.faceprepcampus.com/login';

        when 'roster_import' then
          v_title := 'Roster Import Complete';
          v_subtitle := 'The student cohort roster upload has been processed successfully.';
          v_button := 'View Student Directory';
          v_url := 'https://pms.faceprepcampus.com/central/students';

        when 'email_delivery_alert' then
          v_title := 'Email Delivery Exception Alert';
          v_subtitle := 'The automated email delivery outbox has encountered transmission exceptions.';
          v_button := 'Review Delivery Logs';
          v_url := 'https://pms.faceprepcampus.com/dashboard';

        else
          null;
      end case;

      v_subject := coalesce(v_rec.notif_title, v_title);

      v_html := build_notification_email_html(
        coalesce(v_rec.notif_title, v_title),
        v_title,
        v_subtitle,
        v_recipient_name,
        v_rec.notif_body,
        v_button,
        v_url
      );
    end if;

    v_payload := jsonb_build_object(
      'from', v_from,
      'to', jsonb_build_array(v_rec.recipient_email),
      'reply_to', 'placements@faceprep.in',
      'subject', v_subject,
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

comment on function process_email_deliveries_simple is
  'Fixed 0089: restored custom HTML bypass for staff emails (0079), all 39+1 notification kind handlers, valid Resend API key.';

-- ============================================================================
-- FIX 2: Internship offer CTC display in CPC notification (0080)
-- ============================================================================
create or replace function notify_cpc_on_student_offer() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student_name text;
  v_roll_number text;
  v_campus_id uuid;
  v_company_name text;
  v_subject text;
  v_title text;
  v_subtitle text;
  v_body text;
  v_cpc_rec record;
begin
  select s.full_name, s.roll_number, s.campus_id, coalesce(new.company_name, d.company_name)
    into v_student_name, v_roll_number, v_campus_id, v_company_name
    from students s
    left join drives d on d.id = new.drive_id
   where s.id = new.student_id;

  if v_campus_id is null then
    return new;
  end if;

  v_subject := 'Placement Success: Candidate Placed — ' || coalesce(v_student_name, 'Candidate');
  v_title := 'Campus Student Placement';
  v_subtitle := 'A student from your campus has received a verified placement offer.';

  -- Internship offers show stipend, not CTC
  if new.offer_category = 'internship' then
    v_body := '**Student:** ' || coalesce(v_student_name, 'Candidate') || ' (' || coalesce(v_roll_number, 'N/A') || ')' || E'\n' ||
              '**Company:** ' || coalesce(v_company_name, 'Recruiting Partner') || E'\n' ||
              '**Offer Type:** Internship' || E'\n' ||
              '**Stipend:** ' || coalesce('₹' || new.stipend_monthly::text || ' / month', 'N/A') || E'\n\n' ||
              'Congratulations! The candidate outcome has been recorded in the central placement database.';
  else
    v_body := '**Student:** ' || coalesce(v_student_name, 'Candidate') || ' (' || coalesce(v_roll_number, 'N/A') || ')' || E'\n' ||
              '**Company:** ' || coalesce(v_company_name, 'Recruiting Partner') || E'\n' ||
              '**CTC / Package:** ' || coalesce(new.ctc_lpa::text, 'N/A') || ' LPA' || E'\n\n' ||
              'Congratulations! The candidate outcome has been recorded in the central placement database.';
  end if;

  for v_cpc_rec in
    select distinct u.email, u.full_name
      from (
        select p.email, p.full_name
          from staff_campus_assignments a
          join profiles p on p.id = a.profile_id
         where a.campus_id = v_campus_id
           and p.role = 'campus_placement_coordinator'
           and p.is_active = true
        union
        select sci.email, coalesce(si.full_name, 'Campus Placement Coordinator') as full_name
          from staff_campus_invitations sci
          join staff_invitations si on lower(si.email) = lower(sci.email)
         where sci.campus_id = v_campus_id
           and si.role = 'campus_placement_coordinator'
      ) u
  loop
    perform enqueue_direct_email(
      v_cpc_rec.email,
      v_subject,
      v_title,
      v_subtitle,
      coalesce(v_cpc_rec.full_name, 'Campus Placement Coordinator'),
      v_body,
      'View Drive Progress',
      'https://pms.faceprepcampus.com/cpc/drives'
    );
  end loop;

  return new;
end;
$$;

-- ============================================================================
-- FIX 3: offer_reaches_student — include drive_id in notification (0067)
-- ============================================================================
create or replace function offer_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_opted boolean;
begin
  if new.source <> 'on_campus' then
    return new;
  end if;

  select participation_status = 'opted_out' into v_opted
    from students where id = new.student_id;
  if v_opted then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body, drive_id)
  values (
    new.student_id,
    'offer',
    'Offer from ' || new.company_name,
    case
      when new.offer_category = 'internship'
        then 'Congratulations — ' || new.company_name || ' has made you an internship offer.'
      when new.offer_category is not null
        then 'Congratulations — ' || new.company_name || ' has made you an offer ('
             || replace(new.offer_category::text, '_', ' ') || ').'
      else 'Congratulations — ' || new.company_name || ' has made you an offer.'
    end,
    new.drive_id
  );

  return new;
end;
$$;

-- ============================================================================
-- FIX 4: Arrear policy enum values + dedup guard (0082)
-- ============================================================================
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
  if new.status <> 'live' or (tg_op = 'update' and old.status is not distinct from 'live') then
    return new;
  end if;

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

  for v_student_rec in
    select distinct s.id, s.full_name, s.email
      from students s
     where s.srf_status = 'srf_approved'
       and s.participation_status = 'active'
       and (
         not exists (select 1 from drive_target_campuses dtc where dtc.drive_id = new.id)
         or exists (
           select 1 from drive_target_campuses dtc
            where dtc.drive_id = new.id
              and dtc.campus_id = s.campus_id
         )
       )
       and (
         not exists (select 1 from drive_eligible_degrees ded where ded.drive_id = new.id)
         or exists (
           select 1 from drive_eligible_degrees ded
            where ded.drive_id = new.id
              and ded.degree_id = s.degree_id
         )
       )
       and (
         not exists (select 1 from drive_eligible_branches deb where deb.drive_id = new.id)
         or exists (
           select 1 from drive_eligible_branches deb
            where deb.drive_id = new.id
              and deb.branch_id = s.branch_id
         )
       )
       and (
         array_length(new.eligible_passing_years, 1) is null
         or s.passing_year = any(new.eligible_passing_years)
       )
       and (
         new.min_overall_cgpa is null
         or s.overall_cgpa >= new.min_overall_cgpa
       )
       and (
         new.min_tenth_percentage is null
         or s.tenth_percentage >= new.min_tenth_percentage
       )
       and (
         new.min_twelfth_percentage is null
         or s.twelfth_percentage >= new.min_twelfth_percentage
       )
       -- Fixed: use actual enum values ('no_standing', 'no_history', 'flexible')
       and (
         new.arrears_policy = 'flexible'
         or (new.arrears_policy = 'no_history' and s.current_arrears = 0 and s.history_of_arrears = 0)
         or (new.arrears_policy = 'no_standing' and s.current_arrears = 0)
       )
       -- Dedup guard: skip students who already have a drive_published notification for this drive
       and not exists (
         select 1 from notifications n
          where n.student_id = s.id
            and n.kind = 'drive_published'
            and n.drive_id = new.id
       )
  loop
    v_body := 'A new placement drive is now open for applications at your campus.' || E'\n\n' ||
              '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n';

    if new.application_end is not null then
      v_body := v_body || '**Application Deadline:** ' || to_char(new.application_end, 'DD Mon YYYY, HH12:MI AM') || E'\n';
    end if;

    v_body := v_body || E'\n' || 'Log in to the portal to view full details and submit your application.';

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

-- Re-queue any staff emails that were sent as blank generic templates
-- (they had html_body set but were processed without the custom bypass)
update email_deliveries
   set status = 'queued',
       updated_at = now()
 where status = 'sent'
   and html_body is not null
   and provider_message_id is null;

-- Migration 0089: Fix staff email dispatch (custom HTML bypass), internship CTC display,
-- offer drive_id, arrear enum values, dedup guard.
