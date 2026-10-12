-- =============================================================================
-- Migration 0110: Instant Email Dispatch on Enqueue
-- =============================================================================
-- Adds near-real-time dispatch: every INSERT into email_deliveries with
-- status='queued' immediately fires the email-dispatch edge function via
-- pg_net (async, non-blocking). Email latency drops from up to 5 minutes
-- to a few seconds.
--
-- The pg_cron job (0109) is kept as a safety net for anything the instant
-- path misses (retries requeued by the recovery cron are picked up on the
-- cron schedule — they UPDATE, not INSERT, so they do not re-fire this).
--
-- Requires: vault secret 'service_role_key' (see 0109 prerequisite).
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_instant_email_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.status = 'queued' THEN
    PERFORM net.http_post(
      url := 'https://apzsuclpydjkmaffppmr.supabase.co/functions/v1/email-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'
        )
      ),
      body := '{}'::jsonb
    );
  END IF;
  RETURN new;
END;
$$;

-- Deferred so the request is queued only after the inserting transaction
-- commits; otherwise the edge function can claim before the row is visible
-- and the delivery would fall back to the cron schedule.
DROP TRIGGER IF EXISTS email_delivery_requests_dispatch ON email_deliveries;
CREATE CONSTRAINT TRIGGER email_delivery_requests_dispatch
  AFTER INSERT ON email_deliveries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION trigger_instant_email_dispatch();

COMMENT ON FUNCTION trigger_instant_email_dispatch() IS
  'Fires the email-dispatch edge function immediately after a queued delivery commits; concurrent claim locking prevents duplicate sends when multiple rows enqueue at once.';
