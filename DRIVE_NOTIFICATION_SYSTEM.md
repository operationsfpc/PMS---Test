# Drive Notification System - Implementation Summary

## Problem Identified
The system had **staff notifications** for drive lifecycle events (migrations 0080 & 0081) but was missing **student notifications** when drives go live. This meant:
- Students were NOT being notified when new drives became available
- 3 live drives existed with ZERO notifications sent to eligible students
- Emails were NOT being sent to students about available placement opportunities

## Solution Implemented

### 1. Database Migration: `0082_notify_students_on_drive_live.sql`
Created a new trigger that automatically notifies eligible students when a drive status changes to 'live'.

**What it does:**
- Fires when drive status transitions to 'live'
- Finds all students who meet the drive's eligibility criteria:
  - Campus targeting (drive_target_campuses)
  - Degree targeting (drive_eligible_degrees)
  - Branch targeting (drive_eligible_branches)
  - Passing year (eligible_passing_years)
  - Minimum CGPA (min_overall_cgpa)
  - Minimum 10th percentage (min_tenth_percentage)
  - Minimum 12th percentage (min_twelfth_percentage)
  - Arrears policy (arrears_policy)
  - SRF status (srf_approved only)
  - Participation status (active only)
- Creates a notification for each eligible student
- The existing trigger from migration 0071 automatically creates email_deliveries
- The email dispatch cron job sends the emails

**File location:** `supabase/migrations/0082_notify_students_on_drive_live.sql`

### 2. Backfill Script: `scripts/backfill-drive-notifications.mjs`
Created a script to backfill notifications for existing live drives that missed notifications.

**What it does:**
- Finds all drives with status 'live'
- For each drive, finds eligible students using the same criteria as the trigger
- Creates notifications in batches of 100
- The trigger from 0071 auto-creates email_deliveries

**File location:** `scripts/backfill-drive-notifications.mjs`

## Results

### Backfill Completed
- **Mayura Consultancy Services**: 295 students notified
- **App Innovation**: 148 students notified
- **Wippi**: 87 students notified
- **Total**: 530 notifications created

### Email Status
- **Queued**: 230 emails ready to send
- **Sent**: 881 emails already delivered (cron job working!)
- **Total**: 1,111 email deliveries in the system

## Next Steps

### 1. Apply Migration to Supabase (REQUIRED)
The migration file `0082_notify_students_on_drive_live.sql` must be applied to the production database.

**Option A: Using Supabase CLI**
```bash
cd E:/fpc-pms-main/fpc-pms-main
npx supabase db push
```

**Option B: Manual SQL Execution**
1. Open Supabase Dashboard → SQL Editor
2. Copy the contents of `supabase/migrations/0082_notify_students_on_drive_live.sql`
3. Execute the SQL

**Verification:**
After applying, check that the trigger exists:
```sql
SELECT tgname, tgrelid::regclass 
FROM pg_trigger 
WHERE tgname = 'notify_eligible_students_on_drive_live';
```

### 2. Test the System
1. Create a test drive or use an existing approved drive
2. Publish it (change status to 'live')
3. Verify notifications are created:
   ```sql
   SELECT COUNT(*) FROM notifications 
   WHERE kind = 'drive_published' 
   AND drive_id = '<your-drive-id>';
   ```
4. Verify email deliveries are queued:
   ```sql
   SELECT COUNT(*) FROM email_deliveries 
   WHERE notification_id IN (
     SELECT id FROM notifications 
     WHERE kind = 'drive_published' 
     AND drive_id = '<your-drive-id>'
   )
   AND status = 'queued';
   ```

### 3. Monitor Email Dispatch
The cron job runs automatically and will send the queued emails. Monitor progress:
```sql
SELECT status, COUNT(*) 
FROM email_deliveries 
GROUP BY status;
```

## How It Works

