# FACE Prep Campus — Email Notification & Message Catalog

This document defines the complete catalog of emails sent by the Placement Management System (PMS). For every communication, it details:
- **Trigger event & initiating screen**
- **Sender identity (`From:`, `Reply-To:`)**
- **Recipient (`To:`) & exclusion criteria**
- **Exact subject line**
- **Complete email body content (HTML & Plain Text)**
- **Dynamic variables / placeholders**
- **Action Button / Call to Action (CTA)**

---

## Global Email Sender Standard

Unless specified otherwise, all outgoing system emails adhere to:
- **Logo Header:** Official FACE Prep Campus light logo (`faceprep-campus-light.png`) on Deep Indigo (`#3D3777`) banner with uppercase gold "OFFICIAL NOTICE" pill badge.
- **Top Brand Stripe:** Vibrant multi-color gradient (`#3D3777` Indigo → `#A46AFC` Violet → `#FFB800` Amber).
- **Cards & Layout:** Rounded 10px white card container on off-white (`#F1F5F9`) surface, with message box cards (`#F8FAFC`, border `#E2E8F0`, left accent `4px solid #3D3777`).
- **CTA Buttons:** Solid Indigo (`#3D3777`) with bold white typography, generous click targets (13px 28px), and right navigation arrow.
- **From:** `FACE Prep Campus <placements@email.faceprep.in>` *(In dev/test sandbox: `onboarding@resend.dev`)*
- **Reply-To:** `placements@faceprep.in`
- **Safety Routing:** All development test dispatches are locked and routed to `operationsfpc@faceprep.in`.
- **Support Contact:** `hello@faceprep.in`


---

## Table of Contents

