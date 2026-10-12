-- =============================================================================
-- Migration 0109: Canonical Dispatch Setup (Edge Function + Vault-Backed Cron)
-- =============================================================================
-- Records the final email dispatch architecture. The legacy PL/pgSQL
-- dispatchers were re-created when older migrations were re-run manually,
-- silently re-enabling a fire-and-forget dispatcher (no provider_message_id,
-- no retry, no failure detection). This migration makes the Edge Function the
-- ONLY dispatcher:
--
--   cron (every 5 min) -> net.http_post -> email-dispatch edge function
--                         -> claim_email_deliveries (FOR UPDATE SKIP LOCKED)
--                         -> Resend batch API -> status sent/failed (+ retry)
--
-- PREREQUISITE (do once, via Dashboard SQL Editor):
--   SELECT vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--   (The key is a secret and is intentionally NOT embedded in this migration.)
-- =============================================================================

-- STEP 1: Unschedule every legacy dispatcher cron
DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'dispatch-emails-fixed',
    'dispatch-pending-emails-every-minute',
    'dispatch-emails-simple',
    'dispatch-pending-emails-fixed'
  ] LOOP
    BEGIN
      PERFORM cron.unschedule(j);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;

-- STEP 2: Drop legacy dispatcher functions (they held hardcoded API keys).
-- NOTE: enqueue_direct_email() and build_notification_email_html() are kept —
-- live staff-email triggers (notify_drive_lifecycle_roles, notify_cpc_on_student_offer)
-- enqueue through them and the edge function dispatches their custom HTML.
DROP FUNCTION IF EXISTS public.process_email_deliveries(int);
DROP FUNCTION IF EXISTS public.process_email_deliveries_simple(int);
DROP FUNCTION IF EXISTS public.process_email_deliveries_fixed(int);

-- STEP 3: Schedule the edge function dispatch, authenticating via vault
DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-shortlist-emails');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'dispatch-shortlist-emails',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://apzsuclpydjkmaffppmr.supabase.co/functions/v1/email-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);
