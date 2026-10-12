-- =============================================================================
-- SQL SCRIPT: Shortlist-Only Future Email Queue & Disable Broken Cron Jobs
-- Run this in Supabase Dashboard -> SQL Editor
-- =============================================================================

-- STEP 1: Unschedule all broken PostgreSQL cron jobs
DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-pending-emails-every-minute');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-emails-simple');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-pending-emails-fixed');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- STEP 2: Drop legacy functions that held hardcoded/invalid API keys
DROP FUNCTION IF EXISTS process_email_deliveries(int);
DROP FUNCTION IF EXISTS process_email_deliveries_simple(int);
DROP FUNCTION IF EXISTS build_notification_email_html(text, text, text, text, text, text, text);

-- STEP 3: Restrict enqueue_notification_email() to shortlist notifications ONLY
CREATE OR REPLACE FUNCTION enqueue_notification_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
  v_opted boolean;
BEGIN
  -- STRICT RULE: Only 'shortlisted' notifications enter the email outbox
  IF new.kind != 'shortlisted' THEN
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
  'Enqueues ONLY shortlisted notifications into email_deliveries for future outbound dispatch via the email-dispatch edge function.';

-- STEP 4: Ensure email_deliveries table has unique constraint for idempotency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_delivery_notification_recipient'
  ) THEN
    ALTER TABLE email_deliveries
    ADD CONSTRAINT uq_email_delivery_notification_recipient
    UNIQUE (notification_id, recipient_email);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- STEP 5: Clear any pending queue entries so NO mail is sent right now
DELETE FROM email_deliveries
WHERE status = 'queued';

-- Remove non-shortlist delivery rows
DELETE FROM email_deliveries
WHERE notification_id IN (
  SELECT id FROM notifications WHERE kind != 'shortlisted'
);

-- STEP 6: Verify current status
SELECT
  status,
  count(*) as count
FROM email_deliveries
GROUP BY status;
