-- =============================================================================
-- Migration 0115: Remaining Email Templates (DH2, L2, R1-R4, AD3)
-- =============================================================================
-- Implements final missing templates:
-- - DH2: Policy Override Alert (when open_to_all_override is requested)
-- - L2: Super Dream Milestone (when super dream offer is extended)
-- - R1: Candidate Shortlist (to recruiter SPOC)
-- - R2: Drive Sourcing Kickoff (to recruiter SPOC)
-- - R3: Interview Schedule & Roster (to recruiter SPOC)
-- - R4: Drive Concluded Summary (to recruiter SPOC)
-- - AD3: Email Delivery Alert (monitoring cron for failed deliveries)
--
-- Note: AD2 (Roster Import Complete) is handled by S1 (Welcome & Registration)
-- which fires when students are imported with srf_status='invited'.
-- =============================================================================

-- =============================================================================
-- DH2: Policy Override Alert
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_dh_on_policy_override()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dh_email TEXT;
  v_notification_id UUID;
BEGIN
  -- Fire when policy override is requested (open_to_all_override changes to true)
  IF NEW.open_to_all_override = true AND (OLD.open_to_all_override IS DISTINCT FROM true OR TG_OP = 'INSERT') THEN
    -- Get Delivery Head email
    SELECT email INTO v_dh_email
    FROM profiles
    WHERE role = 'delivery_head' AND is_active = true
    LIMIT 1;
    
    IF v_dh_email IS NOT NULL THEN
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'policy_override_alert',
        'Policy Override Requested: ' || NEW.company_name,
        'A policy override has been requested for **' || NEW.company_name || '** (' || COALESCE(NEW.role_title, 'N/A') || ').' || E'\n\n' ||
        '**Override Details**' || E'\n' ||
        '• **Drive:** ' || NEW.company_name || E'\n' ||
        '• **Reason:** ' || COALESCE(NEW.open_to_all_reason, 'Not specified') || E'\n' ||
        '• **Requested By:** Central CPC' || E'\n\n' ||
        'This override allows the drive to bypass standard eligibility criteria and category caps. Please review and approve/reject the override request.',
        NEW.id
      ) RETURNING id INTO v_notification_id;
      
      -- Stage email
      INSERT INTO email_deliveries (notification_id, recipient_email, status)
      VALUES (v_notification_id, lower(trim(v_dh_email)), 'queued');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_dh_on_policy_override IS
  'DH2: Notifies Delivery Head when a policy override is requested for a drive';

DROP TRIGGER IF EXISTS notify_dh_on_policy_override ON drives;
CREATE TRIGGER notify_dh_on_policy_override
  AFTER INSERT OR UPDATE OF open_to_all_override ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_dh_on_policy_override();

-- =============================================================================
-- L2: Super Dream Milestone (for Principals/Deans)
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_leadership_on_super_dream_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campus_id UUID;
  v_campus_name TEXT;
  v_principal_email TEXT;
  v_student_name TEXT;
  v_company TEXT;
  v_ctc NUMERIC;
  v_notification_id UUID;
BEGIN
  -- Fire when offer is extended for Super Dream category
  IF NEW.offer_category = 'super_dream' AND TG_OP = 'INSERT' THEN
    -- Get student and campus info
    SELECT s.full_name, s.campus_id, c.name
    INTO v_student_name, v_campus_id, v_campus_name
    FROM students s
    JOIN campuses c ON c.id = s.campus_id
    WHERE s.id = NEW.student_id;
    
    -- Get company and CTC
    SELECT company_name, ctc_lpa INTO v_company, v_ctc
    FROM offers WHERE id = NEW.id;
    
    -- Find Principal/Dean for this campus
    SELECT p.email INTO v_principal_email
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = v_campus_id
      AND p.role IN ('principal', 'dean')
      AND p.is_active = true
      AND p.email IS NOT NULL
    LIMIT 1;
    
    IF v_principal_email IS NOT NULL THEN
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'super_dream_milestone',
        'Super Dream Offer: ' || v_student_name || ' — ' || v_company,
        'Heartiest congratulations! **' || v_student_name || '** from **' || v_campus_name || '** has received a **Super Dream** offer from **' || v_company || '** (₹' || v_ctc || ' LPA).' || E'\n\n' ||
        'This is a significant milestone for your campus placement program and a testament to the quality of your students.',
        NEW.drive_id
      ) RETURNING id INTO v_notification_id;
      
      -- Stage email
      INSERT INTO email_deliveries (notification_id, recipient_email, status)
      VALUES (v_notification_id, lower(trim(v_principal_email)), 'queued');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_leadership_on_super_dream_offer IS
  'L2: Notifies Principals/Deans when a Super Dream offer is extended to their students';

