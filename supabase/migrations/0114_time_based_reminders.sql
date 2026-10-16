-- =============================================================================
-- Migration 0114: Time-Based Reminders & Digests (S12, S13, DH3, L1)
-- =============================================================================
-- Implements scheduled notifications:
-- - S12: Drive Deadline Reminder (hourly, 24h before closing)
-- - S13: Interview Day Reminder (daily 8 AM, for rounds scheduled today)
-- - DH3: Weekly Operations Digest (Monday 8 AM, for Delivery Head)
-- - L1: Weekly Leadership Digest (Monday 9 AM, for Principals/Deans)
--
-- Also fixes schema issue: makes notifications.student_id nullable to support
-- staff notifications (KAM, CPC, DH, etc.) that don't reference a student.
-- =============================================================================

-- =============================================================================
-- Schema Fix: Allow staff notifications (no student_id)
-- =============================================================================
ALTER TABLE notifications 
  ALTER COLUMN student_id DROP NOT NULL;

COMMENT ON COLUMN notifications.student_id IS
  'The student this notification is for. NULL for staff notifications (KAM, CPC, DH, etc.).';

-- =============================================================================
-- S12: Drive Deadline Reminder (24h before application closes)
-- =============================================================================
CREATE OR REPLACE FUNCTION send_drive_deadline_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_drive RECORD;
  v_student RECORD;
  v_notification_id UUID;
BEGIN
  -- Find drives closing in next 24 hours
  FOR v_drive IN
    SELECT d.id, d.company_name, d.role_title, d.application_end, d.ctc_max_lpa
    FROM drives d
    WHERE d.status = 'live'
      AND d.application_end BETWEEN now() AND now() + interval '24 hours'
  LOOP
    -- Send to all eligible students who haven't applied yet
    FOR v_student IN
      SELECT DISTINCT s.id, s.email, s.full_name
      FROM students s
      JOIN drive_target_campuses dtc ON dtc.campus_id = s.campus_id
      WHERE dtc.drive_id = v_drive.id
        AND s.srf_status = 'srf_approved'
        AND s.participation_status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM applications a
          WHERE a.drive_id = v_drive.id AND a.student_id = s.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.drive_id = v_drive.id
            AND n.student_id = s.id
            AND n.kind = 'drive_deadline_reminder'
        )
    LOOP
      -- Create notification
      INSERT INTO notifications (student_id, kind, title, body, drive_id)
      VALUES (
        v_student.id,
        'drive_deadline_reminder',
        'Closing Soon: Applications for ' || v_drive.company_name || ' Close in 24 Hours',
        'This is a reminder that applications for **' || v_drive.company_name || '** (' || v_drive.role_title || ') will close tomorrow at **' || TO_CHAR(v_drive.application_end, 'DD Mon YYYY, HH24:MI') || '**.' || E'\n\n' ||
        '**Drive Highlights**' || E'\n' ||
        '• **Role:** ' || v_drive.role_title || E'\n' ||
        '• **Compensation:** ₹' || COALESCE(v_drive.ctc_max_lpa::text, 'N/A') || ' LPA' || E'\n' ||
        '• **Application Deadline:** ' || TO_CHAR(v_drive.application_end, 'DD Mon YYYY, HH24:MI') || E'\n\n' ||
        'If you meet the eligibility criteria and wish to participate, please complete your application before the window closes.',
        v_drive.id
      ) RETURNING id INTO v_notification_id;
      
      -- Stage email (respects opt-out via enqueue_notification_email trigger)
      -- Note: Since we're directly inserting for cron, we need to check opt-out manually
      IF v_student.email IS NOT NULL AND trim(v_student.email) <> '' THEN
        INSERT INTO email_deliveries (notification_id, recipient_email, status)
        VALUES (v_notification_id, lower(trim(v_student.email)), 'queued');
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION send_drive_deadline_reminders IS
  'S12: Hourly cron that reminds students about drives closing in 24 hours';

-- Schedule cron job (every hour)
SELECT cron.schedule(
  'drive_deadline_reminder',
  '0 * * * *',
  $$SELECT send_drive_deadline_reminders()$$
);

