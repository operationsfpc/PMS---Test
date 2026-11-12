-- 0146_send_drive_published_email_to_campus_manager.sql
--
-- Ensures Campus Managers (CM) assigned to targeted campuses receive
-- drive published notifications and emails alongside Key Account Managers (KAM).

CREATE OR REPLACE FUNCTION public.notify_kam_on_drive_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_emails TEXT[];
  v_staff_email TEXT;
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
      SELECT ARRAY_AGG(DISTINCT u.email) INTO v_staff_emails
      FROM (
        SELECT p.email
        FROM profiles p
        JOIN staff_campus_assignments sca ON sca.profile_id = p.id
        WHERE sca.campus_id = v_campus.campus_id
          AND p.role IN ('campus_manager', 'key_account_manager', 'enterprise_relations', 'er_head')
          AND p.is_active = true
          AND p.email IS NOT NULL
        UNION
        SELECT sci.email
        FROM staff_campus_invitations sci
        JOIN staff_invitations si ON lower(si.email) = lower(sci.email)
        WHERE sci.campus_id = v_campus.campus_id
          AND si.role IN ('campus_manager', 'key_account_manager', 'enterprise_relations', 'er_head')
          AND sci.email IS NOT NULL
      ) u;
      
      IF v_staff_emails IS NOT NULL AND array_length(v_staff_emails, 1) > 0 THEN
        FOREACH v_staff_email IN ARRAY v_staff_emails LOOP
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
          VALUES (v_notification_id, lower(trim(v_staff_email)), 'queued');
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

-- Update CC routing for drive_published to also include campus_manager
DROP FUNCTION IF EXISTS public.resolve_cc_recipients(text, uuid);

CREATE OR REPLACE FUNCTION public.resolve_cc_recipients(
  p_notification_kind text,
  p_campus_id uuid DEFAULT NULL::uuid,
  p_drive_id uuid DEFAULT NULL::uuid
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cc_emails TEXT[] := '{}';
BEGIN
  IF p_notification_kind IN ('campus_drive_alert', 'campus_shortlist_ready') THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles 
    WHERE role = 'central_placement_coordinator' 
      AND is_active = true
      AND email IS NOT NULL;
  
  ELSIF p_notification_kind = 'campus_student_placed' THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles 
    WHERE role IN ('account_executive', 'delivery_head') 
      AND is_active = true
      AND email IS NOT NULL;
  
  ELSIF p_notification_kind = 'pif_submitted' THEN
    v_cc_emails := '{}';
  
  ELSIF p_notification_kind = 'drive_published' AND p_campus_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT p.email) INTO v_cc_emails
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = p_campus_id
      AND p.role IN ('campus_manager', 'key_account_manager', 'enterprise_relations', 'er_head')
      AND p.is_active = true
      AND p.email IS NOT NULL;
  END IF;
  
  RETURN COALESCE(v_cc_emails, '{}');
END;
$function$;
