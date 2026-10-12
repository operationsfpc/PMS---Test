-- Reset failed emails to queued so cron job can process them immediately
-- Run this in Supabase Dashboard > SQL Editor

-- Reset all failed emails back to queued
UPDATE email_deliveries
SET status = 'queued',
    updated_at = now()
WHERE status = 'failed';

-- Verify the reset
SELECT 
  status,
  COUNT(*) as count
FROM email_deliveries
GROUP BY status;

-- Show what will be sent
SELECT 
  n.kind,
  COUNT(*) as count,
  MIN(ed.updated_at) as oldest,
  MAX(ed.updated_at) as newest
FROM email_deliveries ed
LEFT JOIN notifications n ON n.id = ed.notification_id
WHERE ed.status = 'queued'
GROUP BY n.kind;
