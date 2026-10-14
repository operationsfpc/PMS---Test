-- 0117 — Fix Invalid 'published' Value in drive_status Triggers
--
-- The drive_status enum consists of:
-- ('draft', 'submitted', 'approved', 'live', 'applications_closed', 'in_rounds', 'completed', 'rejected')
--
-- Migrations 0112, 0113, 0114, and 0115 checked for NEW.status = 'published',
-- causing PostgreSQL to reject any INSERT/UPDATE on table drives with:
-- "ERROR: invalid input value for enum drive_status: 'published'"
--
-- This migration updates all trigger functions to check for NEW.status = 'live'
-- matching the canonical drive_status enum.

-- 1. Fix KAM notification trigger function
CREATE OR REPLACE FUNCTION notify_kam_on_drive_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      SELECT ARRAY_AGG(p.email) INTO v_kam_emails
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_campus.campus_id
        AND p.role IN ('campus_manager', 'key_account_manager', 'enterprise_relations', 'er_head');
      
      IF v_kam_emails IS NOT NULL AND array_length(v_kam_emails, 1) > 0 THEN
        FOREACH v_kam_email IN ARRAY v_kam_emails
        LOOP
          INSERT INTO notifications (kind, title, body, drive_id, campus_id)
          VALUES (
            'drive_published',
            'New Drive Published: ' || NEW.company_name || ' — ' || v_campus.campus_name,
            'A new placement drive has been published for **' || v_campus.campus_name || '**.' || E'\n\n' ||
            '**Company:** ' || NEW.company_name || E'\n' ||
            '**Role:** ' || COALESCE(NEW.role_title, 'Various Roles') || E'\n' ||
            '**Mode:** ' || COALESCE(NEW.drive_mode::TEXT, 'Not specified') || E'\n' ||
            '**Application Deadline:** ' || COALESCE(TO_CHAR(NEW.tentative_date, 'DD Mon YYYY'), 'To be announced') || E'\n\n' ||
            'Please coordinate with campus placement coordinators to ensure student readiness.',
            NEW.id,
            v_campus.campus_id
          )
          RETURNING id INTO v_notification_id;
          
          INSERT INTO notification_recipients (notification_id, recipient_email, status)
          VALUES (v_notification_id, v_kam_email, 'queued');
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 2. Fix Campus CPC notification trigger function
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
      SELECT p.email INTO v_cpc_email
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_campus.campus_id
        AND p.role = 'campus_placement_coordinator'
      LIMIT 1;
      
      IF v_cpc_email IS NOT NULL THEN
        INSERT INTO notifications (kind, title, body, drive_id, campus_id)
        VALUES (
          'drive_published',
          'Drive Published: ' || NEW.company_name,
          'A new placement drive has been published that targets eligible candidates from **' || v_campus.campus_name || '**.' || E'\n\n' ||
          '**Company:** ' || NEW.company_name || E'\n' ||
          '**Role:** ' || COALESCE(NEW.role_title, 'Various Roles') || E'\n' ||
          '**Mode:** ' || COALESCE(NEW.drive_mode::TEXT, 'Not specified') || E'\n' ||
          '**Drive Date:** ' || COALESCE(TO_CHAR(NEW.tentative_date, 'DD Mon YYYY'), 'To be announced') || E'\n\n' ||
          'You can monitor student registrations and verification readiness in the campus coordinator dashboard.',
          NEW.id,
          v_campus.campus_id
        )
        RETURNING id INTO v_notification_id;
        
        INSERT INTO notification_recipients (notification_id, recipient_email, status)
        VALUES (v_notification_id, v_cpc_email, 'queued');
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 3. Fix Recruiter SPOC notification trigger function
CREATE OR REPLACE FUNCTION notify_recruiter_on_drive_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
        'drive_published',
        'Placement Drive Published: ' || NEW.company_name,
        'The placement drive for **' || NEW.company_name || '** is now live.' || E'\n\n' ||
        '**Role:** ' || COALESCE(NEW.role_title, 'Various Roles') || E'\n' ||
        'Eligible students can now apply.',
        NEW.id
      )
      RETURNING id INTO v_notification_id;
      
      INSERT INTO notification_recipients (notification_id, recipient_email, status)
      VALUES (v_notification_id, v_recruiter_email, 'queued');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;
