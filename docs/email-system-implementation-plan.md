# Email System — Comprehensive Implementation Plan
**Date:** 2026-10-13  
**Status:** Planning Phase

---

## Executive Summary

This plan implements the complete email notification system for FACE Prep Campus PMS, including:
1. **CC routing** for multi-recipient notifications
2. **KAM (Key Account Manager) notifications** when drives are published to their campuses
3. **Time-based triggers** (reminders, digests, scheduled notifications)
4. **All missing templates** (21 planned templates → LIVE)
5. **Proper orchestration** and flow control

**Total Templates:** 47 (26 LIVE → 47 LIVE)  
**New Migrations:** 8-10 files  
**New Cron Jobs:** 4  
**New Triggers:** 15+

---

## Phase 1: CC Routing Infrastructure

### 1.1 Database Schema Changes
**Migration:** `0111_add_cc_routing.sql`

```sql
-- Add CC column to email_deliveries
ALTER TABLE email_deliveries 
ADD COLUMN cc_emails TEXT[] DEFAULT '{}';

-- Create helper function to resolve CC recipients
CREATE OR REPLACE FUNCTION resolve_cc_recipients(
  p_notification_kind TEXT,
  p_campus_id UUID DEFAULT NULL,
  p_drive_id UUID DEFAULT NULL
) RETURNS TEXT[] LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cc_emails TEXT[] := '{}';
  v_email TEXT;
BEGIN
  -- C1, C2: Campus Drive Alert, Campus Shortlist Ready → CC Central CPC
  IF p_notification_kind IN ('campus_drive_alert', 'campus_shortlist_ready') THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles WHERE role = 'central_placement_coordinator' AND is_active = true;
  
  -- C6: Campus Student Placed → CC AE, Delivery Head
  ELSIF p_notification_kind = 'campus_student_placed' THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles 
    WHERE role IN ('account_executive', 'delivery_head') AND is_active = true;
  
  -- DH1: PIF Submitted → CC Central CPC
  ELSIF p_notification_kind = 'pif_submitted' THEN
    SELECT ARRAY_AGG(DISTINCT email) INTO v_cc_emails
    FROM profiles WHERE role = 'central_placement_coordinator' AND is_active = true;
  
  -- New drive published → CC KAM for that campus
  ELSIF p_notification_kind = 'drive_published' AND p_campus_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT p.email) INTO v_cc_emails
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = p_campus_id
      AND p.role IN ('key_account_manager', 'enterprise_relations')
      AND p.is_active = true;
  END IF;
  
  RETURN COALESCE(v_cc_emails, '{}');
END;
$$;
```

### 1.2 Update enqueue_notification_email() Trigger
**Migration:** `0111_add_cc_routing.sql` (continued)

```sql
CREATE OR REPLACE FUNCTION enqueue_notification_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email TEXT;
  v_opted BOOLEAN;
  v_cc_emails TEXT[];
  v_campus_id UUID;
BEGIN
  -- Get student email and opt-out status
  SELECT email, (participation_status = 'opted_out'), campus_id
    INTO v_email, v_opted, v_campus_id
    FROM students WHERE id = NEW.student_id;
  
  -- Skip if opted out or no email
  IF v_opted OR v_email IS NULL OR trim(v_email) = '' THEN
    RETURN NEW;
  END IF;
  
  -- Resolve CC recipients
  v_cc_emails := resolve_cc_recipients(NEW.kind, v_campus_id, NEW.drive_id);
  
  -- Insert with CC
  INSERT INTO email_deliveries (notification_id, recipient_email, cc_emails, status)
  VALUES (NEW.id, lower(trim(v_email)), v_cc_emails, 'queued');
  
  RETURN NEW;
END;
$$;
```

### 1.3 Update Edge Function
**File:** `supabase/functions/email-dispatch/index.ts`

**Changes:**
- Read `cc_emails` from `email_deliveries`
- Pass `cc` array to Resend API
- Resolve CC display names from profiles table

