-- =============================================================================
-- Migration 0111: CC Routing Infrastructure
-- =============================================================================
-- Adds CC (carbon copy) support to the email delivery system.
-- Enables multi-recipient notifications where primary recipient gets To:
-- and additional stakeholders get CC: on the same email.
--
-- CC Routing Rules:
-- - C1, C2 (Campus Drive Alert, Shortlist): To Campus CPC, CC Central CPC
-- - C6 (Campus Student Placed): To Campus CPC, CC AE, Delivery Head
-- - DH1 (PIF Submitted): To Delivery Head, CC Central CPC
-- - New drives: To eligible students, CC KAM for that campus
-- =============================================================================

-- 1. Add cc_emails column to email_deliveries
ALTER TABLE email_deliveries 
ADD COLUMN IF NOT EXISTS cc_emails TEXT[] DEFAULT '{}';

COMMENT ON COLUMN email_deliveries.cc_emails IS 
  'Array of CC recipient email addresses; empty array means no CC';

-- 2. Helper function to resolve CC recipients based on notification kind
CREATE OR REPLACE FUNCTION resolve_cc_recipients(
  p_notification_kind TEXT,
  p_campus_id UUID DEFAULT NULL,
  p_drive_id UUID DEFAULT NULL
) RETURNS TEXT[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cc_emails TEXT[] := '{}';
BEGIN
  -- C1, C2: Campus Drive Alert, Campus Shortlist Ready → CC Central CPC
  IF p_notification_kind IN ('campus_drive_alert', 'campus_shortlist_ready') THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles 
    WHERE role = 'central_placement_coordinator' 
      AND is_active = true
      AND email IS NOT NULL;
  
  -- C6: Campus Student Placed → CC AE, Delivery Head
  ELSIF p_notification_kind = 'campus_student_placed' THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles 
    WHERE role IN ('account_executive', 'delivery_head') 
      AND is_active = true
      AND email IS NOT NULL;
  
  -- DH1: PIF Submitted → CC Central CPC
  ELSIF p_notification_kind = 'pif_submitted' THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles 
    WHERE role = 'central_placement_coordinator' 
      AND is_active = true
      AND email IS NOT NULL;
  
  -- Drive published → CC KAM/Enterprise Relations for that campus
  ELSIF p_notification_kind = 'drive_published' AND p_campus_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT p.email) INTO v_cc_emails
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = p_campus_id
      AND p.role IN ('key_account_manager', 'enterprise_relations', 'er_head')
      AND p.is_active = true
      AND p.email IS NOT NULL;
  END IF;
  
  RETURN COALESCE(v_cc_emails, '{}');
END;
$$;

COMMENT ON FUNCTION resolve_cc_recipients IS 
  'Resolves CC recipient emails based on notification kind and context (campus/drive)';

-- 3. Update enqueue_notification_email() to populate CC
CREATE OR REPLACE FUNCTION enqueue_notification_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email TEXT;
  v_opted BOOLEAN;
  v_campus_id UUID;
  v_cc_emails TEXT[];
BEGIN
  -- Get student email, opt-out status, and campus
  SELECT email, (participation_status = 'opted_out'), campus_id
    INTO v_email, v_opted, v_campus_id
    FROM students WHERE id = NEW.student_id;
  
  -- Skip if opted out or no email
  IF v_opted OR v_email IS NULL OR trim(v_email) = '' THEN
    RETURN NEW;
  END IF;
  
  -- Resolve CC recipients based on notification kind
  v_cc_emails := resolve_cc_recipients(NEW.kind, v_campus_id, NEW.drive_id);
  
  -- Insert with CC
  INSERT INTO email_deliveries (notification_id, recipient_email, cc_emails, status)
  VALUES (NEW.id, lower(trim(v_email)), v_cc_emails, 'queued');
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enqueue_notification_email IS 
  'Stages notification in email_deliveries with To and CC recipients';

-- Recreate trigger to use updated function
DROP TRIGGER IF EXISTS notification_enqueues_email ON notifications;
CREATE TRIGGER notification_enqueues_email
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION enqueue_notification_email();
