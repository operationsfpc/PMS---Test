-- =============================================================================
-- Migration 0141: Fix drive_rounds insert trigger and participant slot notice
-- =============================================================================
-- 1. notify_cpc_attendance_pending (from 0113) referenced non-existent columns:
--    NEW.round_name, NEW.round_number, NEW.scheduled_date, NEW.scheduled_time.
--    The actual columns on drive_rounds are: name, sequence, scheduled_at.
--    This caused every round addition (POST /rest/v1/drive_rounds) to fail
--    with 400 Bad Request ("record new has no field round_name").
--
-- 2. meeting_slot_reaches_student (from 0126) assumed meeting_link was always
--    a URL and blindly prepended ". Your meeting link: ". If a coordinator
--    enters a comment or note, it produced bizarre notices like:
--    "Your meeting link: Congratulations you have cleared the 1st round."
--    Now checks if meeting_link is a URL vs comment/note.
-- =============================================================================

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
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT d.company_name INTO v_company
    FROM drives d WHERE d.id = NEW.drive_id;
    
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
          '• **Date:** ' || COALESCE(TO_CHAR(NEW.scheduled_at, 'DD Mon YYYY'), 'TBD') || E'\n' ||
          '• **Time:** ' || COALESCE(TO_CHAR(NEW.scheduled_at, 'HH24:MI'), 'TBD') || E'\n\n' ||
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

CREATE OR REPLACE FUNCTION meeting_slot_reaches_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student           uuid;
  v_company           text;
  v_sequence          integer;
  v_out_of_placements boolean;
  v_has_url           boolean;
  v_has_time          boolean;
  v_title             text;
  v_body              text;
BEGIN
  IF NEW.meeting_link IS NOT DISTINCT FROM OLD.meeting_link
     AND NEW.participant_scheduled_at IS NOT DISTINCT FROM OLD.participant_scheduled_at THEN
    RETURN NEW;
  END IF;
  IF NEW.meeting_link IS NULL AND NEW.participant_scheduled_at IS NULL THEN
    RETURN NEW;  -- clearing a slot is housekeeping, not news
  END IF;

  SELECT a.student_id, d.company_name, r.sequence,
         s.participation_status <> 'active'
    INTO v_student, v_company, v_sequence, v_out_of_placements
    FROM applications a
    JOIN drives d ON d.id = a.drive_id
    JOIN students s ON s.id = a.student_id
    JOIN drive_rounds r ON r.id = NEW.round_id
   WHERE a.id = NEW.application_id;

  IF v_out_of_placements THEN
    RETURN NEW;
  END IF;

  v_has_url  := NEW.meeting_link IS NOT NULL AND NEW.meeting_link ~* '^https?://';
  v_has_time := NEW.participant_scheduled_at IS NOT NULL;

  IF v_has_time OR v_has_url THEN
    v_title := v_company || ' — your Round ' || v_sequence || ' slot';
  ELSE
    v_title := v_company || ' — Round ' || v_sequence || ' update';
  END IF;

  v_body := 'Your Round ' || v_sequence || ' of ' || v_company
    || CASE WHEN v_has_time
            THEN ' is at '
              || TO_CHAR(NEW.participant_scheduled_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
              || ' IST'
            ELSE '' END
    || CASE WHEN v_has_url
            THEN '. Your meeting link: ' || NEW.meeting_link
            WHEN NEW.meeting_link IS NOT NULL AND LENGTH(TRIM(NEW.meeting_link)) > 0
            THEN '. Note: ' || TRIM(NEW.meeting_link)
            ELSE '' END
    || CASE WHEN v_has_time OR v_has_url
            THEN '. Please report on time.'
            ELSE '' END;

  INSERT INTO notifications (student_id, kind, title, body)
  VALUES (
    v_student,
    'meeting_link',
    v_title,
    v_body
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_slot_reaches_student ON round_participants;
CREATE TRIGGER meeting_slot_reaches_student
  AFTER UPDATE ON round_participants
  FOR EACH ROW EXECUTE FUNCTION meeting_slot_reaches_student();
