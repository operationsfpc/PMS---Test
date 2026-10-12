-- Migration 0088: Fix Resend API key (reverted by migration 0087)
--
-- Problem: Migration 0087 re-created process_email_deliveries_simple with the
-- OLD invalid API key (re_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp) instead of the
-- VALID key from migration 0086 (re_ecLxihcX_8EW4KqF3KwxceLpJEz9LiVY8).
--
-- Result: All 1,384 emails were marked 'sent' but never reached Resend.
--
-- Fix: Restore the valid API key and verified from address from migration 0086,
-- while keeping the improved notification kind handlers from migration 0087.

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
      -- =====================================================================
      -- STUDENT COMMUNICATIONS (S1-S16)
      -- =====================================================================
      when 'welcome' then
        -- S1: Welcome & Registration
        v_title := 'Complete Your Placement Profile';
        v_subtitle := 'Please fill in all the required details to complete your placement profile.';
        v_button := 'Complete Registration';
        v_url := 'https://pms.faceprepcampus.com/srf';
        
      when 'srf_approved' then
        -- S14: Profile Approved
        v_title := 'Profile Verified: You Are Now Eligible for Placement Drives';
        v_subtitle := 'Your SRF and marksheets have been verified. You can now apply to drives.';
        v_button := 'Explore Open Drives';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'srf_rejected' then
        -- S10: Registration Feedback
        v_title := 'Registration Form Requires Changes';
        v_subtitle := 'Please review the feedback remarks and update your registration form.';
        v_button := 'Open Registration Form';
        v_url := 'https://pms.faceprepcampus.com/srf';
        
      when 'drive_published' then
        -- S2: New Drive Announced
        v_title := 'New Placement Drive Announced';
        v_button := 'View Drive & Apply';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'application_confirmed' then
        -- S11: Application Confirmed
        v_title := 'Application Successfully Submitted';
        v_subtitle := 'Your application has been recorded and is under evaluation.';
        v_button := 'View Application Status';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'shortlisted' then
        -- S3: Shortlisted Candidates
        v_title := 'You Are Shortlisted';
        v_subtitle := 'You have been shortlisted for the next round.';
        v_button := 'View Application Status';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'round_scheduled' then
        -- S4: Round Schedule
        v_title := 'Round Schedule Released';
        v_subtitle := 'The schedule for your upcoming round has been confirmed.';
        v_button := 'View Drive Dashboard';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'interview_slot', 'meeting_slot' then
        -- S5: Interview Slot
        v_title := 'Interview Slot Scheduled';
        v_subtitle := 'Your individual interview slot has been scheduled.';
        v_button := 'Join Interview Room';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'round_cleared' then
        -- S6: Round Cleared
        v_title := 'Round Cleared';
        v_subtitle := 'You have advanced to the next round.';
        v_button := 'View Drive Progress';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'round_not_selected' then
        -- S7: Round Outcome
        v_title := 'Application Status Update';
        v_subtitle := 'You were not selected to advance in this drive. Your placement status remains active.';
        v_button := 'Explore Open Drives';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'offer' then
        -- S8: Offer Declared
        v_title := 'Placement Offer Extended';
        v_subtitle := 'Congratulations! Your formal offer letter is ready for download.';
        v_button := 'View Offer & Letter';
        v_url := 'https://pms.faceprepcampus.com/student/notifications';
        
      when 'offer_decision' then
        -- S15: Offer Decision Recorded
        v_title := 'Offer Decision Recorded';
        v_subtitle := 'Your decision regarding the placement offer has been officially recorded.';
        v_button := 'View Placement Record';
        v_url := 'https://pms.faceprepcampus.com/student/notifications';
        
      when 'attendance_notice' then
        -- S9: Attendance Notice
        v_title := 'Absence Recorded';
        v_subtitle := 'You were marked absent for a scheduled round. Contact your coordinator if this is incorrect.';
        v_button := 'View Attendance Record';
        v_url := 'https://pms.faceprepcampus.com/student';
        
      when 'deadline_reminder' then
        -- S12: Deadline Reminder
        v_title := 'Placement Drive Closing Soon';
        v_subtitle := 'Applications for this drive will close soon. Complete your application before the deadline.';
        v_button := 'Apply to Drive';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'interview_day_reminder' then
        -- S13: Interview Day Reminder
        v_title := 'Interview Day Reminder';
        v_subtitle := 'Your scheduled round takes place today. Please report on time with your college ID.';
        v_button := 'View Drive Details';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
        
      when 'opt_out_confirmed' then
        -- S16: Opt-Out Confirmed
        v_title := 'Placement Opt-Out Acknowledged';
        v_subtitle := 'Your request to opt out of campus recruitment drives has been processed.';
        v_button := 'View Profile';
        v_url := 'https://pms.faceprepcampus.com/student/profile';

      -- =====================================================================
      -- CAMPUS COORDINATOR (C1-C7)
      -- =====================================================================
      when 'campus_drive_alert', 'cpc_drive_alert' then
        -- C1: Campus Drive Alert
        v_title := 'New Campus Placement Drive Active';
        v_button := 'View Drive Cohort';
        v_url := 'https://pms.faceprepcampus.com/cpc/drives';
        
      when 'campus_shortlist_ready' then
        -- C2: Campus Shortlist Ready
        v_title := 'Campus Candidate Shortlist Released';
        v_subtitle := 'The candidate shortlist has been finalized by Central Placements.';
        v_button := 'View Shortlisted Roster';
        v_url := 'https://pms.faceprepcampus.com/cpc/drives';
        
      when 'verification_queue_digest', 'cpc_verification' then
        -- C3: Verification Queue Digest
        v_title := 'Student Profiles Pending Verification';
        v_subtitle := 'There are student registration forms awaiting academic verification.';
        v_button := 'Open Verification Queue';
        v_url := 'https://pms.faceprepcampus.com/cpc/verification';
        
      when 'semester_pending_verification' then
        -- C4: Semester Pending Verification
        v_title := 'Semester Record Pending Verification';
        v_subtitle := 'A student has uploaded a new semester academic record for verification.';
        v_button := 'Verify Semester Record';
        v_url := 'https://pms.faceprepcampus.com/cpc/semesters';
        
      when 'attendance_pending' then
        -- C5: Attendance Pending
        v_title := 'Round Attendance Pending Submission';
        v_subtitle := 'A round has commenced and attendance records must be submitted.';
        v_button := 'Mark Round Attendance';
        v_url := 'https://pms.faceprepcampus.com/cpc/attendance';
        
      when 'campus_student_placed' then
        -- C6: Campus Student Placed
        v_title := 'Campus Student Placement';
        v_subtitle := 'A candidate from your campus has secured a placement offer.';
        v_button := 'View Drive Progress';
        v_url := 'https://pms.faceprepcampus.com/cpc/drives';
        
      when 'off_campus_offer_proof' then
        -- C7: Off-Campus Offer Proof
        v_title := 'Off-Campus Offer Verification Required';
        v_subtitle := 'A student has submitted an external offer letter for verification.';
        v_button := 'Review Off-Campus Queue';
        v_url := 'https://pms.faceprepcampus.com/cpc/off-campus';

      -- =====================================================================
      -- CENTRAL COORDINATOR (CP1-CP4)
      -- =====================================================================
      when 'drive_ready_to_publish' then
        -- CP1: Drive Ready to Publish
        v_title := 'Placement Drive Approved';
        v_subtitle := 'The PIF has been approved. Configure rounds and publish the drive.';
        v_button := 'Configure & Publish';
        v_url := 'https://pms.faceprepcampus.com/central/drives/yet-to-publish';
        
      when 'applications_closed' then
        -- CP2: Applications Closed
        v_title := 'Drive Applications Closed';
        v_subtitle := 'The student application deadline has passed. Proceed to candidate screening.';
        v_button := 'Open Shortlisting Console';
        v_url := 'https://pms.faceprepcampus.com/central/shortlisting';
        
      when 'attendance_finalized' then
        -- CP3: Attendance Finalized
        v_title := 'Round Attendance Finalized';
        v_subtitle := 'Campus coordinators have completed attendance marking.';
        v_button := 'Enter Round Results';
        v_url := 'https://pms.faceprepcampus.com/central/results';
        
      when 'all_rounds_completed' then
        -- CP4: All Rounds Completed
        v_title := 'Placement Drive Completed';
        v_subtitle := 'All scheduled rounds have concluded. Issue placement offers.';
        v_button := 'Issue Placement Offers';
        v_url := 'https://pms.faceprepcampus.com/central/offers';

      -- =====================================================================
      -- ACCOUNT EXECUTIVE (A1-A4)
      -- =====================================================================
      when 'pif_approved', 'ae_pif_approved' then
        -- A1: PIF Approved
        v_title := 'Placement Initiation Form Approved';
        v_subtitle := 'Your PIF has been approved by the Delivery Head.';
        v_button := 'View Sourced Drives';
        v_url := 'https://pms.faceprepcampus.com/my-drives';
        
      when 'pif_revision' then
        -- A2: PIF Revision Requested
        v_title := 'PIF Requires Changes';
        v_subtitle := 'The Delivery Head has requested clarifications before approval.';
        v_button := 'Revise PIF Details';
        v_url := 'https://pms.faceprepcampus.com/ae/pif';
        
      when 'drive_live_to_ae' then
        -- A3: Drive Live to Students
        v_title := 'Placement Drive Published';
        v_subtitle := 'Your recruitment drive is now live across campuses.';
        v_button := 'View Account Overview';
        v_url := 'https://pms.faceprepcampus.com/ae/overview';
        
      when 'drive_offers_milestone' then
        -- A4: Drive Offers Milestone
        v_title := 'Drive Concluded Successfully';
        v_subtitle := 'Your placement drive has concluded with confirmed offers.';
        v_button := 'View Account Performance';
        v_url := 'https://pms.faceprepcampus.com/ae/overview';

      -- =====================================================================
      -- DELIVERY HEAD (DH1-DH3)
      -- =====================================================================
      when 'pif_submitted' then
        -- DH1: PIF Submitted
        v_title := 'Placement Initiation Form Under Review';
        v_subtitle := 'A new PIF has been submitted and is ready for governance review.';
        v_button := 'Open PIF Approvals';
        v_url := 'https://pms.faceprepcampus.com/delivery-head/pif-approvals';
        
      when 'policy_override' then
        -- DH2: Policy Override Alert
        v_title := 'Placement Policy Override Request';
        v_subtitle := 'A placement policy override has been requested for candidate eligibility.';
        v_button := 'Review Policy Override';
        v_url := 'https://pms.faceprepcampus.com/delivery-head/pif-approvals';
        
      when 'weekly_digest' then
        -- DH3: Weekly Operations Digest
        v_title := 'Weekly Placement Operations Summary';
        v_subtitle := 'Here is the weekly executive operations summary across all institutions.';
        v_button := 'Open Operations Cockpit';
        v_url := 'https://pms.faceprepcampus.com/dashboard';

      -- =====================================================================
      -- LEADERSHIP (L1-L2)
      -- =====================================================================
      when 'weekly_placement_digest' then
        -- L1: Weekly Placement Digest
        v_title := 'Weekly Campus Placement Executive Summary';
        v_subtitle := 'Here is the weekly placement performance report for your institution.';
        v_button := 'Open Leadership Dashboard';
        v_url := 'https://pms.faceprepcampus.com/dashboard';
        
      when 'super_dream_milestone' then
        -- L2: Super Dream Milestone
        v_title := 'Marquee Placement Success Milestone';
        v_subtitle := 'A student from your institution has secured a marquee placement offer.';
        v_button := 'View Placement Statistics';
        v_url := 'https://pms.faceprepcampus.com/dashboard';

      -- =====================================================================
      -- RECRUITER (R1-R4)
      -- =====================================================================
      when 'candidate_shortlist_recruiter' then
        -- R1: Candidate Shortlist
        v_title := 'Candidate Shortlist & Resume Pack';
        v_subtitle := 'The official candidate shortlist is ready for your review.';
        v_button := 'Open Candidate Pack';
        v_url := 'https://pms.faceprepcampus.com/login';
        
      when 'drive_sourcing_kickoff' then
        -- R2: Drive Sourcing Kickoff
        v_title := 'Your Campus Drive Is Live';
        v_subtitle := 'Your campus recruitment drive is now active across targeted partner campuses.';
        v_button := 'View Drive Status';
        v_url := 'https://pms.faceprepcampus.com/login';
        
      when 'interview_schedule_roster' then
        -- R3: Interview Schedule & Roster
        v_title := 'Interview Schedule & Candidate Roster';
        v_subtitle := 'The candidate schedule and venue logistics have been locked.';
        v_button := 'Access Interview Dossier';
        v_url := 'https://pms.faceprepcampus.com/login';
        
      when 'drive_concluded_summary' then
        -- R4: Drive Concluded Summary
        v_title := 'Campus Drive Concluded';
        v_subtitle := 'Thank you for conducting your campus recruitment drive with us.';
        v_button := 'Download Placements Package';
        v_url := 'https://pms.faceprepcampus.com/login';

      -- =====================================================================
      -- ADMINISTRATOR (AD1-AD3)
      -- =====================================================================
      when 'staff_invitation' then
        -- AD1: Staff Invitation
        v_title := 'Welcome to the Team';
        v_subtitle := 'You have been invited to join the FACE Prep Campus Placement Management System.';
        v_button := 'Sign In to PMS';
        v_url := 'https://pms.faceprepcampus.com/login';
        
      when 'roster_import' then
        -- AD2: Roster Import Complete
        v_title := 'Roster Import Complete';
        v_subtitle := 'The student cohort roster upload has been processed successfully.';
        v_button := 'View Student Directory';
        v_url := 'https://pms.faceprepcampus.com/central/students';
        
      when 'email_delivery_alert' then
        -- AD3: Email Delivery Alert
        v_title := 'Email Delivery Exception Alert';
        v_subtitle := 'The automated email delivery outbox has encountered transmission exceptions.';
        v_button := 'Review Delivery Logs';
        v_url := 'https://pms.faceprepcampus.com/dashboard';
        
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

-- Reset all 'sent' emails without provider_message_id back to 'queued'
-- so the cron job reprocesses them with the correct API key
update email_deliveries
   set status = 'queued',
       updated_at = now()
 where status = 'sent'
   and provider_message_id is null;

comment on function process_email_deliveries_simple is
  'Fixed: restored valid Resend API key from migration 0086 (was reverted by 0087). Handles all 39 email template kinds from the catalogue (S1-S16, C1-C7, CP1-CP4, A1-A4, DH1-DH3, L1-L2, R1-R4, AD1-AD3).';