-- =============================================================================
-- S13: Interview Day Reminder (Daily 8 AM, for rounds scheduled today)
-- =============================================================================
CREATE OR REPLACE FUNCTION send_interview_day_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_round RECORD;
  v_student RECORD;
  v_notification_id UUID;
BEGIN
  -- Find rounds scheduled for today
  FOR v_round IN
    SELECT dr.id, dr.drive_id, dr.round_name, dr.round_number, dr.scheduled_date, dr.scheduled_time,
           d.company_name, d.role_title
    FROM drive_rounds dr
    JOIN drives d ON d.id = dr.drive_id
    WHERE dr.scheduled_date = CURRENT_DATE
  LOOP
    -- Send to all students scheduled for this round
    FOR v_student IN
      SELECT DISTINCT s.id, s.email, s.full_name
      FROM students s
      JOIN drive_applications da ON da.student_id = s.id
      WHERE da.drive_id = v_round.drive_id
        AND da.status IN ('shortlisted', 'round_scheduled')
        AND s.participation_status = 'active'
    LOOP
      -- Create notification
      INSERT INTO notifications (student_id, kind, title, body, drive_id)
      VALUES (
        v_student.id,
        'interview_day_reminder',
        'Reminder: Your ' || COALESCE(v_round.round_name, 'Round ' || v_round.round_number) || ' for ' || v_round.company_name || ' Starts Today',
        'Your scheduled round for **' || v_round.company_name || '** takes place today.' || E'\n\n' ||
        '**Schedule Details**' || E'\n' ||
        '• **Round:** ' || COALESCE(v_round.round_name, 'Round ' || v_round.round_number) || E'\n' ||
        '• **Date:** ' || TO_CHAR(v_round.scheduled_date, 'DD Mon YYYY') || E'\n' ||
        '• **Time:** ' || COALESCE(TO_CHAR(v_round.scheduled_time, 'HH24:MI'), 'TBD') || E'\n\n' ||
        'Please report on time with your college ID card and student credentials ready.',
        v_round.drive_id
      ) RETURNING id INTO v_notification_id;
      
      -- Stage email
      IF v_student.email IS NOT NULL AND trim(v_student.email) <> '' THEN
        INSERT INTO email_deliveries (notification_id, recipient_email, status)
        VALUES (v_notification_id, lower(trim(v_student.email)), 'queued');
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION send_interview_day_reminders IS
  'S13: Daily 8 AM cron that reminds students about rounds scheduled today';

-- Schedule cron job (daily at 8 AM)
SELECT cron.schedule(
  'interview_day_reminder',
  '0 8 * * *',
  $$SELECT send_interview_day_reminders()$$
);

-- =============================================================================
-- DH3: Weekly Operations Digest (Monday 8 AM, for Delivery Head)
-- =============================================================================
CREATE OR REPLACE FUNCTION send_weekly_operations_digest()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dh_email TEXT;
  v_total_drives INT;
  v_active_drives INT;
  v_total_applications INT;
  v_total_offers INT;
  v_notification_id UUID;
BEGIN
  -- Get Delivery Head email
  SELECT email INTO v_dh_email
  FROM profiles
  WHERE role = 'delivery_head' AND is_active = true
  LIMIT 1;
  
  IF v_dh_email IS NULL THEN RETURN; END IF;
  
  -- Aggregate metrics for past week
  SELECT COUNT(*) INTO v_total_drives 
  FROM drives 
  WHERE created_at >= now() - interval '7 days';
  
  SELECT COUNT(*) INTO v_active_drives 
  FROM drives 
  WHERE status = 'live';
  
  SELECT COUNT(*) INTO v_total_applications 
  FROM drive_applications 
  WHERE created_at >= now() - interval '7 days';
  
  SELECT COUNT(*) INTO v_total_offers 
  FROM offers 
  WHERE declared_at >= now() - interval '7 days';
  
  -- Create notification (no student_id, staff notification)
  INSERT INTO notifications (kind, title, body)
  VALUES (
    'weekly_operations_digest',
    'Weekly Operations Digest: ' || TO_CHAR(now() - interval '7 days', 'DD Mon') || ' — ' || TO_CHAR(now(), 'DD Mon YYYY'),
    '**Weekly Placement Operations Summary**' || E'\n\n' ||
    '• **New Drives Created:** ' || v_total_drives || E'\n' ||
    '• **Active Drives:** ' || v_active_drives || E'\n' ||
    '• **New Applications:** ' || v_total_applications || E'\n' ||
    '• **Offers Extended:** ' || v_total_offers || E'\n\n' ||
    'Please review the detailed dashboard for campus-wise breakdown and pending actions.'
  ) RETURNING id INTO v_notification_id;
  
  -- Stage email
  INSERT INTO email_deliveries (notification_id, recipient_email, status)
  VALUES (v_notification_id, lower(trim(v_dh_email)), 'queued');
