-- =============================================================================
-- Migration 0142: Exclude drive creator and publisher from self-notification emails
-- =============================================================================
-- When a Central CPC or staff member creates or publishes a placement drive,
-- they should not receive redundant alert emails telling them that the drive
-- they just created or published has been approved or gone live.
--
-- This migration updates:
-- 1. notify_drive_lifecycle_roles(): excludes creator and acting user from Central CPC alerts
-- 2. notify_campus_cpc_on_drive_published(): excludes creator and publisher from Campus CPC live alerts
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_drive_lifecycle_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ae_name       text;
  v_ae_email      text;
  v_staff_rec     record;
  v_cpc_rec       record;
  v_subject       text;
  v_title         text;
  v_subtitle      text;
  v_body          text;
  v_ctc_display   text;
BEGIN
  -- Format CTC display
  IF new.ctc_min_lpa IS NOT NULL AND new.ctc_max_lpa IS NOT NULL THEN
    IF new.ctc_min_lpa = new.ctc_max_lpa THEN
      v_ctc_display := new.ctc_min_lpa::text || ' LPA';
    ELSE
      v_ctc_display := new.ctc_min_lpa::text || ' - ' || new.ctc_max_lpa::text || ' LPA';
    END IF;
  ELSE
    v_ctc_display := 'As per policy';
  END IF;

  -- Lookup Sourcing AE details
  IF new.created_by IS NOT NULL THEN
    SELECT full_name, email INTO v_ae_name, v_ae_email
      FROM profiles
     WHERE id = new.created_by;
  END IF;

  -- A. PIF SUBMITTED -> Notify Delivery Head & ER Head (DH1)
  IF new.status = 'submitted' AND (tg_op = 'INSERT' OR old.status IS DISTINCT FROM 'submitted') THEN
    v_subject := 'Action Required: PIF Submitted for Review — ' || new.company_name;
    v_title := 'Placement Initiation Form Under Review';
    v_subtitle := 'A new placement drive has been submitted for classification and review.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role Title:** ' || COALESCE(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n' ||
              '**Sourced By (AE):** ' || COALESCE(v_ae_name, 'Account Executive') || E'\n\n' ||
              'Please review the compensation structure, eligibility criteria, and approve or request revisions.';

    FOR v_staff_rec IN
      SELECT email, full_name FROM profiles WHERE role IN ('delivery_head', 'er_head') AND is_active = true
      UNION
      SELECT email, full_name FROM staff_invitations WHERE role IN ('delivery_head', 'er_head') AND accepted_at IS NULL
    LOOP
      PERFORM enqueue_direct_email(
        v_staff_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        COALESCE(v_staff_rec.full_name, 'Head of Placement / ER'),
        v_body,
        'Open PIF Approvals',
        'https://pms.faceprepcampus.com/delivery-head/pif-approvals'
      );
    END LOOP;
  END IF;

  -- B. PIF APPROVED -> Notify AE (A1), Central CPC (CP1), and Heads (Delivery Head & ER Head)
  IF new.status = 'approved' AND (tg_op = 'INSERT' OR old.status IS DISTINCT FROM 'approved') THEN
    -- 1. Notify Sourcing AE (A1)
    IF v_ae_email IS NOT NULL THEN
      v_subject := 'Good News: PIF Approved — ' || new.company_name;
      v_title := 'Placement Initiation Form Approved';
      v_subtitle := 'Your sourced drive has been approved and moved to the publishing queue.';
      v_body := '**Company:** ' || new.company_name || E'\n' ||
                '**Role:** ' || COALESCE(new.role_title, 'Not specified') || E'\n' ||
                '**Category:** ' || COALESCE(new.offer_category::text, 'Standard') || E'\n' ||
                '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
                'Your PIF has been approved by the Delivery Head and assigned to Central Placement Coordinators for drive scheduling and campus publishing.';

      PERFORM enqueue_direct_email(
        v_ae_email,
        v_subject,
        v_title,
        v_subtitle,
        COALESCE(v_ae_name, 'Account Executive'),
        v_body,
        'View Sourced Drives',
        'https://pms.faceprepcampus.com/my-drives'
      );
    END IF;

    -- 2. Notify Central CPC (CP1) — exclude the person who created or approved the drive
    v_subject := 'Drive Approved: Ready for Round Setup & Publishing — ' || new.company_name;
    v_title := 'Placement Drive Approved';
    v_subtitle := 'New approved drive ready for campus targeting and schedule setup.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || COALESCE(new.role_title, 'Not specified') || E'\n' ||
              '**Category:** ' || COALESCE(new.offer_category::text, 'Standard') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
              'Delivery Head has approved the Placement Initiation Form. Please configure the round schedule, target campuses, and publish the drive live.';

    FOR v_staff_rec IN
      SELECT email, full_name FROM profiles
       WHERE role = 'central_placement_coordinator'
         AND is_active = true
         AND id IS DISTINCT FROM new.created_by
         AND id IS DISTINCT FROM auth.uid()
      UNION
      SELECT email, full_name FROM staff_invitations
       WHERE role = 'central_placement_coordinator'
         AND accepted_at IS NULL
    LOOP
      PERFORM enqueue_direct_email(
        v_staff_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        COALESCE(v_staff_rec.full_name, 'Central Placement Coordinator'),
        v_body,
        'Configure & Publish',
        'https://pms.faceprepcampus.com/central/drives/yet-to-publish'
      );
    END LOOP;

    -- 3. Notify Delivery Head & ER Head (Drive Transferred to Central CPC)
    v_subject := 'Drive Approved: Transferred to Central CPC — ' || new.company_name;
    v_title := 'Placement Drive Approved';
    v_subtitle := 'The drive has been approved and moved to Central Placement Coordinator for campus scheduling.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || COALESCE(new.role_title, 'Not specified') || E'\n' ||
              '**Category:** ' || COALESCE(new.offer_category::text, 'Standard') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
              'Placement Initiation Form has been approved and assigned to Central Placement Coordinators to configure campus targeting and take the drive live.';

    FOR v_staff_rec IN
      SELECT email, full_name FROM profiles
       WHERE role IN ('delivery_head', 'er_head')
         AND is_active = true
         AND id IS DISTINCT FROM auth.uid()
      UNION
      SELECT email, full_name FROM staff_invitations
       WHERE role IN ('delivery_head', 'er_head')
         AND accepted_at IS NULL
    LOOP
      PERFORM enqueue_direct_email(
        v_staff_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        COALESCE(v_staff_rec.full_name, 'Head of Placement / ER'),
        v_body,
        'View Sourced Drives',
        'https://pms.faceprepcampus.com/delivery-head/pif-approvals'
      );
    END LOOP;
  END IF;

  -- C. PIF REJECTED / REVISION REQUESTED -> Notify AE (A2)
  IF new.status = 'rejected' AND (tg_op = 'INSERT' OR old.status IS DISTINCT FROM 'rejected') THEN
    IF v_ae_email IS NOT NULL THEN
      v_subject := 'Action Required: PIF Revision Requested — ' || new.company_name;
      v_title := 'PIF Requires Changes';
      v_subtitle := 'Feedback has been provided on your submitted Placement Initiation Form.';
      v_body := '**Company:** ' || new.company_name || E'\n' ||
                '**Role:** ' || COALESCE(new.role_title, 'Not specified') || E'\n' ||
                '**Review Feedback:** ' || COALESCE(new.rejection_reason, 'Please review the submitted parameters and consult with Delivery Head.') || E'\n\n' ||
                'Please update the PIF with the requested changes and resubmit for approval.';

      PERFORM enqueue_direct_email(
        v_ae_email,
        v_subject,
        v_title,
        v_subtitle,
        COALESCE(v_ae_name, 'Account Executive'),
        v_body,
        'Revise PIF Details',
        'https://pms.faceprepcampus.com/ae/pif'
      );
    END IF;
  END IF;

  -- D. DRIVE LIVE -> Notify AE (A3), Target Campus CPCs (C1), and Leadership Heads
  IF new.status = 'live' AND (tg_op = 'INSERT' OR old.status IS DISTINCT FROM 'live') THEN
    -- 1. Notify Sourcing AE (A3)
    IF v_ae_email IS NOT NULL THEN
      v_subject := 'Your Account is Live: Placement Drive Published — ' || new.company_name;
      v_title := 'Placement Drive Published';
      v_subtitle := 'Your sourced drive is now actively accepting applications.';
      v_body := '**Company:** ' || new.company_name || E'\n' ||
                '**Role:** ' || COALESCE(new.role_title, 'Not specified') || E'\n' ||
                '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
                'Central CPC has published your drive live across targeted partner campuses. Eligible students can now submit their applications.';

      PERFORM enqueue_direct_email(
        v_ae_email,
        v_subject,
        v_title,
        v_subtitle,
        COALESCE(v_ae_name, 'Account Executive'),
        v_body,
        'View Account Overview',
        'https://pms.faceprepcampus.com/ae/overview'
      );
    END IF;

    -- 2. Notify Campus CPCs assigned to targeted campuses (C1)
    v_subject := 'New Campus Placement Drive Active — ' || new.company_name;
    v_title := 'New Campus Placement Drive Active';
    v_subtitle := 'A new placement drive has been published for eligible students at your campus.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || COALESCE(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
              'The drive is now active on the student portal. Please ensure eligible candidates complete their applications before the deadline.';

    FOR v_cpc_rec IN
      SELECT DISTINCT u.email, u.full_name
        FROM (
          SELECT p.email, p.full_name
            FROM staff_campus_assignments a
            JOIN profiles p ON p.id = a.profile_id
            JOIN drive_target_campuses dtc ON dtc.campus_id = a.campus_id
           WHERE dtc.drive_id = new.id
             AND p.role = 'campus_placement_coordinator'
             AND p.is_active = true
             AND p.id IS DISTINCT FROM new.created_by
             AND p.id IS DISTINCT FROM new.published_by
             AND p.id IS DISTINCT FROM auth.uid()
          UNION
          SELECT sci.email, COALESCE(si.full_name, 'Campus Placement Coordinator') AS full_name
            FROM staff_campus_invitations sci
            JOIN staff_invitations si ON lower(si.email) = lower(sci.email)
            JOIN drive_target_campuses dtc ON dtc.campus_id = sci.campus_id
           WHERE dtc.drive_id = new.id
             AND si.role = 'campus_placement_coordinator'
        ) u
    LOOP
      PERFORM enqueue_direct_email(
        v_cpc_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        COALESCE(v_cpc_rec.full_name, 'Campus Placement Coordinator'),
        v_body,
        'View Drive Cohort',
        'https://pms.faceprepcampus.com/cpc/drives'
      );
    END LOOP;
  END IF;

  RETURN new;
END;
$$;

-- Also update notify_campus_cpc_on_drive_published to avoid self-notifying publisher/creator
CREATE OR REPLACE FUNCTION public.notify_campus_cpc_on_drive_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campus RECORD;
  v_cpc_email TEXT;
  v_notification_id UUID;
BEGIN
  IF NEW.status = 'live' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'live') THEN
    FOR v_campus IN
      SELECT dtc.campus_id, c.name as campus_name
      FROM drive_target_campuses dtc
      JOIN campuses c ON c.id = dtc.campus_id
      WHERE dtc.drive_id = NEW.id
    LOOP
      SELECT p.email INTO v_cpc_email
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_campus.campus_id
        AND p.role = 'campus_placement_coordinator'
        AND p.is_active = true
        AND p.email IS NOT NULL
        AND p.id IS DISTINCT FROM NEW.created_by
        AND p.id IS DISTINCT FROM NEW.published_by
        AND p.id IS DISTINCT FROM auth.uid()
      LIMIT 1;
      
      IF v_cpc_email IS NOT NULL THEN
        INSERT INTO notifications (kind, title, body, drive_id)
        VALUES (
          'campus_drive_alert',
          'New Drive Live for ' || v_campus.campus_name || ': ' || NEW.company_name,
          'A new placement drive has been published that targets eligible candidates from **' || v_campus.campus_name || '**.' || E'\n\n' ||
          '**Drive Overview**' || E'\n' ||
          '• **Company:** ' || NEW.company_name || E'\n' ||
          '• **Role:** ' || COALESCE(NEW.role_title, 'Various Roles') || E'\n' ||
          '• **Compensation:** ₹' || COALESCE(NEW.ctc_max_lpa::text, 'N/A') || ' LPA' || E'\n' ||
          '• **Application Deadline:** ' || COALESCE(TO_CHAR(NEW.application_end, 'DD Mon YYYY, HH24:MI'), 'TBD') || E'\n\n' ||
          'Please encourage eligible candidates to review the terms and apply before the deadline.',
          NEW.id
        ) RETURNING id INTO v_notification_id;
        
        INSERT INTO email_deliveries (notification_id, recipient_email, cc_emails, status)
        VALUES (
          v_notification_id, 
          lower(trim(v_cpc_email)),
          resolve_cc_recipients('campus_drive_alert', v_campus.campus_id, NEW.id),
          'queued'
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;
