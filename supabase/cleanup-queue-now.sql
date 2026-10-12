-- =====================================================
-- IMMEDIATE ACTION: Clean queue & keep only shortlist
-- Run this in Supabase Dashboard → SQL Editor
-- =====================================================

-- 1. Disable the broken cron (uses INVALID API key)
DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-pending-emails-every-minute');
  RAISE NOTICE '✓ Disabled broken cron: dispatch-pending-emails-every-minute';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '✓ Cron already disabled';
END $$;

-- 2. Delete ALL non-shortlist emails from queue
-- (drive_published, srf_approved, srf_rejected, welcome, application_confirmed, offer)
DELETE FROM email_deliveries
WHERE notification_id IN (
  SELECT id FROM notifications WHERE kind != 'shortlisted'
);

-- 3. Reset fake-sent shortlist emails back to queued
UPDATE email_deliveries
SET status = 'queued',
    updated_at = now()
WHERE status = 'sent'
  AND provider_message_id IS NULL
  AND notification_id IN (
    SELECT id FROM notifications WHERE kind = 'shortlisted'
  );

-- 4. Show what's left
SELECT
  n.kind,
  ed.status,
  count(*) as count
FROM email_deliveries ed
JOIN notifications n ON n.id = ed.notification_id
GROUP BY n.kind, ed.status
ORDER BY n.kind, ed.status;

-- 5. Show shortlist emails ready to send
SELECT
  ed.id,
  ed.recipient_email,
  n.title,
  ed.updated_at
FROM email_deliveries ed
JOIN notifications n ON n.id = ed.notification_id
WHERE n.kind = 'shortlisted' AND ed.status = 'queued'
ORDER BY ed.updated_at ASC;
