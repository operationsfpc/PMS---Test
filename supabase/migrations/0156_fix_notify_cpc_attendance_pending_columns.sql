-- Migration 0156: Fix notify_cpc_attendance_pending trigger function
-- Fixes runtime exception: record "new" has no field "round_name" on drive_rounds INSERT
-- Table drive_rounds has columns: name, sequence, round_scheduled_at, scheduled_at.
-- Also hardens notify_recruiter_on_round_scheduled to check both round_scheduled_at and scheduled_at.

CREATE OR REPLACE FUNCTION notify_cpc_attendance_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campus RECORD;
  v_cpc_email TEXT;
  v_company TEXT;
  v_notification_id UUID;
  v_scheduled_at TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT d.company_name INTO v_company
    FROM drives d WHERE d.id = NEW.drive_id;
    
    v_scheduled_at := COALESCE(NEW.round_scheduled_at, NEW.scheduled_at);

    FOR v_campus IN
      SELECT dtc.campus_id, c.name as campus_name
      FROM drive_target_campuses dtc
      JOIN campuses c ON c.id = dtc.campus_id
      WHERE dtc.drive_id = NEW.drive_id
    LOOP
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
          '• **Round:** ' || COALESCE(NEW.name, 'Round ' || NEW.sequence) || E'\n' ||
          '• **Date:** ' || COALESCE(TO_CHAR(v_scheduled_at, 'DD Mon YYYY'), 'TBD') || E'\n' ||
          '• **Time:** ' || COALESCE(TO_CHAR(v_scheduled_at, 'HH24:MI'), 'TBD') || E'\n\n' ||
          'Please mark attendance for all participating students.',
          NEW.drive_id
        ) RETURNING id INTO v_notification_id;
        
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

CREATE OR REPLACE FUNCTION notify_recruiter_on_round_scheduled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recruiter_email TEXT;
  v_company TEXT;
  v_candidate_count INT;
  v_notification_id UUID;
  v_scheduled_at TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT d.company_name, d.spoc_email
    INTO v_company, v_recruiter_email
    FROM drives d WHERE d.id = NEW.drive_id;
    
    IF v_recruiter_email IS NOT NULL AND trim(v_recruiter_email) <> '' THEN
      SELECT COUNT(*) INTO v_candidate_count
      FROM applications
      WHERE drive_id = NEW.drive_id AND status = 'applied';
      
      v_scheduled_at := COALESCE(NEW.round_scheduled_at, NEW.scheduled_at);

      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'recruiter_interview_schedule',
        'Interview Round Scheduled: ' || v_company,
        'A new interview round has been scheduled for **' || v_company || '**.' || E'\n\n' ||
        '**Round Details**' || E'\n' ||
        '• **Round:** ' || COALESCE(NEW.name, 'Round ' || NEW.sequence) || E'\n' ||
        '• **Date/Time:** ' || COALESCE(TO_CHAR(v_scheduled_at, 'DD Mon YYYY, HH24:MI'), 'TBD') || E'\n' ||
        '• **Candidates:** ' || v_candidate_count || ' students' || E'\n\n' ||
        'Please review the candidate roster and prepare for the interview session.',
        NEW.drive_id
      ) RETURNING id INTO v_notification_id;
      
      INSERT INTO email_deliveries (notification_id, recipient_email, status)
      VALUES (v_notification_id, lower(trim(v_recruiter_email)), 'queued');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_recruiter_on_round_scheduled ON drive_rounds;
CREATE TRIGGER notify_recruiter_on_round_scheduled
  AFTER INSERT ON drive_rounds
  FOR EACH ROW EXECUTE FUNCTION notify_recruiter_on_round_scheduled();
