# Email System Audit — FACE Prep Campus PMS
**Date:** 2026-10-13  
**Status:** Production (Test DB: jpejihmcbgerekyiikgb, Prod DB: apzsuclpydjkmaffppmr)

---

## Executive Summary

The email system uses a **notification → email_deliveries → Resend API** pipeline:
1. Database triggers fire on business events (e.g., drive published, SRF approved)
2. Triggers INSERT into `notifications` table
3. `enqueue_notification_email()` trigger stages rows in `email_deliveries` with status='queued'
4. **Instant dispatch** (0110): INSERT trigger fires `email-dispatch` edge function via pg_net (~7s latency)
5. **Cron backstop** (0109): Every 5 minutes, `dispatch_pending_emails` cron picks up stragglers
6. Edge function renders canonical HTML template and sends via Resend batch API

**Email Override:** In dev/test, `EMAIL_OVERRIDE_RECIPIENT` redirects all emails to a single address for testing.

---

## Email Templates Catalogue

### Student Communications (S1–S16)

| Code | Label | Trigger Event | To | CC | Status |
|------|-------|---------------|----|----|--------|
| **S1** | Welcome & Registration | Student roster import (srf_status='invited') | Student email | — | ✅ LIVE |
| **S2** | New Drive Announced | Drive published to students | Student email | — | ✅ LIVE |
| **S3** | Shortlisted Candidates | Student shortlisted for drive | Student email | — | ✅ LIVE |
| **S4** | Round Schedule | Round scheduled for drive | Student email | — | ✅ LIVE |
| **S5** | Interview Slot | Meeting link added to round | Student email | — | ✅ LIVE |
| **S6** | Round Cleared | Student advances to next round | Student email | — | ✅ LIVE |
| **S7** | Round Outcome | Student not selected in round | Student email | — | ✅ LIVE |
| **S8** | Offer Declared | Offer extended to student | Student email | — | ✅ LIVE |
| **S9** | Attendance Notice | Marked absent for round | Student email | — | ✅ LIVE |
| **S10** | Registration Feedback | SRF rejected / changes requested | Student email | — | ✅ LIVE |
| **S11** | Application Confirmed | Student applies to drive | Student email | — | ✅ LIVE |
| **S12** | Deadline Reminder | Drive closing in 24h | Student email | — | ⚠️ PLANNED |
| **S13** | Interview Day Reminder | Round starts today | Student email | — | ⚠️ PLANNED |
| **S14** | Profile Approved | SRF approved by CPC | Student email | — | ✅ LIVE |
| **S15** | Offer Decision Recorded | Student accepts/declines offer | Student email | — | ✅ LIVE |
| **S16** | Opt-Out Confirmed | Student opts out of placements | Student email | — | ✅ LIVE |

### Campus Placement Coordinator (C1–C7)

| Code | Label | Trigger Event | To | CC | Status |
|------|-------|---------------|----|----|--------|
| **C1** | Campus Drive Alert | Drive published targeting campus | Campus CPC email | — | ⚠️ PLANNED |
| **C2** | Campus Shortlist Ready | Shortlist published for campus | Campus CPC email | — | ⚠️ PLANNED |
| **C3** | Verification Queue Digest | SRF submissions pending | Campus CPC email | — | ⚠️ PLANNED |
| **C4** | Semester Pending Verification | New semester uploaded | Campus CPC email | — | ✅ LIVE |
| **C5** | Attendance Pending | Round started, attendance needed | Campus CPC email | — | ⚠️ PLANNED |
| **C6** | Campus Student Placed | Student from campus gets offer | Campus CPC email | — | ✅ LIVE |
| **C7** | Off-Campus Offer Proof | Student submits off-campus proof | Campus CPC email | — | ✅ LIVE |

### Central Placement Coordinator (CP1–CP4)

| Code | Label | Trigger Event | To | CC | Status |
|------|-------|---------------|----|----|--------|
| **CP1** | Drive Ready to Publish | PIF approved by Delivery Head | Central CPC email | — | ✅ LIVE |
| **CP2** | Applications Closed | Drive application deadline passed | Central CPC email | — | ✅ LIVE |
| **CP3** | Attendance Finalized | All campuses marked attendance | Central CPC email | — | ✅ LIVE |
| **CP4** | All Rounds Completed | Drive rounds concluded | Central CPC email | — | ✅ LIVE |

