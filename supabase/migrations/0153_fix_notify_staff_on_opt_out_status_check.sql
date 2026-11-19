-- 0153_fix_notify_staff_on_opt_out_status_check.sql
-- Fix 22P02 ("invalid input value for enum verification_status: 'opted_out'")
-- raised by notify_staff_on_opt_out() (introduced in 0148) on every INSERT and
-- UPDATE OF status on opt_out_requests.
--
-- Root causes fixed:
--   1. opt_out_requests.status is of enum type verification_status
--      ('pending', 'verified', 'rejected'), not participation_status ('opted_out').
--      Comparing NEW.status = 'opted_out' failed at parse/plan time on every
--      INSERT and UPDATE, causing PostgREST to return HTTP 400.
--   2. Referencing OLD.status in the same IF expression as TG_OP = 'INSERT'
--      binds OLD during INSERT triggers in PL/pgSQL. Branching explicitly on
--      TG_OP avoids touching OLD on INSERT.

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
  v_should_notify BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_notify := true;
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_notify := (NEW.status = 'verified' AND OLD.status IS DISTINCT FROM 'verified');
  END IF;

  IF v_should_notify THEN
    SELECT full_name, roll_number, campus_id, email INTO v_student
    FROM students WHERE id = NEW.student_id;

    IF FOUND AND v_student.campus_id IS NOT NULL THEN
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
            'Placement Opt-Out Notice: ' || COALESCE(v_student.full_name, 'Student') || ' (' || COALESCE(v_student.roll_number, 'N/A') || ')',
            'Candidate **' || COALESCE(v_student.full_name, 'Student') || '** (' || COALESCE(v_student.roll_number, 'N/A') || E') has submitted an opt-out from placement drives.\n\n' ||
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