```typescript
// In payload building loop:
const ccEmails = (delivery as any).cc_emails as string[] | null;
const ccRecipients = ccEmails && ccEmails.length > 0 ? ccEmails : undefined;

// Resolve CC display names
let ccDisplayNames: string[] = [];
if (ccRecipients && ccRecipients.length > 0) {
  const { data: ccProfiles } = await supabase
    .from("profiles")
    .select("email, full_name, role")
    .in("email", ccRecipients);
  
  if (ccProfiles) {
    ccDisplayNames = ccProfiles.map(p => 
      resolveDisplayName(p.full_name, p.role)
    );
  }
}

const payload = {
  from: RESEND_FROM_EMAIL,
  to: [finalRecipient],
  cc: ccRecipients,  // Add CC field
  reply_to: "placements@faceprep.in",
  subject: customSubject ?? subject,
  html: customHtml ?? buildCanonicalHtml({
    subject,
    title: templateTitle,
    subtitle,
    recipient: recipientDisplayName,
    body: notificationBody,
    button: buttonLabel,
    url: targetUrl,
    routingNotice: isOverridden ? originalEmail : undefined,
  }),
};
```

---

## Phase 2: KAM Notifications for New Drives

### 2.1 Trigger: Notify KAM on Drive Published
**Migration:** `0112_kam_drive_notifications.sql`

```sql
CREATE OR REPLACE FUNCTION notify_kam_on_drive_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kam_emails TEXT[];
  v_kam_email TEXT;
  v_campus RECORD;
BEGIN
  -- Only fire when drive is published (status changes to 'published')
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    -- Get all target campuses for this drive
    FOR v_campus IN
      SELECT dtc.campus_id, c.name as campus_name
      FROM drive_target_campuses dtc
      JOIN campuses c ON c.id = dtc.campus_id
      WHERE dtc.drive_id = NEW.id
    LOOP
      -- Find KAMs for this campus
      SELECT ARRAY_AGG(DISTINCT p.email) INTO v_kam_emails
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_campus.campus_id
        AND p.role IN ('key_account_manager', 'enterprise_relations')
        AND p.is_active = true;
      
      -- Send notification to each KAM
      IF v_kam_emails IS NOT NULL AND array_length(v_kam_emails, 1) > 0 THEN
        FOREACH v_kam_email IN ARRAY v_kam_emails LOOP
          -- Create notification for KAM (no student_id, use profiles.email lookup)
          INSERT INTO notifications (kind, title, body, drive_id)
          VALUES (
            'kam_drive_alert',
            'New Drive Published: ' || NEW.company_name || ' — ' || v_campus.campus_name,
            'A new placement drive has been published for **' || v_campus.campus_name || '**.' || E'\n\n' ||
            '**Drive Details**' || E'\n' ||
            '• **Company:** ' || NEW.company_name || E'\n' ||
            '• **Role:** ' || NEW.role_title || E'\n' ||
            '• **Drive Type:** ' || NEW.drive_type || E'\n' ||
            '• **Compensation:** ₹' || COALESCE(NEW.ctc_max_lpa::text, 'N/A') || ' LPA' || E'\n' ||
            '• **Application Deadline:** ' || TO_CHAR(NEW.application_end, 'DD Mon YYYY, HH24:MI') || E'\n\n' ||
            'Please coordinate with the campus placement team to ensure eligible candidates are informed.',
            NEW.id
          );
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_kam_on_drive_published ON drives;
CREATE TRIGGER notify_kam_on_drive_published
  AFTER INSERT OR UPDATE OF status ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_kam_on_drive_published();
```

### 2.2 Edge Function Template for KAM Alert
**File:** `supabase/functions/email-dispatch/index.ts`

```typescript
case 'kam_drive_alert':
  subject = notificationTitle || 'New Drive Published for Your Campus';
  templateTitle = 'New Placement Drive Announced';
  buttonLabel = 'View Drive Details';
  targetUrl = `${PORTAL_URL}/cpc/drives`;
  break;
```

---

## Phase 3: Campus CPC Notifications (C1, C2, C3, C5)

### 3.1 C1: Campus Drive Alert
**Migration:** `0113_campus_cpc_notifications.sql`