### Account Executive (A1–A4)

| Code | Label | Trigger Event | To | CC | Status |
|------|-------|---------------|----|----|--------|
| **A1** | PIF Approved | PIF approved by Delivery Head | AE email | — | ✅ LIVE |
| **A2** | PIF Revision Requested | PIF returned for changes | AE email | — | ✅ LIVE |
| **A3** | Drive Live to Students | Drive published | AE email | — | ✅ LIVE |
| **A4** | Drive Offers Milestone | Drive concluded with offers | AE email | — | ✅ LIVE |

### Delivery Head (DH1–DH3)

| Code | Label | Trigger Event | To | CC | Status |
|------|-------|---------------|----|----|--------|
| **DH1** | PIF Submitted | AE submits PIF | Delivery Head email | — | ✅ LIVE |
| **DH2** | Policy Override Alert | Policy override requested | Delivery Head email | — | ⚠️ PLANNED |
| **DH3** | Weekly Operations Digest | Weekly summary (cron) | Delivery Head email | — | ⚠️ PLANNED |

### Campus Leadership (L1–L2)

| Code | Label | Trigger Event | To | CC | Status |
|------|-------|---------------|----|----|--------|
| **L1** | Weekly Placement Digest | Weekly campus summary (cron) | Principal/Dean email | — | ⚠️ PLANNED |
| **L2** | Super Dream Milestone | Super Dream offer extended | Principal/Dean email | — | ⚠️ PLANNED |

### Corporate Recruiters (R1–R4)

| Code | Label | Trigger Event | To | CC | Status |
|------|-------|---------------|----|----|--------|
| **R1** | Candidate Shortlist | Shortlist published | Recruiter email | — | ⚠️ PLANNED |
| **R2** | Drive Sourcing Kickoff | Drive published | Recruiter email | — | ⚠️ PLANNED |
| **R3** | Interview Schedule & Roster | Rounds scheduled | Recruiter email | — | ⚠️ PLANNED |
| **R4** | Drive Concluded Summary | Drive completed | Recruiter email | — | ⚠️ PLANNED |

### System Administrator (AD1–AD3)

| Code | Label | Trigger Event | To | CC | Status |
|------|-------|---------------|----|----|--------|
| **AD1** | Staff Invitation | Staff member invited | Staff email | — | ✅ LIVE |
| **AD2** | Roster Import Complete | Student roster imported | Admin email | — | ⚠️ PLANNED |
| **AD3** | Email Delivery Alert | Email delivery failures | Admin email | — | ⚠️ PLANNED |

---

## Cron Jobs

### 1. `dispatch_pending_emails` (Every 5 minutes)
**Migration:** 0109, 0110  
**Function:** `dispatch_pending_emails()`  
**Purpose:** Safety net for instant dispatch failures; picks up queued/processing emails  
**Action:** Calls `email-dispatch` edge function

```sql
SELECT cron.schedule(
  'dispatch_pending_emails',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url => 'https://apzsuclpydjkmaffppmr.supabase.co/functions/v1/email-dispatch',
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body => '{}'::jsonb
  )$$
);
```

### 2. `recover_stale_email_claims` (Every 2 minutes)
**Migration:** 0108  
**Function:** `recover_stale_email_claims()`  
**Purpose:** Resets 'processing' emails stuck >5 minutes back to 'queued'  
**Action:** Updates status, increments attempts, marks failed after 3 retries

```sql
SELECT cron.schedule(
  'recover_stale_email_claims',
  '*/2 * * * *',
  $$SELECT recover_stale_email_claims()$$
);
```

### 3. Planned (Not Yet Implemented)
- **DH3:** Weekly operations digest (Delivery Head) — Every Monday 8 AM
- **L1:** Weekly placement digest (Leadership) — Every Monday 9 AM
- **S12:** Drive deadline reminder — Every hour, checks drives closing in 24h
- **S13:** Interview day reminder — Daily 8 AM, checks rounds scheduled today

---

