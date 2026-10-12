-- =====================================================
-- CLEAR QUEUE & PREVENT DUPLICATE SENDING
-- =====================================================
-- This script:
-- 1. Deletes all current queued emails
-- 2. Marks fake-sent emails as failed (prevents reprocessing)
-- 3. Adds unique constraint to prevent duplicate emails
-- 4. Sets up proper tracking for future emails

-- =====================================================
-- STEP 1: Clear all queued emails
-- =====================================================
DELETE FROM email_deliveries
WHERE status = 'queued';

-- =====================================================
-- STEP 2: Mark fake-sent emails as failed
-- =====================================================
UPDATE email_deliveries
SET status = 'failed',
    updated_at = now()
WHERE status = 'sent'
  AND provider_message_id IS NULL;

-- =====================================================
-- STEP 3: Add unique constraint to prevent duplicates
-- =====================================================
-- Prevent same notification from being queued twice
ALTER TABLE email_deliveries
ADD CONSTRAINT uq_email_delivery_notification_recipient
UNIQUE (notification_id, recipient_email);

-- =====================================================
-- STEP 4: Verify cleanup
-- =====================================================
SELECT
  status,
  count(*) as count
FROM email_deliveries
GROUP BY status
ORDER BY status;

-- =====================================================
-- STEP 5: Show what's left
-- =====================================================
SELECT
  n.kind,
  ed.status,
  count(*) as count
FROM email_deliveries ed
JOIN notifications n ON n.id = ed.notification_id
GROUP BY n.kind, ed.status
ORDER BY n.kind, ed.status;

-- =====================================================
-- FUTURE EMAILS:
-- =====================================================
-- New notifications will create email_deliveries via trigger
-- Edge function will send them once and mark with provider_message_id
-- Unique constraint prevents duplicate emails for same notification+recipient
-- =====================================================
