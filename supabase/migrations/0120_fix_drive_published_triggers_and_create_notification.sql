-- 0120 — Fix Drive Published Notification Triggers and Add create_notification Safeguard
--
-- Background:
-- When publishing a drive (status -> 'live'), triggers on the 'drives' table fire:
-- 1. notify_kam_on_drive_published()
-- 2. notify_campus_cpc_on_drive_published()
-- 3. notify_recruiter_on_drive_published()
--
-- A previous script attempted to replace these triggers with PERFORM create_notification(...),
-- but create_notification did not exist in PostgreSQL. When Central CPC publishes a drive,
-- PostgreSQL failed with:
-- "ERROR: function create_notification(unknown, text, text, uuid[], uuid, unknown, uuid) does not exist"
--
-- This migration:
-- 1. Restores the canonical implementations of all 3 triggers using direct inserts
--    into 'notifications' and 'email_deliveries' (matching the system's email outbox queue).
-- 2. Defines create_notification(...) as a robust safeguard so any legacy or external
--    invocations succeed seamlessly.

-- =============================================================================
-- 1. Helper Function: create_notification (Safeguard)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_notification(
  p_kind text,
  p_title text,
  p_body text,
  p_recipients uuid[],
  p_drive_id uuid DEFAULT NULL::uuid,
  p_scheduled_for timestamptz DEFAULT NULL::timestamptz,
  p_campus_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_id uuid;
  v_notification_id uuid;
  v_recipient_email text;
  v_is_student boolean;
BEGIN
  IF p_recipients IS NULL OR array_length(p_recipients, 1) = 0 THEN
    RETURN;
  END IF;

  FOREACH v_recipient_id IN ARRAY p_recipients LOOP
    -- If recipient is a student, insert student notification (email auto-queued by trigger)
    SELECT EXISTS(SELECT 1 FROM students WHERE id = v_recipient_id) INTO v_is_student;
    
    IF v_is_student THEN
      INSERT INTO notifications (student_id, kind, title, body, drive_id)
      VALUES (v_recipient_id, p_kind, p_title, p_body, p_drive_id);
    ELSE
      -- Profile (staff/admin/recruiter) -> insert notification & queue email delivery
      SELECT email INTO v_recipient_email FROM profiles WHERE id = v_recipient_id;
      IF v_recipient_email IS NOT NULL AND trim(v_recipient_email) <> '' THEN
        INSERT INTO notifications (kind, title, body, drive_id)
        VALUES (p_kind, p_title, p_body, p_drive_id)
        RETURNING id INTO v_notification_id;

        INSERT INTO email_deliveries (notification_id, recipient_email, status)
        VALUES (v_notification_id, lower(trim(v_recipient_email)), 'queued');
      END IF;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.create_notification IS
  'Safeguard helper to create notifications for students or staff profiles and queue email deliveries';

-- =============================================================================
-- 2. Fix notify_kam_on_drive_published
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_kam_on_drive_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kam_emails TEXT[];
  v_kam_email TEXT;
  v_campus RECORD;
  v_notification_id UUID;
BEGIN
  -- Only fire when drive is live (status changes to 'live')
  IF NEW.status = 'live' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'live') THEN
    FOR v_campus IN
      SELECT dtc.campus_id, c.name as campus_name
      FROM drive_target_campuses dtc
      JOIN campuses c ON c.id = dtc.campus_id
      WHERE dtc.drive_id = NEW.id
    LOOP
      SELECT ARRAY_AGG(DISTINCT p.email) INTO v_kam_emails
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_campus.campus_id
        AND p.role IN ('key_account_manager', 'enterprise_relations', 'er_head')
        AND p.is_active = true
        AND p.email IS NOT NULL;
      
      IF v_kam_emails IS NOT NULL AND array_length(v_kam_emails, 1) > 0 THEN
        FOREACH v_kam_email IN ARRAY v_kam_emails LOOP
          INSERT INTO notifications (kind, title, body, drive_id)
          VALUES (
            'kam_drive_alert',
            'New Drive Published: ' || NEW.company_name || ' — ' || v_campus.campus_name,
            'A new placement drive has been published for **' || v_campus.campus_name || '**.' || E'\n\n' ||
            '**Drive Details**' || E'\n' ||
            '• **Company:** ' || NEW.company_name || E'\n' ||
            '• **Role:** ' || COALESCE(NEW.role_title, 'Various Roles') || E'\n' ||
            '• **Drive Type:** ' || COALESCE(NEW.drive_type::text, 'N/A') || E'\n' ||
            '• **Compensation:** ₹' || COALESCE(NEW.ctc_max_lpa::text, 'N/A') || ' LPA' || E'\n' ||
            '• **Application Deadline:** ' || COALESCE(TO_CHAR(NEW.application_end, 'DD Mon YYYY, HH24:MI'), 'TBD') || E'\n\n' ||
            'Please coordinate with the campus placement team to ensure eligible candidates are informed.',
            NEW.id
          ) RETURNING id INTO v_notification_id;
          
          INSERT INTO email_deliveries (notification_id, recipient_email, status)
          VALUES (v_notification_id, lower(trim(v_kam_email)), 'queued');
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_kam_on_drive_published ON drives;
CREATE TRIGGER notify_kam_on_drive_published
  AFTER INSERT OR UPDATE OF status ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_kam_on_drive_published();

-- =============================================================================
-- 3. Fix notify_campus_cpc_on_drive_published
-- =============================================================================
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

DROP TRIGGER IF EXISTS notify_campus_cpc_on_drive_published ON drives;
CREATE TRIGGER notify_campus_cpc_on_drive_published
  AFTER INSERT OR UPDATE OF status ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_campus_cpc_on_drive_published();

-- =============================================================================
-- 4. Fix notify_recruiter_on_drive_published
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_recruiter_on_drive_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recruiter_email TEXT;
  v_notification_id UUID;
BEGIN
  IF NEW.status = 'live' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'live') THEN
    SELECT spoc_email INTO v_recruiter_email
    FROM drives WHERE id = NEW.id;
    
    IF v_recruiter_email IS NOT NULL AND trim(v_recruiter_email) <> '' THEN
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'recruiter_sourcing_kickoff',
        'Drive Live: ' || NEW.company_name || ' — Applications Open',
        'Your placement drive for **' || NEW.company_name || '** (' || COALESCE(NEW.role_title, 'N/A') || ') is now live and applications are open.' || E'\n\n' ||
        '**Drive Details**' || E'\n' ||
        '• **Role:** ' || COALESCE(NEW.role_title, 'N/A') || E'\n' ||
        '• **Application Deadline:** ' || COALESCE(TO_CHAR(NEW.application_end, 'DD Mon YYYY, HH24:MI'), 'TBD') || E'\n' ||
        '• **Target Campuses:** Multiple campuses' || E'\n\n' ||
        'You can track applications and candidate progress from the recruiter portal.',
        NEW.id
      ) RETURNING id INTO v_notification_id;
      
      INSERT INTO email_deliveries (notification_id, recipient_email, status)
      VALUES (v_notification_id, lower(trim(v_recruiter_email)), 'queued');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_recruiter_on_drive_published ON drives;
CREATE TRIGGER notify_recruiter_on_drive_published
  AFTER INSERT OR UPDATE OF status ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_recruiter_on_drive_published();