## Email Routing Matrix

### To: Recipients

| Role | Email Source | Example |
|------|--------------|---------|
| Student | `students.email` | ashadevi@gmail.com |
| Campus CPC | `profiles.email` WHERE role='campus_placement_coordinator' | cpc@kamarajcollege.edu |
| Central CPC | `profiles.email` WHERE role='central_placement_coordinator' | central@faceprep.in |
| Account Executive | `profiles.email` WHERE role='account_executive' | anil@faceprep.in |
| Delivery Head | `profiles.email` WHERE role='delivery_head' | deliveryhead@faceprep.in |
| Admin | `profiles.email` WHERE role='admin' | admin@faceprep.in |
| Staff (invitation) | `staff_invitations.email` | newstaff@college.edu |
| Recruiter | Manual (not in DB) | priya@zoho.com |

### CC: Recipients
**Current Status:** No CC routing implemented. All emails are single-recipient (To only).

**Planned CC Routing:**
- **C1 (Campus Drive Alert):** To Campus CPC, CC Central CPC
- **C6 (Campus Student Placed):** To Campus CPC, CC AE, Delivery Head
- **DH1 (PIF Submitted):** To Delivery Head, CC Central CPC
- **R1 (Candidate Shortlist):** To Recruiter, CC Central CPC, AE

---

## Trigger Implementation Status

### ✅ LIVE Triggers (Database → Notifications → Email)

1. **Student Lifecycle (0076)**
   - `notify_student_of_roster_invitation()` → S1
   - `notify_student_of_srf_approval()` → S14
   - `enqueue_notification_email()` → Stages all notifications in email_deliveries

2. **Drive Lifecycle (0080, 0081, 0082, 0106)**
   - `notify_students_on_drive_live()` → S2
   - `notify_heads_on_drive_approval()` → DH1, CP1
   - `notify_ae_on_drive_live()` → A3
   - `notify_ae_on_pif_approved()` → A1
   - `notify_ae_on_pif_returned()` → A2

3. **Application & Shortlist (0092, 0104)**
   - `notify_application_confirmed()` → S11
   - `notify_shortlisted_students()` → S3

4. **Round Management (0057, 0106)**
   - `notify_round_scheduled()` → S4
   - `notify_round_cleared()` → S6
   - `notify_round_not_selected()` → S7
   - `notify_meeting_link()` → S5
   - `notify_absent()` → S9

5. **Offer Management (0069, 0094)**
   - `notify_offer_extended()` → S8
   - `notify_offer_decision()` → S15
   - `notify_campus_student_placed()` → C6

6. **SRF & Participation (0093, 0095)**
   - `notify_srf_rejected()` → S10
   - `notify_srf_submission_to_cpc()` → C4 (semester verification)
   - `notify_opt_out_confirmed()` → S16
   - `notify_opt_out_to_cpc()` → C7 (off-campus verification)

7. **Staff Invitation (0079)**
   - `dispatch_staff_invitation_email()` → AD1 (direct HTML email, no notification)

### ⚠️ PLANNED Triggers (Not Yet Implemented)

- **C1, C2, C3, C5:** Campus CPC notifications (drive alerts, shortlists, verification digest, attendance)
- **DH2, DH3:** Delivery Head policy override and weekly digest
- **L1, L2:** Leadership weekly digest and milestone alerts
- **R1–R4:** All recruiter notifications
- **S12, S13:** Student deadline and interview day reminders
- **AD2, AD3:** Admin roster import and delivery alerts

---

## Edge Function: `email-dispatch`

**Location:** `supabase/functions/email-dispatch/index.ts`  
**Auth:** Service role key (Bearer token)  
**Concurrency:** Atomic claim via `claim_email_deliveries()` RPC (FOR UPDATE SKIP LOCKED)  
**Batch Size:** 100 emails per Resend API call  
**Retry Logic:** 3 attempts for 429/5xx errors; 4xx validation errors are permanent failures

### Template Rendering

The edge function maps notification `kind` to canonical HTML template attributes:
- **Subject:** From notification title or template default
- **Title:** Template-specific heading
- **Body:** Notification body (Markdown **bold** → HTML `<strong>`)
- **Button:** Action label + URL based on notification kind
- **Recipient:** Student full_name OR profile full_name + role