```sql
CREATE OR REPLACE FUNCTION notify_campus_cpc_on_drive_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campus RECORD;
  v_cpc_email TEXT;
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    FOR v_campus IN
      SELECT dtc.campus_id, c.name as campus_name
      FROM drive_target_campuses dtc
      JOIN campuses c ON c.id = dtc.campus_id
      WHERE dtc.drive_id = NEW.id
    LOOP
      -- Find Campus CPC for this campus
      SELECT p.email INTO v_cpc_email
      FROM profiles p
      JOIN staff_campus_assignments sca ON sca.profile_id = p.id
      WHERE sca.campus_id = v_campus.campus_id
        AND p.role = 'campus_placement_coordinator'
        AND p.is_active = true
      LIMIT 1;
      
      IF v_cpc_email IS NOT NULL THEN
        INSERT INTO notifications (kind, title, body, drive_id)
        VALUES (
          'campus_drive_alert',
          'New Drive Live for ' || v_campus.campus_name || ': ' || NEW.company_name,
          'A new placement drive has been published that targets eligible candidates from **' || v_campus.campus_name || '**.' || E'\n\n' ||
          '**Drive Overview**' || E'\n' ||
          '• **Company:** ' || NEW.company_name || E'\n' ||
          '• **Role:** ' || NEW.role_title || E'\n' ||
          '• **Compensation:** ₹' || COALESCE(NEW.ctc_max_lpa::text, 'N/A') || ' LPA' || E'\n' ||
          '• **Application Deadline:** ' || TO_CHAR(NEW.application_end, 'DD Mon YYYY, HH24:MI') || E'\n\n' ||
          'Please encourage eligible candidates to review the terms and apply before the deadline.',
          NEW.id
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_campus_cpc_on_drive_published ON drives;
CREATE TRIGGER notify_campus_cpc_on_drive_published
  AFTER INSERT OR UPDATE OF status ON drives
  FOR EACH ROW EXECUTE FUNCTION notify_campus_cpc_on_drive_published();
```

### 3.2 C2: Campus Shortlist Ready
**Migration:** `0113_campus_cpc_notifications.sql` (continued)

```sql
CREATE OR REPLACE FUNCTION notify_campus_cpc_on_shortlist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campus_id UUID;
  v_campus_name TEXT;
  v_cpc_email TEXT;
  v_company TEXT;
  v_role TEXT;
  v_shortlist_count INT;
BEGIN
  -- Fire when shortlist is published (assuming shortlist_status changes)
  IF NEW.shortlist_status = 'published' AND OLD.shortlist_status IS DISTINCT FROM 'published' THEN
    SELECT dtc.campus_id, c.name, d.company_name, d.role_title
      INTO v_campus_id, v_campus_name, v_company, v_role
      FROM drive_target_campuses dtc
      JOIN campuses c ON c.id = dtc.campus_id
      JOIN drives d ON d.id = dtc.drive_id
      WHERE dtc.drive_id = NEW.drive_id
      LIMIT 1;
    
    -- Count shortlisted students from this campus
    SELECT COUNT(*) INTO v_shortlist_count
    FROM drive_applications da
    JOIN students s ON s.id = da.student_id
    WHERE da.drive_id = NEW.drive_id
      AND s.campus_id = v_campus_id
      AND da.status = 'shortlisted';
    
    -- Find Campus CPC
    SELECT p.email INTO v_cpc_email
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = v_campus_id
      AND p.role = 'campus_placement_coordinator'
      AND p.is_active = true
    LIMIT 1;
    
    IF v_cpc_email IS NOT NULL AND v_shortlist_count > 0 THEN
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'campus_shortlist_ready',
        'Shortlist Published: ' || v_shortlist_count || ' Students from ' || v_campus_name,
        'The candidate shortlist for **' || v_company || '** (' || v_role || ') has been finalized.' || E'\n\n' ||
        '**Shortlist Summary**' || E'\n' ||
        '• **Campus:** ' || v_campus_name || E'\n' ||
        '• **Shortlisted Count:** ' || v_shortlist_count || ' students' || E'\n' ||
        '• **Next Stage:** Round 1 — Technical Assessment' || E'\n\n' ||
        'Please coordinate local venue preparations and ensure shortlisted candidates are informed.',
        NEW.drive_id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;
```

### 3.3 C3: Verification Queue Digest
**Migration:** `0113_campus_cpc_notifications.sql` (continued)