DROP TRIGGER IF EXISTS notify_leadership_on_super_dream_offer ON offers;
CREATE TRIGGER notify_leadership_on_super_dream_offer
  AFTER INSERT ON offers
  FOR EACH ROW EXECUTE FUNCTION notify_leadership_on_super_dream_offer();

-- =============================================================================
-- R1: Candidate Shortlist (to Recruiter SPOC)
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_recruiter_on_shortlist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recruiter_email TEXT;
  v_shortlist_count INT;
  v_notification_id UUID;
BEGIN
  -- Fire when shortlist is published (using drive_applications status change)
  -- This is a simplified version - actual implementation depends on shortlist workflow
  -- For now, we'll create a manual function that can be called after shortlist is published
  
  -- Get recruiter SPOC email
  SELECT spoc_email INTO v_recruiter_email
  FROM drives WHERE id = NEW.drive_id;
  
  IF v_recruiter_email IS NOT NULL AND trim(v_recruiter_email) <> '' THEN
    -- Count shortlisted candidates
    SELECT COUNT(*) INTO v_shortlist_count
    FROM drive_applications
    WHERE drive_id = NEW.drive_id AND status = 'shortlisted';
    
    IF v_shortlist_count > 0 THEN
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'recruiter_shortlist',
        'Candidate Shortlist Published: ' || NEW.company_name,
        'The candidate shortlist for **' || NEW.company_name || '** has been published.' || E'\n\n' ||
        '**Shortlist Summary**' || E'\n' ||
        '• **Total Shortlisted:** ' || v_shortlist_count || ' candidates' || E'\n' ||
        '• **Next Steps:** Review candidate profiles and schedule rounds' || E'\n\n' ||
        'Please review the shortlisted candidates and proceed with the next rounds.',
        NEW.drive_id
      ) RETURNING id INTO v_notification_id;
      
      -- Stage email
      INSERT INTO email_deliveries (notification_id, recipient_email, status)
      VALUES (v_notification_id, lower(trim(v_recruiter_email)), 'queued');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_recruiter_on_shortlist IS
  'R1: Notifies recruiter SPOC when candidate shortlist is published';

-- Note: This trigger needs to be attached to the appropriate event
-- For now, it's a placeholder that can be called manually or attached to a shortlist publication workflow

-- =============================================================================
-- R2: Drive Sourcing Kickoff (to Recruiter SPOC)
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_recruiter_on_drive_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recruiter_email TEXT;
  v_notification_id UUID;
BEGIN
  -- Fire when drive is published (status = 'live')
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
      
      -- Stage email
      INSERT INTO email_deliveries (notification_id, recipient_email, status)
      VALUES (v_notification_id, lower(trim(v_recruiter_email)), 'queued');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_recruiter_on_drive_published IS
  'R2: Notifies recruiter SPOC when drive is published and applications open';

DROP TRIGGER IF EXISTS notify_recruiter_on_drive_published ON drives;
CREATE TRIGGER notify_recruiter_on_drive_published
  AFTER INSERT OR UPDATE OF status ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_recruiter_on_drive_published();

-- =============================================================================
-- R3: Interview Schedule & Roster (to Recruiter SPOC)
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_recruiter_on_round_scheduled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recruiter_email TEXT;
  v_company TEXT;
  v_candidate_count INT;
  v_notification_id UUID;
BEGIN
  -- Fire when round is scheduled
  IF TG_OP = 'INSERT' THEN
    SELECT d.company_name, d.spoc_email
    INTO v_company, v_recruiter_email
    FROM drives d WHERE d.id = NEW.drive_id;
    
    IF v_recruiter_email IS NOT NULL AND trim(v_recruiter_email) <> '' THEN
      -- Count candidates scheduled for this round
      SELECT COUNT(*) INTO v_candidate_count
      FROM applications
      WHERE drive_id = NEW.drive_id AND status = 'applied';
      
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'recruiter_interview_schedule',
        'Interview Round Scheduled: ' || v_company,
        'A new interview round has been scheduled for **' || v_company || '**.' || E'\n\n' ||
        '**Round Details**' || E'\n' ||
        '• **Round:** ' || COALESCE(NEW.name, 'Round ' || NEW.sequence) || E'\n' ||
        '• **Date/Time:** ' || COALESCE(TO_CHAR(NEW.scheduled_at, 'DD Mon YYYY, HH24:MI'), 'TBD') || E'\n' ||
        '• **Candidates:** ' || v_candidate_count || ' students' || E'\n\n' ||
        'Please review the candidate roster and prepare for the interview session.',
        NEW.drive_id
      ) RETURNING id INTO v_notification_id;
      
      -- Stage email
      INSERT INTO email_deliveries (notification_id, recipient_email, status)
      VALUES (v_notification_id, lower(trim(v_recruiter_email)), 'queued');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_recruiter_on_round_scheduled IS
  'R3: Notifies recruiter SPOC when interview rounds are scheduled';

