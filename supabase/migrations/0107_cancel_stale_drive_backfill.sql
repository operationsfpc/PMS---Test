-- =============================================================================
-- Migration 0107: Cancel stale drive_published backfill for old drives
-- =============================================================================
-- Migration 0106 backfilled ALL drive_published notifications that lost their
-- email_deliveries rows when migration 0104 purged them. This correctly queued
-- Newton School (Oct 12) but also re-queued old drives (Oct 8-9) whose students
-- were already notified in-app days ago.
--
-- This migration cancels the stale queued deliveries for old drives only.
-- Newton School emails (already sent) are untouched.
-- =============================================================================

-- Cancel queued drive_published emails for all drives EXCEPT Newton School
UPDATE email_deliveries
SET status = 'cancelled',
    error = 'Cancelled: stale backfill for old drive (student already notified in-app)'
WHERE status = 'queued'
  AND notification_id IN (
    SELECT n.id
    FROM notifications n
    WHERE n.kind = 'drive_published'
      AND n.drive_id != '24f559f8-b797-4735-ad21-14122aff3500'
  );
