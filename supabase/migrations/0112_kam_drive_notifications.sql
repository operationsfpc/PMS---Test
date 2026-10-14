-- =============================================================================
-- Migration 0112: KAM (Key Account Manager) Drive Notifications
-- =============================================================================
-- Notifies KAMs when a new drive is published to their assigned campuses.
-- Uses staff_campus_assignments to link KAMs to campuses.
--
-- Trigger: notify_kam_on_drive_published()
-- Fires: AFTER INSERT OR UPDATE OF status ON drives
-- Condition: status changes to 'published'
-- Recipients: KAMs, Enterprise Relations, ER Heads for target campuses
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_kam_on_drive_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kam_emails TEXT[];
  v_kam_email TEXT;
  v_campus RECORD;
  v_notification_id UUID;
BEGIN
  -- Only fire when drive is published (status changes to 'published')
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    -- Get all target campuses for this drive
    FOR v_campus IN
      SELECT dtc.campus_id, c.name as campus_name
      FROM drive_target_campuses dtc
      JOIN campuses c ON c.id = dtc.campus_id
      WHERE dtc.drive_id = NEW.id
    LOOP
      -- Find KAMs/Enterprise Relations for this campus
      SELECT ARRAY_AGG(DISTINCT p.email) INTO v_kam_emails
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_campus.campus_id
        AND p.role IN ('key_account_manager', 'enterprise_relations', 'er_head')
        AND p.is_active = true
        AND p.email IS NOT NULL;
      
      -- Send notification to each KAM
      IF v_kam_emails IS NOT NULL AND array_length(v_kam_emails, 1) > 0 THEN
        FOREACH v_kam_email IN ARRAY v_kam_emails LOOP
          -- Create notification for KAM (no student_id, uses profiles.email lookup)
          INSERT INTO notifications (kind, title, body, drive_id)
          VALUES (
            'kam_drive_alert',
            'New Drive Published: ' || NEW.company_name || ' — ' || v_campus.campus_name,
            'A new placement drive has been published for **' || v_campus.campus_name || '**.' || E'\n\n' ||
            '**Drive Details**' || E'\n' ||
            '• **Company:** ' || NEW.company_name || E'\n' ||
            '• **Role:** ' || NEW.role_title || E'\n' ||
            '• **Drive Type:** ' || COALESCE(NEW.drive_type::text, 'N/A') || E'\n' ||
            '• **Compensation:** ₹' || COALESCE(NEW.ctc_max_lpa::text, 'N/A') || ' LPA' || E'\n' ||
            '• **Application Deadline:** ' || COALESCE(TO_CHAR(NEW.application_end, 'DD Mon YYYY, HH24:MI'), 'TBD') || E'\n\n' ||
            'Please coordinate with the campus placement team to ensure eligible candidates are informed.',
            NEW.id
          ) RETURNING id INTO v_notification_id;
          
          -- Stage email for KAM (direct insert, no student opt-out check)
          INSERT INTO email_deliveries (notification_id, recipient_email, status)
          VALUES (v_notification_id, lower(trim(v_kam_email)), 'queued');
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_kam_on_drive_published IS 
  'Notifies KAMs/Enterprise Relations when a drive is published to their assigned campuses';

DROP TRIGGER IF EXISTS notify_kam_on_drive_published ON drives;
CREATE TRIGGER notify_kam_on_drive_published
  AFTER INSERT OR UPDATE OF status ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_kam_on_drive_published();