```sql
-- Cron job: Every day at 9 AM, send verification digest to Campus CPC
CREATE OR REPLACE FUNCTION send_verification_queue_digest()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_campus RECORD;
  v_cpc_email TEXT;
  v_pending_count INT;
BEGIN
  -- For each campus with pending verifications
  FOR v_campus IN
    SELECT s.campus_id, c.name as campus_name, COUNT(*) as pending_count
    FROM students s
    JOIN campuses c ON c.id = s.campus_id
    WHERE s.srf_status = 'submitted'
    GROUP BY s.campus_id, c.name
    HAVING COUNT(*) > 0
  LOOP
    -- Find Campus CPC
    SELECT p.email INTO v_cpc_email
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = v_campus.campus_id
      AND p.role = 'campus_placement_coordinator'
      AND p.is_active = true
    LIMIT 1;
    
    IF v_cpc_email IS NOT NULL THEN
      INSERT INTO notifications (kind, title, body)
      VALUES (
        'verification_queue_digest',
        'Verification Queue: ' || v_campus.pending_count || ' Student Profiles Awaiting Approval',
        'There are currently student registration forms awaiting academic verification on your campus portal.' || E'\n\n' ||
        '• **Campus:** ' || v_campus.campus_name || E'\n' ||
        '• **Pending Profiles:** ' || v_campus.pending_count || ' students' || E'\n' ||
        '• **Pending Checks:** 10th/12th marks, semester CGPA, and marksheet uploads' || E'\n\n' ||
        'Prompt verification ensures these students become eligible for recruitment drives.',
      );
    END IF;
  END LOOP;
END;
$$;

-- Schedule cron job
SELECT cron.schedule(
  'verification_queue_digest',
  '0 9 * * *',  -- Daily at 9 AM
  $$SELECT send_verification_queue_digest()$$
);
```

### 3.4 C5: Attendance Pending
**Migration:** `0113_campus_cpc_notifications.sql` (continued)

```sql
CREATE OR REPLACE FUNCTION notify_cpc_attendance_pending()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campus_id UUID;
  v_campus_name TEXT;
  v_cpc_email TEXT;
  v_company TEXT;
  v_round_name TEXT;
BEGIN
  -- Fire when a round is scheduled (drive_rounds INSERT)
  IF TG_OP = 'INSERT' THEN
    SELECT dtc.campus_id, c.name, d.company_name
      INTO v_campus_id, v_campus_name, v_company
      FROM drive_target_campuses dtc
      JOIN campuses c ON c.id = dtc.campus_id
      JOIN drives d ON d.id = dtc.drive_id
      WHERE dtc.drive_id = NEW.drive_id
      LIMIT 1;
    
    -- Find Campus CPC
    SELECT p.email INTO v_cpc_email
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = v_campus_id
      AND p.role = 'campus_placement_coordinator'
      AND p.is_active = true
    LIMIT 1;
    
    IF v_cpc_email IS NOT NULL THEN
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'attendance_pending',
        'Action Required: Mark Attendance for ' || v_company,
        'A new round has been scheduled for **' || v_company || '**.' || E'\n\n' ||
        '• **Campus:** ' || v_campus_name || E'\n' ||
        '• **Round:** ' || NEW.round_name || E'\n' ||
        '• **Date:** ' || TO_CHAR(NEW.scheduled_date, 'DD Mon YYYY') || E'\n\n' ||
        'Please mark attendance for all participating students.',
        NEW.drive_id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_cpc_attendance_pending ON drive_rounds;
CREATE TRIGGER notify_cpc_attendance_pending
  AFTER INSERT ON drive_rounds
  FOR EACH ROW EXECUTE FUNCTION notify_cpc_attendance_pending();
```

---

## Phase 4: Time-Based Triggers (S12, S13, DH3, L1)

### 4.1 S12: Drive Deadline Reminder (24h before)
**Migration:** `0114_time_based_reminders.sql`

