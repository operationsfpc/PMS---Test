-- Migration 0102: Fix email dispatch — disable fire-and-forget cron
--
-- Problem: The PostgreSQL function process_email_deliveries() uses pg_net.http_post
-- which is fire-and-forget (async). It marks emails as "sent" without waiting for
-- or checking Resend's response. If Resend rejects the email (invalid API key, rate
-- limit, bad address), the system still shows "sent" with no provider_message_id.
--
-- Solution: Disable the PostgreSQL cron job. The edge function email-dispatch properly
-- sends via Resend batch API, captures provider_message_id, and marks "failed" on error.
-- The edge function should be invoked by an external cron (Supabase Dashboard → Edge
-- Functions → email-dispatch → Schedule) or manually.
--
-- 2026-10-12: Shortlist emails were marked "sent" but never delivered because the
-- PostgreSQL cron fired first, marked them sent without confirmation, and the edge
-- function (which only processes "queued" emails) found nothing to send.

-- 1. Unschedule the problematic cron job
do $$
begin
  perform cron.unschedule('dispatch-pending-emails-every-minute');
exception when others then
  -- Job may not exist; ignore
  null;
end;
$$;

-- 2. Reset any stuck "sent" emails with no provider_message_id back to "queued"
-- so the edge function can process them
update email_deliveries
   set status = 'queued',
       updated_at = now()
 where status = 'sent'
   and provider_message_id is null
   and notification_id is not null;

-- 3. Add a comment documenting the fix
comment on function process_email_deliveries(int) is
  'DISABLED: This function uses fire-and-forget pg_net and marks emails as sent without confirmation. Use the email-dispatch edge function instead, which properly captures Resend responses.';

-- 4. Optional: Drop the function to prevent accidental use
-- Uncomment if you want to fully remove it:
-- drop function if exists process_email_deliveries(int);
