-- =============================================================================
-- Migration 0113: Campus CPC Notifications (C1, C2, C3, C5)
-- =============================================================================
-- Implements notifications for Campus Placement Coordinators:
-- - C1: Campus Drive Alert (when drive published to campus)
-- - C2: Campus Shortlist Ready (when shortlist published)
-- - C3: Verification Queue Digest (daily cron at 9 AM)
-- - C5: Attendance Pending (when round scheduled)
-- =============================================================================

-- =============================================================================
-- C1: Campus Drive Alert
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_campus_cpc_on_drive_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      -- Find Campus CPC for this campus
      SELECT p.email INTO v_cpc_email
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_campus.campus_id
        AND p.role = 'campus_placement_coordinator'
        AND p.is_active = true
        AND p.email IS NOT NULL
      LIMIT 1;
      
      IF v_cpc_email IS NOT NULL THEN
        INSERT INTO notifications (kind, title, body, drive_id)
        VALUES (
          'campus_drive_alert',
          'New Drive Live for ' || v_campus.campus_name || ': ' || NEW.company_name,
          'A new placement drive has been published that targets eligible candidates from **' || v_campus.campus_name || '**.' || E'\n\n' ||
          '**Drive Overview**' || E'\n' ||
          '• **Company:** ' || NEW.company_name || E'\n' ||
          '• **Role:** ' || NEW.role_title || E'\n' ||
          '• **Compensation:** ₹' || COALESCE(NEW.ctc_max_lpa::text, 'N/A') || ' LPA' || E'\n' ||
          '• **Application Deadline:** ' || COALESCE(TO_CHAR(NEW.application_end, 'DD Mon YYYY, HH24:MI'), 'TBD') || E'\n\n' ||
          'Please encourage eligible candidates to review the terms and apply before the deadline.',
          NEW.id
        ) RETURNING id INTO v_notification_id;
        
        -- Stage email with CC to Central CPC
        INSERT INTO email_deliveries (notification_id, recipient_email, cc_emails, status)
        VALUES (
          v_notification_id, 
          lower(trim(v_cpc_email)),
          resolve_cc_recipients('campus_drive_alert'),
          'queued'
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_campus_cpc_on_drive_published ON drives;
CREATE TRIGGER notify_campus_cpc_on_drive_published
  AFTER INSERT OR UPDATE OF status ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_campus_cpc_on_drive_published();

-- =============================================================================
-- C2: Campus Shortlist Ready
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_campus_cpc_on_shortlist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campus_id UUID;
  v_campus_name TEXT;
  v_cpc_email TEXT;
  v_company TEXT;
  v_role TEXT;
  v_shortlist_count INT;
  v_notification_id UUID;
BEGIN
  -- Fire when shortlist is published (assuming shortlist_status field exists or we use a different trigger point)
  -- For now, we'll create a manual trigger function that can be called after shortlist is published
  -- This is a placeholder - actual implementation depends on how shortlists are managed
  
  -- Example: If there's a shortlists table or shortlist_status in drive_applications
  -- This would need to be adapted based on actual schema
  
  RETURN NEW;
END;
$$;

-- Note: C2 trigger depends on actual shortlist implementation
-- Will be activated when shortlist publishing workflow is confirmed

-- =============================================================================
-- C3: Verification Queue Digest (Daily Cron at 9 AM)
-- =============================================================================
CREATE OR REPLACE FUNCTION send_verification_queue_digest()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campus RECORD;
  v_cpc_email TEXT;
  v_notification_id UUID;
BEGIN
  -- For each campus with pending verifications
  FOR v_campus IN
    SELECT s.campus_id, c.name as campus_name, COUNT(*) as pending_count
    FROM students s
    JOIN campuses c ON c.id = s.campus_id
    WHERE s.srf_status = 'submitted'
    GROUP BY s.campus_id, c.name
    HAVING COUNT(*) > 0
  LOOP
    -- Find Campus CPC
    SELECT p.email INTO v_cpc_email
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = v_campus.campus_id
      AND p.role = 'campus_placement_coordinator'
      AND p.is_active = true
      AND p.email IS NOT NULL
    LIMIT 1;
    
    IF v_cpc_email IS NOT NULL THEN
      INSERT INTO notifications (kind, title, body)
      VALUES (
        'verification_queue_digest',
        'Verification Queue: ' || v_campus.pending_count || ' Student Profiles Awaiting Approval',
        'There are currently student registration forms awaiting academic verification on your campus portal.' || E'\n\n' ||
        '• **Campus:** ' || v_campus.campus_name || E'\n' ||
        '• **Pending Profiles:** ' || v_campus.pending_count || ' students' || E'\n' ||
        '• **Pending Checks:** 10th/12th marks, semester CGPA, and marksheet uploads' || E'\n\n' ||
        'Prompt verification ensures these students become eligible for recruitment drives.'
      ) RETURNING id INTO v_notification_id;
      
      -- Stage email with CC to Central CPC
      INSERT INTO email_deliveries (notification_id, recipient_email, cc_emails, status)
      VALUES (
        v_notification_id,
        lower(trim(v_cpc_email)),
        resolve_cc_recipients('verification_queue_digest'),
        'queued'
      );
    END IF;
  END LOOP;
END;
$$;

-- Schedule cron job (daily at 9 AM)
SELECT cron.schedule(
  'verification_queue_digest',
  '0 9 * * *',
  $$SELECT send_verification_queue_digest()$$
);

-- =============================================================================
-- C5: Attendance Pending (when round scheduled)
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_cpc_attendance_pending()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campus RECORD;
  v_cpc_email TEXT;
  v_company TEXT;
  v_notification_id UUID;
BEGIN
  -- Fire when a round is scheduled (drive_rounds INSERT)
  IF TG_OP = 'INSERT' THEN
    -- Get company name
    SELECT d.company_name INTO v_company
    FROM drives d WHERE d.id = NEW.drive_id;
    
    -- For each target campus of this drive
    FOR v_campus IN
      SELECT dtc.campus_id, c.name as campus_name
      FROM drive_target_campuses dtc
      JOIN campuses c ON c.id = dtc.campus_id
      WHERE dtc.drive_id = NEW.drive_id
    LOOP
      -- Find Campus CPC
      SELECT p.email INTO v_cpc_email
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_campus.campus_id
        AND p.role = 'campus_placement_coordinator'
        AND p.is_active = true
        AND p.email IS NOT NULL
      LIMIT 1;
      
      IF v_cpc_email IS NOT NULL THEN
        INSERT INTO notifications (kind, title, body, drive_id)
        VALUES (
          'attendance_pending',
          'Action Required: Mark Attendance for ' || v_company || ' — ' || v_campus.campus_name,
          'A new round has been scheduled for **' || v_company || '** at **' || v_campus.campus_name || '**.' || E'\n\n' ||
          '**Round Details**' || E'\n' ||
          '• **Campus:** ' || v_campus.campus_name || E'\n' ||
          '• **Round:** ' || COALESCE(NEW.round_name, 'Round ' || NEW.round_number) || E'\n' ||
          '• **Date:** ' || COALESCE(TO_CHAR(NEW.scheduled_date, 'DD Mon YYYY'), 'TBD') || E'\n' ||
          '• **Time:** ' || COALESCE(TO_CHAR(NEW.scheduled_time, 'HH24:MI'), 'TBD') || E'\n\n' ||
          'Please mark attendance for all participating students.',
          NEW.drive_id
        ) RETURNING id INTO v_notification_id;
        
        -- Stage email
        INSERT INTO email_deliveries (notification_id, recipient_email, status)
        VALUES (v_notification_id, lower(trim(v_cpc_email)), 'queued');
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_cpc_attendance_pending ON drive_rounds;
CREATE TRIGGER notify_cpc_attendance_pending
  AFTER INSERT ON drive_rounds
  FOR EACH ROW EXECUTE FUNCTION notify_cpc_attendance_pending();