```sql
-- Cron job: Every hour, check for drives closing in 24h
CREATE OR REPLACE FUNCTION send_drive_deadline_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_drive RECORD;
  v_student RECORD;
BEGIN
  -- Find drives closing in next 24 hours
  FOR v_drive IN
    SELECT d.id, d.company_name, d.role_title, d.application_end, d.ctc_max_lpa
    FROM drives d
    WHERE d.status = 'published'
      AND d.application_end BETWEEN now() AND now() + interval '24 hours'
  LOOP
    -- Send to all eligible students who haven't applied yet
    FOR v_student IN
      SELECT DISTINCT s.id, s.email, s.full_name
      FROM students s
      JOIN drive_target_campuses dtc ON dtc.campus_id = s.campus_id
      WHERE dtc.drive_id = v_drive.id
        AND s.srf_status = 'srf_approved'
        AND s.participation_status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM drive_applications da
          WHERE da.drive_id = v_drive.id AND da.student_id = s.id
        )
    LOOP
      INSERT INTO notifications (student_id, kind, title, body, drive_id)
      VALUES (
        v_student.id,
        'drive_deadline_reminder',
        'Closing Soon: Applications for ' || v_drive.company_name || ' Close in 24 Hours',
        'This is a reminder that applications for **' || v_drive.company_name || '** (' || v_drive.role_title || ') will close tomorrow at **' || TO_CHAR(v_drive.application_end, 'DD Mon YYYY, HH24:MI') || '**.' || E'\n\n' ||
        '**Drive Highlights**' || E'\n' ||
        '• **Role:** ' || v_drive.role_title || E'\n' ||
        '• **Compensation:** ₹' || COALESCE(v_drive.ctc_max_lpa::text, 'N/A') || ' LPA' || E'\n' ||
        '• **Application Deadline:** ' || TO_CHAR(v_drive.application_end, 'DD Mon YYYY, HH24:MI') || E'\n\n' ||
        'If you meet the eligibility criteria and wish to participate, please complete your application before the window closes.',
        v_drive.id
      );
    END LOOP;
  END LOOP;
END;
$$;

-- Schedule cron job
SELECT cron.schedule(
  'drive_deadline_reminder',
  '0 * * * *',  -- Every hour
  $$SELECT send_drive_deadline_reminders()$$
);
```

### 4.2 S13: Interview Day Reminder (Daily 8 AM)
**Migration:** `0114_time_based_reminders.sql` (continued)

```sql
-- Cron job: Daily at 8 AM, check for rounds scheduled today
CREATE OR REPLACE FUNCTION send_interview_day_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_round RECORD;
  v_student RECORD;
BEGIN
  -- Find rounds scheduled for today
  FOR v_round IN
    SELECT dr.id, dr.drive_id, dr.round_name, dr.scheduled_date, dr.scheduled_time,
           d.company_name, d.role_title
    FROM drive_rounds dr
    JOIN drives d ON d.id = dr.drive_id
    WHERE dr.scheduled_date = CURRENT_DATE
  LOOP
    -- Send to all students scheduled for this round
    FOR v_student IN
      SELECT DISTINCT s.id, s.email, s.full_name
      FROM students s
      JOIN drive_applications da ON da.student_id = s.id
      WHERE da.drive_id = v_round.drive_id
        AND da.status IN ('shortlisted', 'round_scheduled')
        AND s.participation_status = 'active'
    LOOP
      INSERT INTO notifications (student_id, kind, title, body, drive_id)
      VALUES (
        v_student.id,
        'interview_day_reminder',
        'Reminder: Your ' || v_round.round_name || ' for ' || v_round.company_name || ' Starts Today',
        'Your scheduled round for **' || v_round.company_name || '** takes place today.' || E'\n\n' ||
        '**Schedule Details**' || E'\n' ||
        '• **Round:** ' || v_round.round_name || E'\n' ||
        '• **Date & Time:** ' || TO_CHAR(v_round.scheduled_date, 'DD Mon YYYY') || ', ' || COALESCE(TO_CHAR(v_round.scheduled_time, 'HH24:MI'), 'TBD') || E'\n' ||
        '• **Mode:** ' || COALESCE(v_round.mode, 'In person') || E'\n\n' ||
        'Please report on time with your college ID card and student credentials ready.',
        v_round.drive_id
      );
    END LOOP;
  END LOOP;
END;
$$;

-- Schedule cron job
SELECT cron.schedule(
  'interview_day_reminder',
  '0 8 * * *',  -- Daily at 8 AM
  $$SELECT send_interview_day_reminders()$$
);
```

### 4.3 DH3: Weekly Operations Digest (Monday 8 AM)
**Migration:** `0114_time_based_reminders.sql` (continued)

