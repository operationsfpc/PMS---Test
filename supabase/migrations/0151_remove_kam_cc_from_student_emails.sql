-- 0151_remove_kam_cc_from_student_emails.sql
--
-- Ensures student notifications (specifically drive_published) never CC staff
-- (Key Account Manager, Campus Manager, Enterprise Relations, ER Head).
-- Staff receive their own dedicated summary alerts (kam_drive_alert, campus_drive_alert).

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
  -- Central CPC is CC'ed ONLY on campus_shortlist_ready, NEVER when drives go live
  IF p_notification_kind = 'campus_shortlist_ready' THEN
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

  ELSIF p_notification_kind = 'campus_drive_alert' THEN
    -- Central Placement Coordinator is excluded: no email sent to Central CPC when drives go live
    v_cc_emails := '{}';
  
  ELSIF p_notification_kind = 'drive_published' THEN
    -- Student emails must NEVER CC staff (KAM, Campus Manager, ER, ER Head). Staff receive their own summary alert.
    v_cc_emails := '{}';
  END IF;
  
  RETURN COALESCE(v_cc_emails, '{}');
END;
$function$;