END;
$$;

COMMENT ON FUNCTION send_weekly_operations_digest IS
  'DH3: Monday 8 AM cron that sends weekly operations summary to Delivery Head';

-- Schedule cron job (every Monday at 8 AM)
SELECT cron.schedule(
  'weekly_operations_digest',
  '0 8 * * 1',
  $$SELECT send_weekly_operations_digest()$$
);

-- =============================================================================
-- L1: Weekly Leadership Digest (Monday 9 AM, for Principals/Deans)
-- =============================================================================
CREATE OR REPLACE FUNCTION send_weekly_leadership_digest()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campus RECORD;
  v_principal_email TEXT;
  v_active_drives INT;
  v_students_participating INT;
  v_offers_extended INT;
  v_students_placed INT;
  v_notification_id UUID;
BEGIN
  -- For each campus, send digest to Principal/Dean
  FOR v_campus IN
    SELECT c.id, c.name
    FROM campuses c
  LOOP
    -- Find Principal/Dean for this campus
    SELECT p.email INTO v_principal_email
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = v_campus.id
      AND p.role IN ('principal', 'dean')
      AND p.is_active = true
      AND p.email IS NOT NULL
    LIMIT 1;
    
    IF v_principal_email IS NOT NULL THEN
      -- Aggregate campus metrics for past week
      SELECT COUNT(DISTINCT d.id) INTO v_active_drives
      FROM drives d
      JOIN drive_target_campuses dtc ON dtc.drive_id = d.id
      WHERE dtc.campus_id = v_campus.id
        AND d.status = 'live';
      
      SELECT COUNT(DISTINCT s.id) INTO v_students_participating
      FROM students s
      JOIN drive_applications da ON da.student_id = s.id
      WHERE s.campus_id = v_campus.id
        AND da.created_at >= now() - interval '7 days';
      
      SELECT COUNT(*) INTO v_offers_extended
      FROM offers o
      JOIN students s ON s.id = o.student_id
      WHERE s.campus_id = v_campus.id
        AND o.declared_at >= now() - interval '7 days';
      
      SELECT COUNT(*) INTO v_students_placed
      FROM offers o
      JOIN students s ON s.id = o.student_id
      WHERE s.campus_id = v_campus.id
        AND o.declared_at >= now() - interval '7 days'
        AND o.approved_at IS NOT NULL;
      
      -- Create notification (no student_id, staff notification)
      INSERT INTO notifications (kind, title, body)
      VALUES (
        'weekly_placement_digest',
        'Weekly Placement Digest: ' || v_campus.name,
        '**Weekly Placement Summary for ' || v_campus.name || '**' || E'\n\n' ||
        '• **Active Drives:** ' || v_active_drives || E'\n' ||
        '• **Students Participating:** ' || v_students_participating || E'\n' ||
        '• **Offers Extended:** ' || v_offers_extended || E'\n' ||
        '• **Students Placed:** ' || v_students_placed || E'\n\n' ||
        'Please review the campus dashboard for detailed metrics.'
      ) RETURNING id INTO v_notification_id;
      
      -- Stage email
      INSERT INTO email_deliveries (notification_id, recipient_email, status)
      VALUES (v_notification_id, lower(trim(v_principal_email)), 'queued');
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION send_weekly_leadership_digest IS
  'L1: Monday 9 AM cron that sends weekly placement summary to Principals/Deans';

-- Schedule cron job (every Monday at 9 AM)
SELECT cron.schedule(
  'weekly_leadership_digest',
  '0 9 * * 1',
  $$SELECT send_weekly_leadership_digest()$$
);