```sql
CREATE OR REPLACE FUNCTION send_weekly_operations_digest()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_dh_email TEXT;
  v_total_drives INT;
  v_active_drives INT;
  v_total_applications INT;
  v_total_offers INT;
BEGIN
  -- Get Delivery Head email
  SELECT email INTO v_dh_email
  FROM profiles
  WHERE role = 'delivery_head' AND is_active = true
  LIMIT 1;
  
  IF v_dh_email IS NULL THEN RETURN; END IF;
  
  -- Aggregate metrics
  SELECT COUNT(*) INTO v_total_drives FROM drives WHERE created_at >= now() - interval '7 days';
  SELECT COUNT(*) INTO v_active_drives FROM drives WHERE status = 'published';
  SELECT COUNT(*) INTO v_total_applications FROM drive_applications WHERE created_at >= now() - interval '7 days';
  SELECT COUNT(*) INTO v_total_offers FROM offers WHERE created_at >= now() - interval '7 days';
  
  INSERT INTO notifications (kind, title, body)
  VALUES (
    'weekly_operations_digest',
    'Weekly Operations Digest: ' || TO_CHAR(now() - interval '7 days', 'DD Mon') || ' — ' || TO_CHAR(now(), 'DD Mon YYYY'),
    '**Weekly Placement Operations Summary**' || E'\n\n' ||
    '• **New Drives Created:** ' || v_total_drives || E'\n' ||
    '• **Active Drives:** ' || v_active_drives || E'\n' ||
    '• **New Applications:** ' || v_total_applications || E'\n' ||
    '• **Offers Extended:** ' || v_total_offers || E'\n\n' ||
    'Please review the detailed dashboard for campus-wise breakdown and pending actions.',
  );
END;
$$;

-- Schedule cron job
SELECT cron.schedule(
  'weekly_operations_digest',
  '0 8 * * 1',  -- Every Monday at 8 AM
  $$SELECT send_weekly_operations_digest()$$
);
```

### 4.4 L1: Weekly Placement Digest for Leadership (Monday 9 AM)
**Migration:** `0114_time_based_reminders.sql` (continued)

```sql
CREATE OR REPLACE FUNCTION send_weekly_leadership_digest()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_campus RECORD;
  v_principal_email TEXT;
BEGIN
  -- For each campus, send digest to Principal/Dean
  FOR v_campus IN
    SELECT c.id, c.name
    FROM campuses c
  LOOP
    -- Find Principal/Dean for this campus (assuming role = 'principal' or 'dean')
    SELECT p.email INTO v_principal_email
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = v_campus.id
      AND p.role IN ('principal', 'dean')
      AND p.is_active = true
    LIMIT 1;
    
    IF v_principal_email IS NOT NULL THEN
      -- Aggregate campus metrics
      INSERT INTO notifications (kind, title, body)
      VALUES (
        'weekly_placement_digest',
        'Weekly Placement Digest: ' || v_campus.name,
        '**Weekly Placement Summary for ' || v_campus.name || '**' || E'\n\n' ||
        '• **Active Drives:** [Count]' || E'\n' ||
        '• **Students Participating:** [Count]' || E'\n' ||
        '• **Offers Extended:** [Count]' || E'\n' ||
        '• **Students Placed:** [Count]' || E'\n\n' ||
        'Please review the campus dashboard for detailed metrics.',
      );
    END IF;
  END LOOP;
END;
$$;

-- Schedule cron job
SELECT cron.schedule(
  'weekly_leadership_digest',
  '0 9 * * 1',  -- Every Monday at 9 AM
  $$SELECT send_weekly_leadership_digest()$$
);
```

---

## Phase 5: Remaining Templates (DH2, L2, R1-R4, AD2-AD3)

### 5.1 DH2: Policy Override Alert
**Migration:** `0115_remaining_templates.sql`

```sql
CREATE OR REPLACE FUNCTION notify_dh_on_policy_override()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dh_email TEXT;
BEGIN
  -- Fire when policy override is requested (assuming a flag in drives or offers)
  IF NEW.policy_override_requested = true AND OLD.policy_override_requested IS DISTINCT FROM true THEN
    SELECT email INTO v_dh_email
    FROM profiles
    WHERE role = 'delivery_head' AND is_active = true
    LIMIT 1;
    
    IF v_dh_email IS NOT NULL THEN
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'policy_override_alert',
        'Policy Override Requested: ' || NEW.company_name,
        'A policy override has been requested for **' || NEW.company_name || '**.' || E'\n\n' ||
        'Please review and approve/reject the override request.',
        NEW.id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;
```

### 5.2 L2: Super Dream Milestone
**Migration:** `0115_remaining_templates.sql` (continued)