DROP TRIGGER IF EXISTS notify_recruiter_on_round_scheduled ON drive_rounds;
CREATE TRIGGER notify_recruiter_on_round_scheduled
  AFTER INSERT ON drive_rounds
  FOR EACH ROW EXECUTE FUNCTION notify_recruiter_on_round_scheduled();

-- =============================================================================
-- R4: Drive Concluded Summary (to Recruiter SPOC)
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_recruiter_on_drive_concluded()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recruiter_email TEXT;
  v_total_offers INT;
  v_total_candidates INT;
  v_notification_id UUID;
BEGIN
  -- Fire when drive status changes to 'completed' ('concluded' is not an enum value)
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT spoc_email INTO v_recruiter_email
    FROM drives WHERE id = NEW.id;
    
    IF v_recruiter_email IS NOT NULL AND trim(v_recruiter_email) <> '' THEN
      -- Count offers and candidates
      SELECT COUNT(*) INTO v_total_offers
      FROM offers WHERE drive_id = NEW.id;
      
      SELECT COUNT(DISTINCT student_id) INTO v_total_candidates
      FROM applications WHERE drive_id = NEW.id;
      
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'recruiter_drive_concluded',
        'Drive Concluded: ' || NEW.company_name || ' — Final Summary',
        'Your placement drive for **' || NEW.company_name || '** has been concluded.' || E'\n\n' ||
        '**Final Summary**' || E'\n' ||
        '• **Total Candidates:** ' || v_total_candidates || E'\n' ||
        '• **Offers Extended:** ' || v_total_offers || E'\n' ||
        '• **Drive Status:** Concluded' || E'\n\n' ||
        'Thank you for partnering with us. Please review the final report and provide feedback for future drives.',
        NEW.id
      ) RETURNING id INTO v_notification_id;
      
      -- Stage email
      INSERT INTO email_deliveries (notification_id, recipient_email, status)
      VALUES (v_notification_id, lower(trim(v_recruiter_email)), 'queued');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_recruiter_on_drive_concluded IS
  'R4: Notifies recruiter SPOC when drive is concluded with final summary';

DROP TRIGGER IF EXISTS notify_recruiter_on_drive_concluded ON drives;
CREATE TRIGGER notify_recruiter_on_drive_concluded
  AFTER UPDATE OF status ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_recruiter_on_drive_concluded();

-- =============================================================================
-- AD3: Email Delivery Alert (Monitoring Cron)
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_admin_on_delivery_failures()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_email TEXT;
  v_failed_count INT;
  v_notification_id UUID;
BEGIN
  -- Get admin email
  SELECT email INTO v_admin_email
  FROM profiles
  WHERE role = 'admin' AND is_active = true
  LIMIT 1;
  
  -- Count failed deliveries in last hour
  SELECT COUNT(*) INTO v_failed_count
  FROM email_deliveries
  WHERE status = 'failed'
    AND updated_at >= now() - interval '1 hour';
  
  IF v_admin_email IS NOT NULL AND v_failed_count > 0 THEN
    INSERT INTO notifications (kind, title, body)
    VALUES (
      'email_delivery_alert',
      'Email Delivery Failures Detected',
      'There have been **' || v_failed_count || '** email delivery failures in the last hour.' || E'\n\n' ||
      '**Action Required**' || E'\n' ||
      '• Check the Resend dashboard for delivery status' || E'\n' ||
      '• Review database logs for error details' || E'\n' ||
      '• Verify email addresses and content formatting' || E'\n\n' ||
      'Please investigate and resolve the delivery issues.'
    ) RETURNING id INTO v_notification_id;
    
    -- Stage email
    INSERT INTO email_deliveries (notification_id, recipient_email, status)
    VALUES (v_notification_id, lower(trim(v_admin_email)), 'queued');
  END IF;
END;
$$;

COMMENT ON FUNCTION notify_admin_on_delivery_failures IS
  'AD3: Hourly monitoring cron that alerts admin about email delivery failures';

-- Schedule cron job (every hour)
SELECT cron.schedule(
  'email_delivery_alert',
  '0 * * * *',
  $$SELECT notify_admin_on_delivery_failures()$$
);