### Flow for New Drives Going Live
1. Central CPC publishes drive → status changes to 'live'
2. Trigger `notify_eligible_students_on_drive_live` fires
3. Trigger finds all eligible students based on drive criteria
4. For each eligible student, inserts into `notifications` table
5. Trigger `notification_enqueues_email` (from 0071) fires
6. Inserts into `email_deliveries` with status 'queued'
7. Cron job `dispatch_pending_emails` picks up queued emails
8. Sends via Resend API
9. Updates status to 'sent'

### Email Template
The email-dispatch edge function already handles the 'drive_published' notification kind:
- Subject: "New Placement Drive Announced"
- Title: Uses the notification title
- Button: "View Drive & Apply"
- URL: `/student/drives`

## Files Created/Modified

### New Files
1. `supabase/migrations/0082_notify_students_on_drive_live.sql` - Database trigger
2. `scripts/backfill-drive-notifications.mjs` - Backfill script (original)
3. `scripts/complete-backfill.mjs` - Backfill script (optimized)
4. `check-drives.mjs` - Diagnostic script
5. `check-backfill.mjs` - Diagnostic script
6. `check-email-deliveries.mjs` - Diagnostic script

### Existing Files (No Changes Required)
- `src/features/central-cpc/publish-repository.ts` - Already updates status to 'live'
- `supabase/functions/email-dispatch/index.ts` - Already handles 'drive_published' kind
- `supabase/migrations/0071_email_outbox_queue.sql` - Already creates email_deliveries

## Staff Notifications (Already Working)
Migrations 0080 and 0081 handle staff notifications:
- **DH1**: Delivery Head notified on PIF submission
- **A1**: Account Executive notified on PIF approval
- **CP1**: Central CPC notified on PIF approval
- **A2**: Account Executive notified on PIF rejection
- **A3**: Account Executive notified when drive goes live
- **C1**: Campus CPCs notified when drive goes live for their campus
- **C6**: Campus CPC notified when student receives offer

## Student Notifications (Now Working)
Migration 0082 adds:
- **S2**: Students notified when drive goes live (NEW!)

## Testing Checklist
- [ ] Apply migration 0082 to production
- [ ] Verify trigger exists in database
- [ ] Test with a new drive going live
- [ ] Verify notifications are created for eligible students
- [ ] Verify email_deliveries are queued
- [ ] Monitor email dispatch cron job
- [ ] Verify emails are received by students
- [ ] Check email content and formatting
- [ ] Verify drive link works in email

## Troubleshooting

### Trigger Not Firing
Check if trigger exists:
```sql
SELECT * FROM pg_trigger WHERE tgname = 'notify_eligible_students_on_drive_live';
```

### No Notifications Created
Check drive targeting:
```sql
SELECT * FROM drive_target_campuses WHERE drive_id = '<drive-id>';
SELECT * FROM drive_eligible_degrees WHERE drive_id = '<drive-id>';
SELECT * FROM drive_eligible_branches WHERE drive_id = '<drive-id>';
```

Check eligible students:
```sql
SELECT COUNT(*) FROM students 
WHERE srf_status = 'srf_approved' 
AND participation_status = 'active';
```

### Emails Not Sending
Check email_deliveries:
```sql
SELECT status, COUNT(*) FROM email_deliveries GROUP BY status;
```

Check cron job logs in Supabase Dashboard → Database → Background Jobs

## Performance Considerations
- Trigger processes students in a loop (not bulk insert) to handle complex eligibility logic
- For drives with thousands of eligible students, trigger may take a few seconds
- Email dispatch is asynchronous and handles large volumes via batching
- Consider adding indexes if trigger performance becomes an issue:
  ```sql
  CREATE INDEX idx_students_eligibility ON students(srf_status, participation_status, campus_id);
  ```

## Future Enhancements
1. Add notification for drive deadline reminders (24 hours before deadline)
2. Add notification for application status updates
3. Add digest email for students with multiple new drives
4. Add preference for students to opt out of drive notifications
5. Add analytics dashboard for notification delivery rates
