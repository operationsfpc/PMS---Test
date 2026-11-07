-- =============================================================================
-- Migration 0140: An outbound-email brake that needs no deploy
-- =============================================================================
-- Backfilling rounds and results for drives that ended long ago would mail
-- every student and coordinator on those drives all over again, years late.
-- This adds one switch - settings.'email_send_paused' - read at the single
-- point every email in the product passes through: the INSERT into
-- email_deliveries.
--
-- While the switch is on, a row that arrives as 'queued' is born 'suppressed'
-- instead. Nothing in the pipeline looks at 'suppressed':
--   * claim_email_deliveries (0108) takes only status = 'queued',
--   * the instant-dispatch trigger (0110) fires only when new.status = 'queued',
--   * recover_stale_email_claims (0108) only sees 'processing'.
-- So no mail can leave, whichever path wrote the row - the notification outbox
-- (0126), the staff lifecycle triggers (0080/0081/0129), the KAM and campus
-- digests (0112/0113), the reminder crons (0114), or the admin screen's own
-- invitation insert (src/features/admin/staff-repository.ts). Braking any one
-- of those would leave the others running, which is the failure this avoids.
--
-- 'suppressed' is a hold, not a deletion: the row still says who would have
-- been mailed and against which notification, and setting it back to 'queued'
-- sends it. Switching the brake OFF releases nothing that was suppressed while
-- it was ON - there is no backlog waiting to flood out when the brake comes off.
--
-- WHAT THIS DOES NOT SILENCE, stated rather than slipped past: the in-app bell.
-- The notifications rows are still written, so a backfilled round still appears
-- in the student's portal. Mail is the part a backfill cannot take back.
-- =============================================================================

-- 1. The switch. `coalesce` is load-bearing: no row at all means not paused,
--    so a project that has never had this migration's seed applied still sends.
CREATE OR REPLACE FUNCTION email_send_paused()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT value = 'true'::jsonb FROM settings WHERE key = 'email_send_paused'),
    false
  );
$$;

COMMENT ON FUNCTION email_send_paused() IS
  'The outbound-email brake: true when settings.email_send_paused is true. Read at the email_deliveries INSERT, so it covers every enqueue path in the product.';

-- 2. The brake, at the one chokepoint all of them share. Only a row arriving
--    as 'queued' is rewritten; anything else is left exactly as written.
CREATE OR REPLACE FUNCTION email_deliveries_suppressed_while_paused()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.status = 'queued' AND email_send_paused() THEN
    new.status := 'suppressed';
  END IF;
  RETURN new;
END;
$$;

COMMENT ON FUNCTION email_deliveries_suppressed_while_paused() IS
  'Before-insert brake: while email_send_paused() is on, a queued delivery is born suppressed so no dispatcher can claim it. Reversible per row, with nothing deleted.';

DROP TRIGGER IF EXISTS email_deliveries_suppressed_while_paused ON email_deliveries;
CREATE TRIGGER email_deliveries_suppressed_while_paused
  BEFORE INSERT ON email_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION email_deliveries_suppressed_while_paused();

-- 3. The switch itself, off. An existing key is never overwritten: a brake
--    pulled by hand must survive a re-run of this migration.
INSERT INTO settings (key, value)
VALUES ('email_send_paused', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
