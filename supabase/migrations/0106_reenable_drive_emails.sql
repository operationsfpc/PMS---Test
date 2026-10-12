-- =============================================================================
-- Migration 0106: Re-enable drive_published emails + backfill missing deliveries
-- =============================================================================
-- Migration 0104 restricted the notification → email trigger to shortlisted
-- only, as an emergency brake while the dispatch system was being rebuilt.
-- The Edge Function (email-dispatch) now handles drive_published correctly,
-- and the cron job (0105) fires it every 5 minutes. This migration:
--
-- 1. Updates enqueue_notification_email() to allow both 'shortlisted' AND
--    'drive_published' notifications into email_deliveries.
-- 2. Backfills email_deliveries rows for existing drive_published notifications
--    that were created while the trigger was blocked (Newton School: 30 students).
-- =============================================================================

-- STEP 1: Allow shortlisted + drive_published through the trigger
CREATE OR REPLACE FUNCTION enqueue_notification_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
  v_opted boolean;
BEGIN
  -- Only shortlisted and drive_published notifications enter the email outbox
  IF new.kind NOT IN ('shortlisted', 'drive_published') THEN
    RETURN new;
  END IF;

  SELECT email, (participation_status = 'opted_out')
    INTO v_email, v_opted
    FROM students
   WHERE id = new.student_id;

  -- Opted-out students or missing emails do not receive email
  IF v_opted OR v_email IS NULL OR trim(v_email) = '' THEN
    RETURN new;
  END IF;

  INSERT INTO email_deliveries (notification_id, recipient_email, status)
  VALUES (new.id, lower(trim(v_email)), 'queued')
  ON CONFLICT (notification_id, recipient_email) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS notification_enqueues_email ON notifications;
CREATE TRIGGER notification_enqueues_email
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION enqueue_notification_email();

COMMENT ON FUNCTION enqueue_notification_email() IS
  'Enqueues shortlisted and drive_published notifications into email_deliveries for dispatch via the email-dispatch edge function.';

-- STEP 2: Backfill drive_published notifications that have no email delivery yet
INSERT INTO email_deliveries (notification_id, recipient_email, status)
SELECT n.id, lower(trim(s.email)), 'queued'
FROM notifications n
JOIN students s ON s.id = n.student_id
WHERE n.kind = 'drive_published'
  AND s.participation_status != 'opted_out'
  AND s.email IS NOT NULL
  AND trim(s.email) != ''
  AND NOT EXISTS (
    SELECT 1 FROM email_deliveries ed WHERE ed.notification_id = n.id
  )
ON CONFLICT (notification_id, recipient_email) DO NOTHING;
