-- =============================================================================
-- Migration 0105: Automated Shortlist Email Dispatch Schedule for jpejihmcbgerekyiikgb
-- =============================================================================
-- 1. Ensures pg_cron and pg_net extensions are enabled.
-- 2. Sets up a clean, non-blocking scheduled cron job to trigger the
--    email-dispatch edge function every 5 minutes.
-- 3. Edge function handles:
--    - Reading queued 'shortlisted' email deliveries
--    - Batch sending via Resend API using the real production key
--    - Updating delivery status to 'sent' with provider_message_id
--    - Marking failures with proper error codes
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any legacy or conflicting jobs
DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-shortlist-emails');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

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

-- Schedule the edge function trigger every 5 minutes
SELECT cron.schedule(
  'dispatch-shortlist-emails',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jpejihmcbgerekyiikgb.supabase.co/functions/v1/email-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        ''
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

COMMENT ON EXTENSION pg_cron IS 'Scheduled jobs for PMS — executes email-dispatch edge function every 5 minutes.';
