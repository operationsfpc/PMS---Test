-- 0148_email_templates_and_no_cpc_live_alerts.sql
-- 1. Exclude Central Placement Coordinator from live drive email alerts (resolve_cc_recipients).
-- 2. Exempt placement_paused from active participation gate in enqueue_notification_email().
-- 3. Add triggers for off-campus offer outcome (off_campus_verified / off_campus_rejected).
-- 4. Add trigger for student SRF resubmission (srf_resubmitted).
-- 5. Add trigger for student opt-out staff alert (student_opt_out_alert).

-- STEP 1: Update resolve_cc_recipients to NEVER CC Central CPC on campus_drive_alert
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

-- STEP 2: Update enqueue_notification_email to allow placement_paused
CREATE OR REPLACE FUNCTION public.enqueue_notification_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email  text;
  v_active boolean;
  v_campus_id uuid;
  v_cc_emails text[];
begin
  SELECT email, (participation_status = 'active'), campus_id
    INTO v_email, v_active, v_campus_id
    FROM students WHERE id = NEW.student_id;

  -- Allow placement_hold, placement_hold_released, and placement_paused even if student status is on_hold
  IF (not coalesce(v_active, false) AND NEW.kind NOT IN ('placement_hold', 'placement_hold_released', 'placement_paused'))
     OR v_email IS NULL
     OR trim(v_email) = '' THEN
    RETURN NEW;
  END IF;

  v_cc_emails := resolve_cc_recipients(NEW.kind, v_campus_id, NEW.drive_id);

  INSERT INTO email_deliveries (notification_id, recipient_email, cc_emails, status)
  VALUES (NEW.id, lower(trim(v_email)), v_cc_emails, 'queued');

  RETURN NEW;
end;
$function$;

-- STEP 3: Trigger for Off-Campus Offer Verification Outcome (Student Notification)
CREATE OR REPLACE FUNCTION public.notify_student_on_off_campus_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'verified' THEN
      INSERT INTO notifications (student_id, kind, title, body)
      VALUES (
        NEW.student_id,
        'off_campus_verified',
        'Off-Campus Placement Offer Verified — ' || NEW.company_name,
        'Your off-campus offer from **' || NEW.company_name || '** (' || COALESCE(NEW.role_title, 'Offer') || E') has been verified and recorded by your Campus Placement Coordinator.\n\nCongratulations on your achievement!'
      );
    ELSIF NEW.status = 'rejected' THEN
      INSERT INTO notifications (student_id, kind, title, body)
      VALUES (
        NEW.student_id,
        'off_campus_rejected',
        'Off-Campus Offer Verification Requires Attention — ' || NEW.company_name,
        'Your off-campus offer submission for **' || NEW.company_name || E'** could not be verified.\n\n' ||
        '**Reason:** ' || COALESCE(NEW.decision_reason, 'Incomplete or unverified documentation') || E'\n\nPlease review your submission feedback and consult with your Campus Placement Coordinator.'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_student_on_off_campus_decision ON self_placement_requests;
CREATE TRIGGER trg_notify_student_on_off_campus_decision
  AFTER UPDATE OF status ON self_placement_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_student_on_off_campus_decision();

-- STEP 4: Trigger for SRF Resubmission (Campus CPC Alert)
CREATE OR REPLACE FUNCTION public.notify_cpc_on_srf_resubmitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cpc_emails TEXT[];
  v_cpc_email TEXT;
  v_notification_id UUID;
BEGIN
  IF OLD.srf_status = 'srf_rejected' AND NEW.srf_status = 'srf_submitted' THEN
    SELECT ARRAY_AGG(DISTINCT p.email) INTO v_cpc_emails
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = NEW.campus_id
      AND p.role = 'campus_placement_coordinator'
      AND p.is_active = true
      AND p.email IS NOT NULL;

    IF v_cpc_emails IS NOT NULL AND array_length(v_cpc_emails, 1) > 0 THEN
      FOREACH v_cpc_email IN ARRAY v_cpc_emails LOOP
        INSERT INTO notifications (kind, title, body)
        VALUES (
          'srf_resubmitted',
          'Registration Form Resubmitted: ' || NEW.full_name || ' (' || NEW.roll_number || ')',
          'Candidate **' || NEW.full_name || '** (' || NEW.roll_number || E') has updated and resubmitted their Student Registration Form after revision feedback.\n\nPlease verify their profile so they become eligible for upcoming recruitment drives.'
        ) RETURNING id INTO v_notification_id;

        INSERT INTO email_deliveries (notification_id, recipient_email, status)
        VALUES (v_notification_id, lower(trim(v_cpc_email)), 'queued');
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_cpc_on_srf_resubmitted ON students;
CREATE TRIGGER trg_notify_cpc_on_srf_resubmitted
  AFTER UPDATE OF srf_status ON students
  FOR EACH ROW
  EXECUTE FUNCTION notify_cpc_on_srf_resubmitted();

-- STEP 5: Trigger for Student Opt-Out (Staff Alert)
CREATE OR REPLACE FUNCTION public.notify_staff_on_opt_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student RECORD;
  v_staff_emails TEXT[];
  v_staff_email TEXT;
  v_notification_id UUID;
BEGIN
  IF TG_OP = 'INSERT' OR (NEW.status = 'opted_out' AND OLD.status IS DISTINCT FROM 'opted_out') THEN
    SELECT full_name, roll_number, campus_id, email INTO v_student
    FROM students WHERE id = NEW.student_id;

    IF v_student.campus_id IS NOT NULL THEN
      SELECT ARRAY_AGG(DISTINCT p.email) INTO v_staff_emails
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_student.campus_id
        AND p.role IN ('campus_placement_coordinator', 'campus_manager')
        AND p.is_active = true
        AND p.email IS NOT NULL;

      IF v_staff_emails IS NOT NULL AND array_length(v_staff_emails, 1) > 0 THEN
        FOREACH v_staff_email IN ARRAY v_staff_emails LOOP
          INSERT INTO notifications (kind, title, body)
          VALUES (
            'student_opt_out_alert',
            'Placement Opt-Out Notice: ' || v_student.full_name || ' (' || v_student.roll_number || ')',
            'Candidate **' || v_student.full_name || '** (' || v_student.roll_number || E') has submitted an opt-out from placement drives.\n\n' ||
            '**Reason Provided:** ' || COALESCE(NEW.reason, 'Personal choice') || E'\n\nThe candidate status has been updated in the student directory.'
          ) RETURNING id INTO v_notification_id;

          INSERT INTO email_deliveries (notification_id, recipient_email, status)
          VALUES (v_notification_id, lower(trim(v_staff_email)), 'queued');
        END LOOP;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_staff_on_opt_out ON opt_out_requests;
CREATE TRIGGER trg_notify_staff_on_opt_out
  AFTER INSERT OR UPDATE OF status ON opt_out_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_staff_on_opt_out();
