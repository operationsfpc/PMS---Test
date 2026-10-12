-- =====================================================
-- CLEAN UP EMAIL QUEUE - KEEP ONLY SHORTLIST EMAILS
-- =====================================================
-- This script:
-- 1. Shows current cron jobs
-- 2. Disables the broken PostgreSQL cron job
-- 3. Removes all non-shortlist emails from queue
-- 4. Resets fake-sent shortlist emails back to queued
-- 5. Shows final queue status

-- =====================================================
-- STEP 1: Check current cron jobs
-- =====================================================
DO $$
DECLARE
  job_record record;
BEGIN
  RAISE NOTICE '=== CURRENT CRON JOBS ===';
  FOR job_record IN
    SELECT jobname, schedule, command
    FROM cron.job
    ORDER BY jobname
  LOOP
    RAISE NOTICE 'Job: %, Schedule: %, Command: %',
      job_record.jobname, job_record.schedule, job_record.command;
  END LOOP;
END $$;

-- =====================================================
-- STEP 2: Disable the broken PostgreSQL cron job
-- =====================================================
-- This cron uses an INVALID API key and marks emails as "sent" without confirmation
DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-pending-emails-every-minute');
  RAISE NOTICE 'Disabled cron: dispatch-pending-emails-every-minute';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cron dispatch-pending-emails-every-minute was not scheduled (already disabled)';
END $$;

-- =====================================================
-- STEP 3: Delete all non-shortlist emails from queue
-- =====================================================
-- Remove all queued emails EXCEPT shortlist notifications
DELETE FROM email_deliveries
WHERE status = 'queued'
  AND notification_id IN (
    SELECT id FROM notifications
    WHERE kind != 'shortlisted'
  );

-- Also delete fake-sent non-shortlist emails (no provider_message_id)
DELETE FROM email_deliveries
WHERE status = 'sent'
  AND provider_message_id IS NULL
  AND notification_id IN (
    SELECT id FROM notifications
    WHERE kind != 'shortlisted'
  );

-- =====================================================
-- STEP 4: Reset fake-sent shortlist emails back to queued
-- =====================================================
-- These were marked "sent" but never actually delivered (no provider confirmation)
UPDATE email_deliveries
SET status = 'queued',
    updated_at = now()
WHERE status = 'sent'
  AND provider_message_id IS NULL
  AND notification_id IN (
    SELECT id FROM notifications
    WHERE kind = 'shortlisted'
  );

-- =====================================================
-- STEP 5: Verify final queue status
-- =====================================================
DO $$
DECLARE
  queued_count int;
  sent_count int;
  shortlist_queued int;
  shortlist_sent int;
BEGIN
  -- Total counts
  SELECT count(*) INTO queued_count FROM email_deliveries WHERE status = 'queued';
  SELECT count(*) INTO sent_count FROM email_deliveries WHERE status = 'sent';

  -- Shortlist counts
  SELECT count(*) INTO shortlist_queued
  FROM email_deliveries ed
  JOIN notifications n ON n.id = ed.notification_id
  WHERE ed.status = 'queued' AND n.kind = 'shortlisted';

  SELECT count(*) INTO shortlist_sent
  FROM email_deliveries ed
  JOIN notifications n ON n.id = ed.notification_id
  WHERE ed.status = 'sent' AND n.kind = 'shortlisted';

  RAISE NOTICE '=== FINAL QUEUE STATUS ===';
  RAISE NOTICE 'Total queued emails: %', queued_count;
  RAISE NOTICE 'Total sent emails: %', sent_count;
  RAISE NOTICE 'Shortlist emails queued: %', shortlist_queued;
  RAISE NOTICE 'Shortlist emails sent: %', shortlist_sent;
END $$;

-- Show detailed breakdown by notification kind
SELECT
  n.kind,
  ed.status,
  count(*) as count,
  count(ed.provider_message_id) as with_provider_id
FROM email_deliveries ed
JOIN notifications n ON n.id = ed.notification_id
GROUP BY n.kind, ed.status
ORDER BY n.kind, ed.status;

-- =====================================================
-- STEP 6: Show shortlist emails ready to send
-- =====================================================
SELECT
  ed.id,
  ed.recipient_email,
  n.kind,
  n.title,
  ed.status,
  ed.updated_at
FROM email_deliveries ed
JOIN notifications n ON n.id = ed.notification_id
WHERE n.kind = 'shortlisted'
  AND ed.status = 'queued'
ORDER BY ed.updated_at DESC
LIMIT 20;

-- =====================================================
-- NEXT STEPS:
-- =====================================================
-- 1. Manually trigger the edge function to send shortlist emails:
--    curl -X POST https://apzsuclpydjkmaffppmr.supabase.co/functions/v1/email-dispatch \
--      -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
--      -H "Content-Type: application/json"
--
-- 2. Set up a cron schedule in Supabase Dashboard to run the edge function:
--    - Go to Dashboard → Edge Functions → email-dispatch → Triggers
--    - Add cron trigger: every 5 minutes
--    - Or use pg_cron to call the edge function via pg_net
--
-- 3. Verify emails are delivered by checking Resend dashboard:
--    https://resend.com
-- =====================================================
