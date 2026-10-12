-- Migration 0083: Fix email dispatch to properly track Resend delivery
--
-- Problem: Migration 0078 uses pg_net which is async fire-and-forget.
-- It marks emails as 'sent' without checking if Resend API succeeded.
-- Result: 1000+ emails marked 'sent' but never actually delivered.
--
-- Solution:
-- 1. Reset all 'sent' emails without provider_message_id back to 'queued'
-- 2. Disable the broken cron job from 0078
-- 3. Manually invoke the edge function to process the queue
--
-- The edge function (email-dispatch) properly checks Resend API responses
-- and only marks emails as 'sent' when Resend confirms delivery.

-- 1. Reset emails that were marked 'sent' but never actually sent
update email_deliveries
   set status = 'queued',
       updated_at = now()
 where status = 'sent'
   and provider_message_id is null;

-- 2. Disable the broken cron job
do $$
begin
  perform cron.unschedule('dispatch-pending-emails-every-minute');
exception when others then
  null;
end;
$$;

-- 3. Log the fix
do $$
declare
  v_reset_count int;
begin
  select count(*) into v_reset_count
    from email_deliveries
   where status = 'queued';

  raise notice 'Migration 0083: Reset % emails to queued status. Disabled broken cron job.', v_reset_count;
  raise notice 'Next step: Manually invoke the email-dispatch edge function to process the queue.';
end $$;