### Dev/Test Routing

When `EMAIL_OVERRIDE_RECIPIENT` is set:
- All emails redirected to override address
- Routing notice injected into HTML body
- Text body prefixed with `[Dev Routing Note: Intended for <original_email>]`

---

## Database Schema

### `notifications` Table
```sql
id UUID PRIMARY KEY
student_id UUID REFERENCES students(id)
kind TEXT NOT NULL  -- e.g., 'welcome', 'drive_published', 'shortlisted'
title TEXT NOT NULL
body TEXT NOT NULL
drive_id UUID REFERENCES drives(id)
created_at TIMESTAMPTZ DEFAULT now()
read_at TIMESTAMPTZ
```

### `email_deliveries` Table
```sql
id UUID PRIMARY KEY
notification_id UUID REFERENCES notifications(id)
recipient_email TEXT NOT NULL
subject TEXT
html_body TEXT
status TEXT NOT NULL  -- 'queued', 'processing', 'sent', 'failed'
provider_message_id TEXT  -- Resend message ID
attempts INT DEFAULT 0
error TEXT
created_at TIMESTAMPTZ DEFAULT now()
updated_at TIMESTAMPTZ DEFAULT now()
```

---

## Verification Checklist

### ✅ Working
- [x] Instant dispatch (~7s latency) via pg_net trigger
- [x] Cron backstop (every 5 minutes)
- [x] Atomic claim locking (no duplicate sends)
- [x] Retry logic (3 attempts for transient failures)
- [x] Stale claim recovery (processing → queued after 5 min)
- [x] Opt-out filtering (opted-out students don't receive emails)
- [x] Dev/test email override
- [x] Canonical HTML template rendering
- [x] Resend batch API integration

### ⚠️ Needs Attention
- [ ] CC routing not implemented (all emails are To-only)
- [ ] Weekly digest crons not implemented (DH3, L1)
- [ ] Reminder crons not implemented (S12, S13)
- [ ] Campus CPC notifications incomplete (C1, C2, C3, C5)
- [ ] Recruiter notifications not implemented (R1–R4)
- [ ] Leadership milestone alerts not implemented (L2)

### 🔍 Monitoring
- **Resend Dashboard:** https://resend.com (check delivery status, bounces, opens)
- **Database Query:** `SELECT status, COUNT(*) FROM email_deliveries GROUP BY status;`
- **Failed Emails:** `SELECT * FROM email_deliveries WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10;`
- **Stale Processing:** `SELECT * FROM email_deliveries WHERE status = 'processing' AND updated_at < now() - interval '5 minutes';`

---

## Recommendations

1. **Implement CC Routing:** Add `cc_emails TEXT[]` column to `email_deliveries` and update triggers to populate it for multi-recipient notifications.

2. **Add Weekly Digest Crons:** Implement DH3 and L1 as scheduled functions that aggregate metrics and send summary emails.

3. **Implement Reminder Triggers:** Add S12 (deadline reminder) and S13 (interview day reminder) as hourly/daily crons.

4. **Complete Campus CPC Notifications:** Implement C1, C2, C3, C5 to keep campus coordinators informed.

5. **Add Recruiter Notifications:** Implement R1–R4 for external recruiter communications (requires recruiter email field in drives table).

6. **Set Up Monitoring Alerts:** Configure Resend webhooks to notify admin (AD3) of delivery failures.

7. **Test All Triggers:** Create integration tests that verify each trigger fires correctly and stages the right email.

---

## Files & Locations

- **Edge Function:** `supabase/functions/email-dispatch/index.ts`
- **Email Service:** `src/lib/email-service.ts`
- **Templates Preview:** `docs/email-templates-preview.html`
- **Migrations:** `supabase/migrations/0071–0110` (email-related)
- **Triggers:** `supabase/migrations/0076, 0080, 0081, 0082, 0092, 0093, 0094, 0095, 0106`
- **Cron Jobs:** `supabase/migrations/0108, 0109, 0110`

---

**Last Updated:** 2026-10-13  
**Maintained By:** Operations Team (operationsfpc)