1. [Student Communications](#1-student-communications)
   - [S1. Student Roster Welcome & Registration Form (SRF) Invitation](#s1-student-roster-welcome--registration-form-srf-invitation)
   - [S2. Placement Drive Published / Announced](#s2-placement-drive-published--announced)
   - [S3. Round 1 Shortlist Announcement](#s3-round-1-shortlist-announcement)
   - [S4. Round Schedule & Venue Announcement](#s4-round-schedule--venue-announcement)
   - [S5. Personal Interview Slot & Meeting Link](#s5-personal-interview-slot--meeting-link)
   - [S6. Round Cleared / Selected Announcement](#s6-round-cleared--selected-announcement)
   - [S7. Round Outcome — Not Selected](#s7-round-outcome--not-selected)
   - [S8. Job / Internship Offer Letter Declared](#s8-job--internship-offer-letter-declared)
   - [S9. Attendance Warning — Marked Absent](#s9-attendance-warning--marked-absent)
2. [Staff & Administrative Communications](#2-staff--administrative-communications)
   - [M1. Staff Role Invitation & Onboarding](#m1-staff-role-invitation--onboarding)
   - [M2. AE Deal Intake / PIF Submitted for Approval](#m2-ae-deal-intake--pif-submitted-for-approval)
   - [M3. PIF Approved — Ready for Drive Scheduling & Publish](#m3-pif-approved--ready-for-drive-scheduling--publish)
3. [Recruiter Communications](#3-recruiter-communications)
   - [R1. Shortlist & Candidate Resumes Export Pack](#r1-shortlist--candidate-resumes-export-pack)

---

## 1. Student Communications

All student drive communications strictly enforce the **opt-out safety rule**: students with `participation_status = 'opted_out'` are automatically excluded and will never receive drive emails.

---

### S1. Student Roster Welcome & Registration Form (SRF) Invitation

- **Trigger Event:** Admin imports a college student roster via CSV or XLSX.
- **Source Screen:** `/admin/roster`
- **Recipient (`To:`):** Student's institutional email address (`students.email`)
- **Condition:** Student row created with `srf_status = 'invited'`.
- **Subject:** `Welcome to FACE Prep Campus Placements — Complete Your Profile`

#### What will be mailed:

```
[Header: FACE Prep Campus | Placements]

Dear {full_name},

Your placement account for {campus_name} is now active on the FACE Prep Campus Placement Management System.

To participate in upcoming campus placement and internship drives, you must complete and submit your Student Registration Form (SRF). This includes verifying your academic records and uploading your semester marksheets.

Your Details on Record:
• Roll Number: {roll_number}
• Degree & Branch: {degree} — {branch}
• Passing Year: {passing_year}

Please sign in using your registered Google account ({email}) and complete your registration.

[BUTTON: Complete Registration Form -> https://faceprepcampus.com/student/srf]

Note: Incomplete profiles cannot apply for placement drives once registration closes.

Warm regards,
Placement Cell, FACE Prep Campus
Need help? Contact hello@faceprep.in
```

---

### S2. Placement Drive Published / Announced

- **Trigger Event:** Central Placement Coordinator (CPC) finalises targeting and publishes an approved drive.
- **Source Screen:** `/central/publish?drive={drive_id}`
- **Recipient (`To:`):** All eligible active students matching the drive's targeted campuses, degrees, branches, passing year, and academic cutoffs.
- **Subject:** `New Drive: {company_name} is hiring for {role_title}`

#### What will be mailed:

```
[Header: FACE Prep Campus | Placement Drive Announcement]

Dear {full_name},

A new placement drive has been announced for your cohort:

==================================================
Company:         {company_name}
Role:            {role_title}
Drive Type:      {drive_type} (Placement / Internship)
Category:        {offer_category} (Regular / Dream / Super Dream / Internship)
Compensation:    {ctc_lpa} LPA {stipend_text}
Application Due: {application_end_datetime_ist}
==================================================

Eligibility Criteria:
• Minimum CGPA: {min_cgpa}
• Maximum Backlogs: {max_arrears}
• Targeted Campuses: {campuses_list}

Please review the job description, bond terms, and shift requirements carefully before applying.

[BUTTON: View Drive & Apply -> https://faceprepcampus.com/student/drives/{drive_id}]

Warm regards,
Central Placement Cell, FACE Prep Campus
```

---

### S3. Round 1 Shortlist Announcement

- **Trigger Event:** Central CPC finalises candidate screening and saves the shortlist entries.
- **Source Screen:** `/central/shortlist?drive={drive_id}`
- **Database Trigger:** `shortlist_reaches_student` on `shortlist_entries`
- **Recipient (`To:`):** Selected shortlisted students (`shortlist_entries.included = true`)
- **Subject:** `Shortlisted: You are shortlisted for {company_name}`

#### What will be mailed:

```
[Header: FACE Prep Campus | Drive Shortlist]

Dear {full_name},

Congratulations! You have been shortlisted for the {company_name} placement drive ({role_title}).

Round 1 is next. You are expected to attend every scheduled round for this drive. Details regarding date, time, and venue/meeting links will follow shortly.

Drive Summary:
• Company: {company_name}
• Role: {role_title}
• Drive Type: {drive_type}

[BUTTON: View Application Status -> https://faceprepcampus.com/student/drives/{drive_id}]

Important: Failure to attend scheduled rounds without prior approved permission may lead to placement disbarment review.

Warm regards,
Central Placement Cell, FACE Prep Campus
```

---

### S4. Round Schedule & Venue Announcement

- **Trigger Event:** Placement Coordinator sets or updates round date, time, venue address, mode, or general meeting link.
- **Source Screen:** `/central/rounds?drive={drive_id}`
- **Database Trigger:** `round_details_reach_students` on `drive_rounds`
- **Recipient (`To:`):** All students enrolled/participating in that specific round.
- **Subject:** `{company_name} — {round_name} Schedule & Details`

#### What will be mailed:

```
[Header: FACE Prep Campus | Round Schedule]

Dear {full_name},

The schedule for {round_name} of {company_name} has been published:

• Round:       {round_name} (Round {sequence})
• Date & Time: {round_datetime_ist} IST
• Mode:        {round_mode} (Online / Physical / Hybrid)
• Venue:       {venue_or_meeting_details}
• Instructions:{round_instructions}

{meeting_link_clause}

Please ensure you arrive at the venue 15 minutes before the scheduled time or join the virtual room promptly with your full name and roll number.

[BUTTON: View Drive Dashboard -> https://faceprepcampus.com/student/drives/{drive_id}]

Warm regards,
FACE Prep Campus Placement Team
```

---

### S5. Personal Interview Slot & Meeting Link

- **Trigger Event:** Coordinator assigns a personalised 1-on-1 interview time or dedicated meeting link for a student.
- **Source Screen:** `/central/rounds?drive={drive_id}` (Slot assignment panel)
- **Database Trigger:** `meeting_slot_reaches_student` on `round_participants`
- **Recipient (`To:`):** The individual scheduled student.
- **Subject:** `{company_name} — Your {round_name} Interview Slot`

#### What will be mailed:

```
[Header: FACE Prep Campus | Interview Slot]

Dear {full_name},

Your individual interview slot for {round_name} of {company_name} has been scheduled:

• Date & Time:  {participant_scheduled_at_ist} IST
• Meeting Link: {meeting_link}
• Round:        {round_name}

Please join the link 5 minutes prior to your time slot. Have a soft copy of your resume and college ID card ready.

[BUTTON: Join Interview Room -> {meeting_link}]

Best of luck!
FACE Prep Campus Placement Cell
```

---

### S6. Round Cleared / Selected Announcement

- **Trigger Event:** Coordinator marks candidate's outcome as `selected` for a round.
- **Source Screen:** `/central/results?drive={drive_id}&round={round_id}`
- **Database Trigger:** `round_result_reaches_student` on `round_results`
- **Recipient (`To:`):** Students who cleared the round.
- **Subject:** `Well done — You cleared Round {sequence} of {company_name}`

#### What will be mailed:

```
[Header: FACE Prep Campus | Results Update]

Dear {full_name},

Great news! You have successfully cleared Round {sequence} ({round_name}) of the {company_name} placement drive.

You are advancing to the next round. The schedule and details for the upcoming round will be shared shortly on your student dashboard.

Keep up the great performance!

[BUTTON: View Drive Progress -> https://faceprepcampus.com/student/drives/{drive_id}]

Warm regards,
Central Placement Cell, FACE Prep Campus
```

---

### S7. Round Outcome — Not Selected

- **Trigger Event:** Coordinator marks candidate's outcome as `rejected` for a round.
- **Source Screen:** `/central/results?drive={drive_id}&round={round_id}`
- **Database Trigger:** `round_result_reaches_student` on `round_results`
- **Recipient (`To:`):** Students not selected in that round.
- **Subject:** `{company_name} — Round {sequence} Update`

#### What will be mailed:

```
[Header: FACE Prep Campus | Drive Update]

Dear {full_name},

Thank you for participating in Round {sequence} ({round_name}) of the {company_name} placement drive.

The evaluation process has concluded, and you were not selected to advance further in this particular drive.

Every selection process is competitive and offers valuable experience. Your placement status remains active for upcoming companies matching your profile. Please keep checking your dashboard for new drive announcements.

[BUTTON: Explore Open Drives -> https://faceprepcampus.com/student/drives]

Wishing you the very best for upcoming opportunities,
Placement Team, FACE Prep Campus
```

---

### S8. Job / Internship Offer Letter Declared

- **Trigger Event:** Coordinator records an on-campus offer in the results console.
- **Source Screen:** `/central/results?drive={drive_id}&round={round_id}` (Offer declaration)
- **Database Trigger:** `offer_reaches_student` on `offers`
- **Recipient (`To:`):** Placed candidate (`offers.student_id`)
- **Subject:** `Congratulations — Offer from {company_name} ({offer_category_label})!`

#### What will be mailed:

```
[Header: FACE Prep Campus | Placement Offer Declared]

Dear {full_name},

Heartiest congratulations! 

{company_name} has formally extended you an offer for the position of {role_title}.

Offer Details:
• Company:        {company_name}
• Role:           {role_title}
• Offer Category: {offer_category_label} (Regular / Dream / Super Dream / Internship)
• CTC:            ₹{ctc_lpa} LPA {stipend_text}
• Date Declared:  {declared_at_formatted}

{offer_letter_clause: "Your official offer letter has been uploaded to your PMS portal."}

This is a testament to your hard work and dedication. We wish you immense success in your professional career!

[BUTTON: View Offer & Download Letter -> https://faceprepcampus.com/student/notifications]

With best wishes,
Central Placement Cell, FACE Prep Campus
```

---

### S9. Attendance Warning — Marked Absent

- **Trigger Event:** Coordinator marks student as `absent` during attendance tracking.
- **Source Screen:** `/central/results` or attendance marking
- **Database Trigger:** `notify_absent_student` on `attendance`
- **Recipient (`To:`):** The absent student.
- **Subject:** `Urgent: Attendance Notice for {company_name}`

#### What will be mailed:

```
[Header: FACE Prep Campus | Attendance Notice]

Dear {full_name},

You were recorded as ABSENT for {round_name} of the {company_name} placement drive held on {scheduled_date}.

Under placement policy guidelines:
• Attendance in all scheduled rounds is mandatory once shortlisted.
• Unexcused absences across drives are audited and accumulated.
• Repeated absences lead to immediate review and potential disbarment from future campus drives.

If you believe this record is an error or had an approved medical/emergency exemption, please contact your Campus Placement Coordinator immediately.

[BUTTON: Contact Coordinator -> https://faceprepcampus.com/student/dashboard]

Placement Compliance Team,
FACE Prep Campus
```

---

## 2. Staff & Administrative Communications

---

### M1. Staff Role Invitation & Onboarding

- **Trigger Event:** Admin invites a new staff member with an assigned role.
- **Source Screen:** `/admin/staff`
- **Recipient (`To:`):** Staff member's corporate/institutional email (`staff_invitations.email`)
- **Subject:** `Invitation to FACE Prep Campus PMS as {role_display_name}`

#### What will be mailed:

```
[Header: FACE Prep Campus | Team Invitation]

Hello {full_name},

You have been invited to join the FACE Prep Campus Placement Management System (PMS) as:

Role:               {role_display_name}
Assigned Campus(es):{campuses_assigned_list}
Invited By:         {inviter_email}

Your PMS account allows you to manage drives, verify student credentials, and oversee placement operations according to your role permissions.

To access your account:
1. Click the sign-in link below.
2. Sign in using your Google account: {email}.

[BUTTON: Sign In to PMS -> https://faceprepcampus.com/login]

Welcome to the team!
Administrator, FACE Prep Campus
```

---

### M2. AE Deal Intake / PIF Submitted for Approval

- **Trigger Event:** Account Executive (AE) submits a Placement Initiation Form (PIF) or incoming deal.
- **Source Screen:** `/ae/drives/new` or `/ae/drives/{id}`
- **Recipient (`To:`):** Delivery Head (`delivery_head` role profiles)
- **Subject:** `Action Required: PIF Submitted for {company_name} by {ae_name}`

#### What will be mailed:

```
[Header: FACE Prep Campus | PIF Approval Queue]

Dear Delivery Head,

A new Placement Initiation Form (PIF) has been submitted and is waiting for your review and classification:

• Company:         {company_name}
• Role:            {role_title}
• Drive Type:      {drive_type}
• Declared CTC:    ₹{ctc_lpa} LPA
• Submitted By AE: {ae_name} ({ae_email})

Please review the recruiter contacts, compensation terms, and job description, assign the official Offer Category, and approve or reject the drive.

[BUTTON: Open PIF Review Queue -> https://faceprepcampus.com/delivery-head/queue]

FACE Prep Campus PMS Notification Service
```

---

### M3. PIF Approved — Ready for Drive Scheduling & Publish

- **Trigger Event:** Delivery Head approves the PIF and assigns the CTC classification band.
- **Source Screen:** `/delivery-head/queue`
- **Recipient (`To:`):** Central Placement Coordinators (`central_placement_coordinator` profiles)
- **Subject:** `Drive Approved: {company_name} — Ready for Round Setup & Publishing`

#### What will be mailed:

```
[Header: FACE Prep Campus | Drive Ready to Publish]

Dear Central Placement Coordinator,

The Placement Initiation Form (PIF) for {company_name} ({role_title}) has been approved by the Delivery Head:

• Company:        {company_name}
• Role:           {role_title}
• Offer Category: {offer_category_label}
• CTC / Stipend:  ₹{ctc_lpa} LPA {stipend_text}
• Approved By:    {approver_name}

You may now configure the drive rounds, verify campus targeting, and publish the drive live to students.

[BUTTON: Configure & Publish Drive -> https://faceprepcampus.com/central/publish?drive={drive_id}]

FACE Prep Campus PMS Notification Service
```

---

## 3. Recruiter Communications

---

### R1. Shortlist & Candidate Resumes Export Pack

- **Trigger Event:** Central Placement Coordinator generates and dispatches the verified shortlist pack.
- **Source Screen:** `/central/shortlist?drive={drive_id}` (Recruiter Export action)
- **Recipient (`To:`):** Recruiter SPOCs listed in the drive contacts (`drives.contacts[].email`)
- **Subject:** `Candidate Shortlist & Resume Pack — {company_name} Drive | FACE Prep Campus`

#### What will be mailed:

```
[Header: FACE Prep Campus | Campus Recruitment]

Dear {contact_name},

Thank you for partnering with FACE Prep Campus for your {passing_year} recruitment drive.

Please find attached the official candidate shortlist for the {role_title} opportunity:
• Total Shortlisted Candidates: {shortlisted_count}
• Partner Campuses:             {participating_campuses}

The attached export package contains:
1. Candidate Manifest Spreadsheet (`.xlsx`) with verified CGPA, branch, skill ratings, and contact details.
2. Verified Candidate Resume Pack (`.zip` containing verified PDF resumes).

Our coordinator team is ready to assist with scheduling Round 1 evaluations and technical assessments.

Coordinator Contact:
• Lead CPC: {cpc_name} ({cpc_email}, {cpc_phone})

Thank you,
FACE Prep Campus Recruitment Team
```

---

## 4. Technical Reference: Trigger & Recipient Summary Table

| Code | Event | Trigger Location | Recipient Field | Delivery Mechanism |
|---|---|---|---|---|
| **S1** | Welcome / SRF Invite | `/admin/roster` | `students.email` | `resend.emails.send` |
| **S2** | Drive Published | `/central/publish` | Targeted `students.email` | `resend.batch.send` |
| **S3** | Shortlisted | `/central/shortlist` | `students.email` | `email_deliveries` queue |
| **S4** | Round Scheduled | `/central/rounds` | Participating `students.email` | `email_deliveries` queue |
| **S5** | Meeting Slot Assigned | `/central/rounds` | Scheduled `students.email` | `email_deliveries` queue |
| **S6** | Round Selected | `/central/results` | Selected `students.email` | `email_deliveries` queue |
| **S7** | Round Not Selected | `/central/results` | Rejected `students.email` | `email_deliveries` queue |
| **S8** | Offer Declared | `/central/results` | Placed `students.email` | `email_deliveries` queue |
| **S9** | Absent Marked | `/central/results` | Absent `students.email` | `email_deliveries` queue |
| **M1** | Staff Onboarding | `/admin/staff` | `staff_invitations.email` | `resend.emails.send` |
| **M2** | PIF Submit for Review | `/ae/drives/new` | Delivery Head `profiles.email` | `resend.emails.send` |
| **M3** | Drive Approved | `/delivery-head/queue` | Central CPC `profiles.email` | `resend.emails.send` |
| **R1** | Shortlist & Resumes | `/central/shortlist` | Recruiter `drives.contacts[].email` | `resend.emails.send` (with attachments) |
