-- Fix email dispatch: Disable cron and reset stuck emails
-- Run this in Supabase Dashboard → SQL Editor
--
-- Problem: PostgreSQL cron marks emails "sent" without confirming Resend delivery
-- Result: 21 shortlist emails show "sent" but were never actually delivered

-- 1. Disable the problematic cron job
do $$
begin
  perform cron.unschedule('dispatch-pending-emails-every-minute');
exception when others then
  null;
end;
$$;

-- 2. Reset stuck "sent" emails (no provider_message_id) back to "queued"
-- The edge function will process them and properly capture Resend's response
update email_deliveries
   set status = 'queued',
       updated_at = now()
 where status = 'sent'
   and provider_message_id is null
   and notification_id is not null;

-- 3. Verify the fix
select 
  status,
  count(*) as count,
  count(provider_message_id) as with_provider_id
from email_deliveries
group by status
order by status;
