-- =============================================================================
-- Migration 0108: Atomic Email Queue Claiming + Retry + Stale-Claim Recovery
-- =============================================================================
-- Fixes two dispatch defects in the email pipeline:
--
-- 1. Duplicate sends: the edge function previously SELECTed queued rows with
--    no locking, so two concurrent invocations (cron overlap, manual run)
--    could claim the same rows and send them twice.
--    -> claim_email_deliveries() flips queued -> processing atomically using
--       FOR UPDATE SKIP LOCKED, so no two workers ever hold the same row.
--
-- 2. Lost emails: 'failed' was terminal with no retry. A transient Resend
--    429/5xx or network blip permanently lost the email.
--    -> attempts are now counted at claim time; retryable failures are
--       requeued by the edge function (max 3 attempts), and rows stuck in
--       'processing' (worker crash mid-send) are recovered by a pure-SQL cron.
-- =============================================================================

ALTER TABLE email_deliveries
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- Index for the stale-claim recovery scan
CREATE INDEX IF NOT EXISTS email_deliveries_processing_idx
  ON email_deliveries (claimed_at)
  WHERE status = 'processing';

-- -----------------------------------------------------------------------------
-- Atomic claim: queued -> processing, FIFO order, skip rows held by other workers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_email_deliveries(p_limit int DEFAULT 100)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE email_deliveries d
  SET status = 'processing',
      claimed_at = now(),
      attempts = d.attempts + 1
  WHERE d.id IN (
    SELECT e.id
    FROM email_deliveries e
    WHERE e.status = 'queued'
    ORDER BY e.updated_at ASC
    LIMIT GREATEST(coalesce(p_limit, 100), 1)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING d.id;
$$;

COMMENT ON FUNCTION claim_email_deliveries(int) IS
  'Atomically claims queued email deliveries (queued -> processing) with row locking so concurrent workers never duplicate sends.';

-- -----------------------------------------------------------------------------
-- Recovery: requeue rows stuck in processing (worker crashed after claiming).
-- Permanently fail after 3 total attempts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recover_stale_email_claims(p_stale interval DEFAULT interval '10 minutes')
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recovered int;
BEGIN
  UPDATE email_deliveries
  SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
      error = CASE
        WHEN attempts >= 3 THEN coalesce(error, '') || ' | max retries exceeded (stale claim)'
        ELSE error
      END
  WHERE status = 'processing'
    AND claimed_at < now() - p_stale;

  GET DIAGNOSTICS v_recovered = ROW_COUNT;
  RETURN v_recovered;
END;
$$;

COMMENT ON FUNCTION recover_stale_email_claims(interval) IS
  'Requeues deliveries stuck in processing longer than the stale threshold; fails them permanently after 3 attempts.';

-- -----------------------------------------------------------------------------
-- Schedule recovery job (pure SQL, no HTTP)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('recover-stale-email-claims');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'recover-stale-email-claims',
  '*/5 * * * *',
  'SELECT recover_stale_email_claims();'
);