```sql
CREATE OR REPLACE FUNCTION notify_leadership_on_super_dream_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campus_id UUID;
  v_principal_email TEXT;
  v_student_name TEXT;
  v_company TEXT;
  v_ctc NUMERIC;
BEGIN
  -- Fire when offer is extended for Super Dream category
  IF NEW.offer_category = 'super_dream' AND TG_OP = 'INSERT' THEN
    SELECT s.campus_id, s.full_name INTO v_campus_id, v_student_name
    FROM students s WHERE s.id = NEW.student_id;
    
    SELECT company_name, ctc_max_lpa INTO v_company, v_ctc
    FROM drives WHERE id = NEW.drive_id;
    
    -- Find Principal/Dean for this campus
    SELECT p.email INTO v_principal_email
    FROM profiles p
    JOIN staff_campus_assignments sca ON sca.profile_id = p.id
    WHERE sca.campus_id = v_campus_id
      AND p.role IN ('principal', 'dean')
      AND p.is_active = true
    LIMIT 1;
    
    IF v_principal_email IS NOT NULL THEN
      INSERT INTO notifications (kind, title, body, drive_id)
      VALUES (
        'super_dream_milestone',
        'Super Dream Offer: ' || v_student_name || ' — ' || v_company,
        'Heartiest congratulations! **' || v_student_name || '** from your campus has received a **Super Dream** offer from **' || v_company || '** (₹' || v_ctc || ' LPA).' || E'\n\n' ||
        'This is a significant milestone for your campus placement program.',
        NEW.drive_id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;
```

### 5.3 R1-R4: Recruiter Notifications
**Migration:** `0115_remaining_templates.sql` (continued)

**Note:** Recruiter notifications require a `recruiter_email` field in the drives table or a separate `drive_recruiters` table. For now, we'll use `drives.spoc_email` as the recruiter contact.

```sql
-- R1: Candidate Shortlist
CREATE OR REPLACE FUNCTION notify_recruiter_on_shortlist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.shortlist_status = 'published' AND OLD.shortlist_status IS DISTINCT FROM 'published' THEN
    INSERT INTO notifications (kind, title, body, drive_id)
    VALUES (
      'recruiter_shortlist',
      'Candidate Shortlist Published: ' || NEW.company_name,
      'The candidate shortlist for **' || NEW.company_name || '** has been published.' || E'\n\n' ||
      'Please review the shortlisted candidates and proceed with the next rounds.',
      NEW.drive_id
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- R2, R3, R4: Similar triggers for drive sourcing, interview schedule, drive conclusion
```

### 5.4 AD2-AD3: Admin Notifications
**Migration:** `0115_remaining_templates.sql` (continued)

```sql
-- AD2: Roster Import Complete
CREATE OR REPLACE FUNCTION notify_admin_on_roster_import()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_email TEXT;
BEGIN
  -- Fire after roster import completes (assuming a function that imports students)
  SELECT email INTO v_admin_email
  FROM profiles
  WHERE role = 'admin' AND is_active = true
  LIMIT 1;
  
  IF v_admin_email IS NOT NULL THEN
    INSERT INTO notifications (kind, title, body)
    VALUES (
      'roster_import_complete',
      'Student Roster Imported Successfully',
      'A new student roster has been imported successfully.' || E'\n\n' ||
      '• **Students Imported:** [Count]' || E'\n' ||
      '• **Campus:** [Campus Name]' || E'\n\n' ||
      'Please verify the imported records.',
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- AD3: Email Delivery Alert (monitoring)
-- This would be implemented as a cron job that checks for failed deliveries
CREATE OR REPLACE FUNCTION notify_admin_on_delivery_failures()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_email TEXT;
  v_failed_count INT;
BEGIN
  SELECT email INTO v_admin_email
  FROM profiles
  WHERE role = 'admin' AND is_active = true
  LIMIT 1;
  
  SELECT COUNT(*) INTO v_failed_count
  FROM email_deliveries
  WHERE status = 'failed'
    AND updated_at >= now() - interval '1 hour';
  
  IF v_admin_email IS NOT NULL AND v_failed_count > 0 THEN
    INSERT INTO notifications (kind, title, body)
    VALUES (
      'email_delivery_alert',
      'Email Delivery Failures Detected',
      'There have been **' || v_failed_count || '** email delivery failures in the last hour.' || E'\n\n' ||
      'Please check the Resend dashboard and database logs for details.',
    );
  END IF;
END;
$$;

-- Schedule cron job
SELECT cron.schedule(
  'email_delivery_alert',
  '0 * * * *',  -- Every hour
  $$SELECT notify_admin_on_delivery_failures()$$
);
```

