# Email Dispatch Fix - Complete Guide

## Problem Summary

**Root Cause:** PostgreSQL cron job `process_email_deliveries()` uses an **INVALID API key** (`re_MnXJzytd...`) and marks emails as "sent" without checking Resend's response.

**Impact:**
- 571 emails marked "sent" but never delivered (no provider_message_id)
- 429 emails still queued (being processed by broken cron)
- **49 shortlist emails** never sent to students
- Shortlist notifications from Oct 9-11 were lost

**Why it happened:**
- Migration 0087 accidentally regressed the API key to an invalid one
- The PostgreSQL function uses fire-and-forget `pg_net.http_post`
- It marks emails "sent" immediately without waiting for/checking Resend's response
- Resend returned 401 (invalid key), but the function ignored it

## Solution Overview

1. **Disable the broken PostgreSQL cron** - stops fake-sending emails
2. **Clean the queue** - remove all non-shortlist emails (they're stale)
3. **Reset fake-sent shortlist emails** - back to "queued" status
4. **Use the edge function** - it has the correct API key and properly handles responses
5. **Set up edge function cron** - schedule it to run every 5 minutes

## Files Created

### 1. `cleanup-queue-now.sql` (RUN THIS NOW)
**Location:** `supabase/cleanup-queue-now.sql`

**What it does:**
- Disables the broken PostgreSQL cron
- Deletes all non-shortlist emails from queue
- Resets fake-sent shortlist emails back to queued
- Shows final queue status

**How to run:**
1. Go to Supabase Dashboard → SQL Editor
2. Copy/paste the entire contents of `cleanup-queue-now.sql`
3. Click "Run"
4. Verify the output shows only shortlist emails

### 2. `trigger-email-dispatch.sh` (RUN AFTER CLEANUP)
**Location:** `supabase/trigger-email-dispatch.sh`

**What it does:**
- Manually triggers the edge function to send all queued shortlist emails
- Uses the correct API key from `.env.local`

**How to run:**
```bash
cd supabase
chmod +x trigger-email-dispatch.sh
./trigger-email-dispatch.sh
```

**Expected output:**
```
HTTP Status: 200
Response: {"message":"Processed X deliveries"}
✓ Edge function triggered successfully!
```

### 3. `0103_fix_email_dispatch_schedule.sql` (PERMANENT FIX)
**Location:** `supabase/migrations/0103_fix_email_dispatch_schedule.sql`

**What it does:**
- Permanent migration that disables the broken cron
- Resets fake-sent emails
- Drops the broken PostgreSQL function
- Prevents future regressions

**How to apply:**
- This will be applied automatically when you run `supabase db push`
- OR manually in Dashboard → SQL Editor

## Step-by-Step Action Plan

### Step 1: Clean the queue (IMMEDIATE)
```bash
# Open Supabase Dashboard
# Go to: SQL Editor
# Run: cleanup-queue-now.sql
```

**Expected result:**
- Only shortlist emails remain in queue (49 queued + 3 sent)
- Broken cron is disabled
- Fake-sent shortlist emails reset to "queued"

### Step 2: Send shortlist emails (IMMEDIATE)
```bash
cd supabase
./trigger-email-dispatch.sh
```

**Expected result:**
- All 49 shortlist emails sent via Resend
- Each email gets a `provider_message_id`
- Students receive shortlist notifications

### Step 3: Verify delivery (IMMEDIATE)
1. Go to https://resend.com
2. Check your account dashboard
3. Verify 49 shortlist emails were delivered
4. Check a few student inboxes to confirm receipt

### Step 4: Set up edge function cron (WITHIN 1 HOUR)
**Option A: Via Supabase Dashboard (RECOMMENDED)**
1. Go to Dashboard → Edge Functions → `email-dispatch`
2. Click "Triggers" tab
3. Click "Add Trigger"
4. Select "Cron Schedule"
5. Enter: `*/5 * * * *` (every 5 minutes)
6. Save

**Option B: Via SQL (if Dashboard doesn't support it)**
```sql
-- This requires pg_net extension
SELECT cron.schedule(
  'dispatch-emails-via-edge-function',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://apzsuclpydjkmaffppmr.supabase.co/functions/v1/email-dispatch',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )$$
);
```

### Step 5: Test the system (WITHIN 1 DAY)
1. Create a test notification:
   ```sql
   INSERT INTO notifications (student_id, kind, title, body)
   VALUES (
     'TEST-STUDENT-ID',
     'shortlisted',
     'Test: You Are Shortlisted',
     'This is a test notification.'
   );
   ```

2. Wait 5-10 minutes (for cron to trigger)

3. Check email_deliveries:
   ```sql
   SELECT * FROM email_deliveries
   WHERE notification_id = 'TEST-NOTIFICATION-ID'
   ORDER BY updated_at DESC;
   ```

4. Verify:
   - Status changed from "queued" to "sent"
   - `provider_message_id` is populated
   - Test email received in inbox

### Step 6: Monitor ongoing (DAILY)
- Check Resend dashboard daily for delivery rates
- Monitor `email_deliveries` table for stuck emails
- Set up alerts for failed deliveries

## Verification Queries

### Check queue status
```sql
SELECT
  n.kind,
  ed.status,
  count(*) as count,
  count(ed.provider_message_id) as with_provider_id
FROM email_deliveries ed
JOIN notifications n ON n.id = ed.notification_id
GROUP BY n.kind, ed.status
ORDER BY n.kind, ed.status;
```

### Check recent deliveries
```sql
SELECT
  ed.id,
  ed.recipient_email,
  n.kind,
  ed.status,
  ed.provider_message_id IS NOT NULL as confirmed,
  ed.updated_at
FROM email_deliveries ed
JOIN notifications n ON n.id = ed.notification_id
ORDER BY ed.updated_at DESC
LIMIT 20;
```

### Check for stuck emails
```sql
SELECT
  ed.id,
  ed.recipient_email,
  n.kind,
  ed.status,
  ed.updated_at,
  extract(epoch from now() - ed.updated_at) / 60 as minutes_stuck
FROM email_deliveries ed
JOIN notifications n ON n.id = ed.notification_id
WHERE ed.status = 'queued'
  AND ed.updated_at < now() - interval '10 minutes'
ORDER BY ed.updated_at ASC;
```

### Check cron jobs
```sql
SELECT jobname, schedule, command
FROM cron.job
ORDER BY jobname;
```

## Expected Behavior After Fix

### Email Flow
1. **Notification created** → trigger fires → `email_deliveries` row created with status='queued'
2. **Edge function runs** (every 5 min) → picks up queued emails → sends via Resend
3. **Resend accepts** → returns `provider_message_id` → status updated to 'sent'
4. **Student receives email** → delivery confirmed in Resend dashboard

### What Gets Sent
- ✅ Shortlist notifications (`kind = 'shortlisted'`)
- ✅ Drive published notifications (`kind = 'drive_published'`)
- ✅ SRF approved/rejected (`kind = 'srf_approved'`, `'srf_rejected'`)
- ✅ Welcome emails (`kind = 'welcome'`)
- ✅ Offer notifications (`kind = 'offer'`)
- ✅ Application confirmations (`kind = 'application_confirmed'`)
- ✅ All other notification kinds

### What Does NOT Get Sent
- ❌ Emails with invalid recipient addresses
- ❌ Emails for deleted notifications
- ❌ Emails that fail Resend validation (checked by edge function)

## Troubleshooting

### Emails stuck in "queued" for >10 minutes
**Cause:** Edge function not running or failing

**Fix:**
1. Check edge function logs: Dashboard → Edge Functions → email-dispatch → Logs
2. Manually trigger: `./trigger-email-dispatch.sh`
3. Check for errors in the response

### Emails marked "sent" but not delivered
**Cause:** Resend accepted but delivery failed (invalid email, spam filter, etc.)

**Fix:**
1. Check Resend dashboard for delivery status
2. Look for bounce notifications
3. Verify recipient email addresses are valid

### Edge function returns 401 Unauthorized
**Cause:** Missing or invalid service role key

**Fix:**
1. Check `SUPABASE_SERVICE_ROLE_KEY` environment variable in edge function
2. Verify it matches the key in Dashboard → Settings → API

### Cron not triggering edge function
**Cause:** Cron schedule not set up or pg_net not enabled

**Fix:**
1. Verify cron job exists: `SELECT * FROM cron.job;`
2. Check pg_net is enabled: Dashboard → Database → Extensions → pg_net
3. Manually trigger edge function as workaround

## Monitoring Checklist

- [ ] Check Resend dashboard daily for delivery rates
- [ ] Monitor `email_deliveries` for stuck emails (>10 min in "queued")
- [ ] Verify cron job is running: `SELECT * FROM cron.job WHERE jobname = 'dispatch-emails-via-edge-function';`
- [ ] Check edge function logs for errors
- [ ] Test with a new notification weekly
- [ ] Review bounce/complaint reports from Resend

## Rollback Plan

If the fix causes issues, you can re-enable the old system:

```sql
-- Re-enable the broken cron (NOT RECOMMENDED)
SELECT cron.schedule(
  'dispatch-pending-emails-every-minute',
  '* * * * *',
  $$SELECT process_email_deliveries(50)$$
);
```

**Warning:** This will re-introduce the bug. Only do this if absolutely necessary and you've fixed the API key in the function.

## Success Criteria

- [ ] All 49 shortlist emails delivered to students
- [ ] New notifications automatically sent within 5-10 minutes
- [ ] `provider_message_id` populated for all sent emails
- [ ] No emails stuck in "queued" for >10 minutes
- [ ] Resend dashboard shows successful deliveries
- [ ] Students confirm receiving emails

## Support

If issues persist:
1. Check edge function logs in Dashboard
2. Verify Resend API key is correct: `re_ecLxihcX_8EW4KqF3KwxceLpJEz9LiVY8`
3. Check Resend dashboard for error details
4. Review this guide's troubleshooting section

---

**Last Updated:** 2026-10-12
**Migration:** 0103_fix_email_dispatch_schedule.sql
**Status:** Ready to deploy
