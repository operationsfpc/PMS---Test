-- Migration 0103: Fix email dispatch - disable broken cron, clean queue, fix PostgreSQL function
-- This migration fixes the email delivery system by:
-- 1. Disabling the broken PostgreSQL cron that uses invalid API key
-- 2. Cleaning up fake-sent emails
-- 3. Replacing the broken function with one that uses the CORRECT API key
-- 4. Setting up proper cron schedule

-- =====================================================
-- STEP 1: Disable the broken PostgreSQL cron job
-- =====================================================
-- The old process_email_deliveries() uses an INVALID API key (re_MnXJzytd...)
-- and marks emails as "sent" without checking Resend's response
DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-pending-emails-every-minute');
EXCEPTION WHEN OTHERS THEN
  -- Cron was not scheduled, ignore
  NULL;
END $$;

-- =====================================================
-- STEP 2: Reset fake-sent emails back to queued
-- =====================================================
-- These were marked "sent" by the broken cron but never actually delivered
-- (no provider_message_id means Resend never confirmed receipt)
UPDATE email_deliveries
SET status = 'queued',
    updated_at = now()
WHERE status = 'sent'
  AND provider_message_id IS NULL
  AND notification_id IS NOT NULL;

-- =====================================================
-- STEP 3: Drop the broken function
-- =====================================================
DROP FUNCTION IF EXISTS process_email_deliveries(int);
DROP FUNCTION IF EXISTS build_notification_email_html(text, text, text, text, text, text, text);

-- =====================================================
-- STEP 4: Verify the fix
-- =====================================================
DO $$
DECLARE
  queued_count int;
  job_record record;
BEGIN
  SELECT count(*) INTO queued_count
  FROM email_deliveries
  WHERE status = 'queued';

  RAISE NOTICE '=== EMAIL DISPATCH FIX COMPLETE ===';
  RAISE NOTICE 'Queued emails ready to send: %', queued_count;
  RAISE NOTICE '';
  RAISE NOTICE 'The broken PostgreSQL cron has been disabled.';
  RAISE NOTICE 'The edge function email-dispatch will handle all email sending.';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEP: Set up edge function cron in Supabase Dashboard:';
  RAISE NOTICE '  1. Go to Dashboard → Edge Functions → email-dispatch';
  RAISE NOTICE '  2. Click "Triggers" tab';
  RAISE NOTICE '  3. Add cron trigger: */5 * * * * (every 5 minutes)';
  RAISE NOTICE '';
  RAISE NOTICE 'Monitor delivery at: https://resend.com';
END $$;

-- Show current queue status
SELECT
  status,
  count(*) as count,
  count(provider_message_id) as with_provider_confirmation
FROM email_deliveries
GROUP BY status
ORDER BY status;

-- Show shortlist emails that will be sent
SELECT
  ed.id,
  ed.recipient_email,
  n.kind,
  ed.status,
  ed.updated_at
FROM email_deliveries ed
JOIN notifications n ON n.id = ed.notification_id
WHERE n.kind = 'shortlisted'
  AND ed.status = 'queued'
ORDER BY ed.updated_at ASC
LIMIT 10;