---

## Phase 6: Edge Function Template Updates

### 6.1 Add All New Template Cases
**File:** `supabase/functions/email-dispatch/index.ts`

Add cases for all new notification kinds:
- `kam_drive_alert`
- `campus_drive_alert`
- `campus_shortlist_ready`
- `verification_queue_digest`
- `attendance_pending`
- `drive_deadline_reminder`
- `interview_day_reminder`
- `weekly_operations_digest`
- `weekly_placement_digest`
- `policy_override_alert`
- `super_dream_milestone`
- `recruiter_shortlist`
- `recruiter_sourcing_kickoff`
- `recruiter_interview_schedule`
- `recruiter_drive_concluded`
- `roster_import_complete`
- `email_delivery_alert`

---

## Implementation Checklist

### Phase 1: CC Routing
- [ ] Create migration `0111_add_cc_routing.sql`
- [ ] Add `cc_emails` column to `email_deliveries`
- [ ] Create `resolve_cc_recipients()` function
- [ ] Update `enqueue_notification_email()` trigger
- [ ] Update edge function to handle CC
- [ ] Test CC routing for C1, C6, DH1

### Phase 2: KAM Notifications
- [ ] Create migration `0112_kam_drive_notifications.sql`
- [ ] Create `notify_kam_on_drive_published()` trigger
- [ ] Add `kam_drive_alert` template to edge function
- [ ] Test KAM notifications

### Phase 3: Campus CPC Notifications
- [ ] Create migration `0113_campus_cpc_notifications.sql`
- [ ] Create C1, C2, C3, C5 triggers
- [ ] Add templates to edge function
- [ ] Test all Campus CPC notifications

### Phase 4: Time-Based Triggers
- [ ] Create migration `0114_time_based_reminders.sql`
- [ ] Create S12, S13, DH3, L1 cron jobs
- [ ] Add templates to edge function
- [ ] Test all time-based triggers

### Phase 5: Remaining Templates
- [ ] Create migration `0115_remaining_templates.sql`
- [ ] Create DH2, L2, R1-R4, AD2-AD3 triggers
- [ ] Add templates to edge function
- [ ] Test all remaining templates

### Phase 6: Testing & Deployment
- [ ] Apply all migrations to test database
- [ ] Deploy updated edge function
- [ ] Run end-to-end tests for all 47 templates
- [ ] Verify CC routing works correctly
- [ ] Verify cron jobs are scheduled
- [ ] Monitor Resend dashboard for delivery

---

## Migration Files Summary

1. `0111_add_cc_routing.sql` — CC infrastructure
2. `0112_kam_drive_notifications.sql` — KAM notifications
3. `0113_campus_cpc_notifications.sql` — Campus CPC notifications (C1, C2, C3, C5)
4. `0114_time_based_reminders.sql` — Time-based triggers (S12, S13, DH3, L1)
5. `0115_remaining_templates.sql` — Remaining templates (DH2, L2, R1-R4, AD2-AD3)

**Total:** 5 migration files

---

## Cron Jobs Summary

**New Cron Jobs:**
1. `verification_queue_digest` — Daily 9 AM (C3)
2. `drive_deadline_reminder` — Every hour (S12)
3. `interview_day_reminder` — Daily 8 AM (S13)
4. `weekly_operations_digest` — Monday 8 AM (DH3)
5. `weekly_leadership_digest` — Monday 9 AM (L1)
6. `email_delivery_alert` — Every hour (AD3)

**Total:** 6 new cron jobs (plus existing 2 = 8 total)

---

## Template Status After Implementation

**Before:** 26 LIVE, 21 PLANNED  
**After:** 47 LIVE, 0 PLANNED

All templates will be fully operational with proper CC routing, KAM notifications, and time-based triggers.

---

**Next Steps:**
1. Review and approve this plan
2. Implement migrations in order (0111 → 0115)
3. Update edge function
4. Deploy to test database
5. Run comprehensive tests
6. Deploy to production

---

**Last Updated:** 2026-10-13  
**Maintained By:** Operations Team (operationsfpc)
