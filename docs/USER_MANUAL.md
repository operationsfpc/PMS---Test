# FACE Prep Campus — Placement Management System (PMS)
## Comprehensive User Manual & Operations Guide

**System Version:** 2.0 (Production / Multi-Campus)  
**Target Organization:** FACE Prep Campus (Focus 4D Career Education Pvt Ltd)  
**System Architecture:** Three-Layer Architecture (Domain Rules Engine, React UI, Supabase Postgres with Row-Level Security & Audit Logging)

---

## Table of Contents

1. [System Overview & Architecture Principles](#1-system-overview--architecture-principles)
2. [User Roles & Access Control Matrix](#2-user-roles--access-control-matrix)
3. [Student Guide](#3-student-guide)
   - 3.1 Initial Login & Registration (SRF)
   - 3.2 Academic Records & Marksheet Uploads
   - 3.3 Role Category Preferences & Resumes
   - 3.4 Student Dashboard & Notifications
   - 3.5 Discovering & Applying to Placement Drives
   - 3.6 Recruitment Rounds, Slot Tracking & Attendance
   - 3.7 Offers, Stipends & Offer Letters
   - 3.8 Post-Approval Profile Updates & Add Semester
   - 3.9 Opting Out & Recording Off-Campus Offers
4. [Campus Placement Coordinator (CPC) Guide](#4-campus-placement-coordinator-cpc-guide)
   - 4.1 Campus Overview Dashboard
   - 4.2 Student SRF Verification Queue
   - 4.3 Certificate Verification Queue
   - 4.4 Subsequent Semester (CGPA) Verification Queue
   - 4.5 Drive Progress Tracking (Campus Cohort)
   - 4.6 Marking & Overriding Attendance
   - 4.7 Processing Opt-Out and Off-Campus Requests
5. [Account Executive (AE) Guide](#5-account-executive-ae-guide)
   - 5.1 Account Executive Workspace & Landing Page
   - 5.2 Initiating a Placement Drive (PIF: Sections 1–4)
   - 5.3 Tracking Submitted PIFs & Live Drive Funnels
6. [Delivery Head Guide](#6-delivery-head-guide)
   - 6.1 Placement Overview & Metrics
   - 6.2 PIF Review & Commercial Terms Validation
   - 6.3 Offer Category Banding & Immutable Classification
   - 6.4 Approval vs. Permanent Rejection Rules
7. [Central Placement Coordinator (Central CPC) Guide](#7-central-placement-coordinator-central-cpc-guide)
   - 7.1 Central Cockpit & Drive Lifecycle Oversight
   - 7.2 Drive Completion & Publishing (DAF Configuration & Targeting)
   - 7.3 Candidate Audience Filtering & Prestige Overrides
   - 7.4 Institutional Skill Repository Management
   - 7.5 AI-Assisted Internal Shortlisting & Ranking
   - 7.6 Recruiter Export Pack Generation
   - 7.7 Round Scheduling, Interview Slots CSV & Results Declaration
   - 7.8 Final Selection Declaration & Offer Letter Distribution
   - 7.9 Absence Sanctions & Disbarment Reviews
8. [Administrator Guide](#8-administrator-guide)
   - 8.1 Campus Configuration & Academic Programmes
   - 8.2 Staff Invitation, Role Scoping & Account Deactivation
   - 8.3 Student Roster Bulk CSV Import
   - 8.4 Offer Category Bands & Global Configurations
   - 8.5 Audit Trail & System Integrity Oversight
9. [Executive & Management Guides](#9-executive--management-guides)
   - 9.1 Campus Manager (CM)
   - 9.2 Key Account Manager (KAM)
   - 9.3 Enterprise Relations (ER) & ER Head
   - 9.4 Chief Executive Officer (CEO)
10. [End-to-End Core Business Rules & Policies](#10-end-to-end-core-business-rules--policies)
    - 10.1 The Drive Lifecycle (Three Verbs, Three Roles)
    - 10.2 Offer Category Ladder & Multiple Offer Rules
    - 10.3 Plain Internships vs. Salaried Placements (CTC vs. Stipend)
    - 10.4 Eligibility Evaluation & Profile Snapshots
    - 10.5 Strict Absence Limit Policy (3-Strike Rule)
    - 10.6 Immutable Audit Logging & Data Protection
11. [Troubleshooting & Frequently Asked Questions (FAQ)](#11-troubleshooting--frequently-asked-questions-faq)

---

## 1. System Overview & Architecture Principles

The **FACE Prep Campus Placement Management System (PMS)** is an enterprise platform engineered to manage the complete campus placement lifecycle across partner collegiate institutions. It unifies student registration, drive origination, eligibility verification, audience targeting, internal AI-assisted shortlisting, recruiter handoff, multi-round recruitment management, attendance compliance, offer declaration, and institutional placement reporting.

### Core Architectural Principles

1. **Layered Domain Separation:**
   - **Layer 0 (`src/domain/`):** Pure, deterministic TypeScript business logic without React, network I/O, or database dependencies. All business rules live here.
   - **Layer 1 (`src/features/`):** Rich, accessible user interface built on React 19, React Router v7, TanStack Query, and Tailwind CSS.
   - **Layer 2 (`supabase/`):** Postgres database hosted in AWS Mumbai (`ap-south-1`) with Row-Level Security (RLS) enforcing access policies, triggers managing append-only immutable audit trails, and transactional constraints.
2. **Immutable Application Snapshots:**
   When a student applies to a drive, the system takes an immutable snapshot of their verified profile and role-relevant resume. Downstream processes (shortlisting, recruiter exports, rounds, interviews) read the snapshot, guaranteeing that later profile changes never invalidate previous drive records.
3. **Verified Data Only for Eligibility:**
   A student can never qualify for a drive based on unverified or pending edits. Eligibility is always checked in real time against verified academic records.
4. **Three Verbs, Three Roles in Drive Origination:**
   - **Raise:** Account Executive (AE) only.
   - **Approve & Categorize:** Delivery Head only.
   - **Publish & Target:** Central Placement Coordinator (Central CPC) only.
   No individual or role can execute more than their designated step in this chain.

---

## 2. User Roles & Access Control Matrix

The platform defines **11 distinct user roles**:

| # | Role | Primary Responsibility | Scope | Default Landing Page |
|---|---|---|---|---|
| 1 | **`student`** | Complete SRF, apply to drives, track rounds, download offers | Self only | `/student` (or `/srf` if incomplete) |
| 2 | **`campus_placement_coordinator` (CPC)** | Verify student profiles, mark attendance, review opt-outs | Assigned campus only | `/dashboard` |
| 3 | **`account_executive` (AE)** | Bring in recruiters, raise PIFs, view own drive funnels | Own drives & org aggregates | `/ae/overview` |
| 4 | **`delivery_head`** | Approve/reject PIFs, set offer categories, review placement health | Org-wide | `/dashboard` |
| 5 | **`central_placement_coordinator` (Central CPC)** | Complete PIF, publish DAF, shortlist, run rounds, declare offers | Org-wide (single operational owner in MVP) | `/dashboard` |
| 6 | **`admin`** | Manage campuses, programmes, staff accounts, roster imports | Org-wide | `/dashboard` |
| 7 | **`campus_manager`** | Operational and placement reporting | Assigned campus(es) | `/dashboard` |
| 8 | **`key_account_manager` (KAM)** | Multi-campus account oversight | Assigned campuses | `/dashboard` |
| 9 | **`enterprise_relations` (ER)** | Monitor recruiter relationships & supply corporate details | Org-wide | `/dashboard` |
| 10 | **`er_head`** | Executive reporting on employer relations (Strictly read-only) | Org-wide | `/dashboard` |
| 11 | **`ceo`** | Executive performance and strategic analytics | Org-wide | `/dashboard` |

### Detailed Permission Matrix

| Capability / Action | student | CPC | AE | Delivery Head | Central CPC | Admin | CM / KAM / ER / CEO |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Submit / Resubmit SRF | **YES** | — | — | — | — | — | — |
| Verify SRF & Marksheets | — | **YES** | — | — | — | — | — |
| Verify Certificates & CGPA Updates | — | **YES** | — | — | — | — | — |
| Raise Drive (PIF) | — | — | **YES** | — | — | — | — |
| Approve / Reject PIF | — | — | — | **YES** | — | — | — |
| Classify Offer Category | — | — | — | **YES** | — | — | — |
| Publish Drive (DAF) to Students | — | — | — | — | **YES** | — | — |
| Apply to Drives | **YES** | — | — | — | — | — | — |
| Run Internal Shortlisting & AI Ranking | — | — | — | — | **YES** | — | — |
| Download Recruiter Export Pack | — | — | — | — | **YES** | — | — |
| View Drive Applicant Names (Portfolio) | — | — | **YES** | — | — | — | — |
| Schedule Rounds & Upload Slot CSVs | — | — | — | — | **YES** | — | — |
| Advance Rounds & Declare Results | — | — | — | — | **YES** | — | — |
| Mark / Confirm Attendance | — | **YES** | — | — | **YES** | — | — |
| Declare Offers & Attach Letters | — | — | — | — | **YES** | — | — |
| Approve Opt-Out & Self-Placement | — | **YES** | — | — | **YES** | — | — |
| Configure Campuses, Degrees & Staff | — | — | — | — | — | **YES** | — |
| Import Student Roster CSV | — | — | — | — | — | **YES** | — |
| View Role-Scoped Placement Dashboard | — | **YES** | — | **YES** | **YES** | **YES** | **YES** |

---

## 3. Student Guide

### 3.1 Initial Login & Registration (SRF)
1. **Accessing the Portal:**
   - Navigate to `/login` using the institution-issued email and password.
   - If your profile has not yet been registered or approved, you will be directed straight to the full-screen **Student Registration Form (`/srf`)**.
2. **Form Layout:**
   - The SRF is autosaved to prevent loss of progress during entry.
   - It captures Personal, Academic, Placement Preferences, Professional Profiles, Resumes, and Certifications.

### 3.2 Academic Records & Marksheet Uploads
- **Personal Details:** Full name, roll number, primary mobile number, WhatsApp number, and a mandatory alternate contact number.
- **School Academics:**
  - 10th Standard: Institution name, percentage, school board (CBSE, ICSE, State Board with state selection, or Other), and marksheet PDF upload.
  - 12th Standard: Institution name, percentage, school board, and marksheet PDF upload.
  - Diploma (if applicable): Institution, awarding university/board, marks, and marksheet upload.
- **Degree Academics:**
  - Programme Level: Undergraduate (UG) or Postgraduate (PG).
  - Degree, Branch, and Expected Passing Year.
  - One Single Grade Scale: Choose **CGPA (10-point scale)** or **Percentage** for your entire college programme.
  - Semesters: Add each completed semester with Marks/CGPA, standing arrears, arrear history, and attach the official semester marksheet file.
    - **Standing Arrears:** Number of uncleared backlogs currently pending for that semester.
    - **Arrear History (Cumulative):** Total backlogs ever accrued across your degree up to that semester (including cleared backlogs). Arrear history is strictly cumulative: it can never be less than standing arrears, and can never decrease from one semester to the next.
- **Document Integrity:** Marksheet uploads are strictly matched against entered values. Entering values without proof will prevent verification.

### 3.3 Role Category Preferences & Resumes
The system uses **5 canonical role categories**:
1. `software_technical` — Software / Technical
2. `technical_support_it_ops` — Technical Support / IT Operations
3. `digital_marketing` — Digital Marketing
4. `sales` — Sales
5. `operations_business` — Operations & Business Roles

- **Requirement:** You must select at least one role category.
- **Resume Uploads:** For **each** selected role category, you must upload a targeted resume (PDF). If you select Software and Sales, you must upload both a Technical Resume and a Sales Resume.
- **Profiles:** Enter links to your LinkedIn, GitHub, LeetCode, HackerRank, or other custom competitive coding/portfolio platforms.
- **Consent:** Explicit consent is required before submitting your SRF.

### 3.4 Student Dashboard & Notifications
Once your SRF is verified by your Campus Placement Coordinator, you land on **My Dashboard (`/student`)**:
- **Status Banner:** Shows your registration status (`Verified`), placement participation status (`Active`), and current placement summary.
- **Notification Inbox:** Live alert center for drive announcements, deadline reminders, upcoming round interview slots, results, and offer letters. Click **Read all** to navigate to `/student/notifications`.
- **Urgent Closing Warnings:** Drives with application deadlines closing within 24 hours are highlighted in hot warning tones.

### 3.5 Discovering & Applying to Placement Drives
Navigate to **Drives (`/student/drives`)**. Drives are strictly categorized into **4 distinct tabs**:
1. **To Apply:** Open drives where you meet all eligibility criteria, matches your chosen role categories and drive preferences, and whose application window is currently active.
   - Cards display company name, role, CTC / stipend, locations, job description summary, and closing time (e.g., *"4 days left to apply"* or *"35 minutes left"*).
   - Click **Apply** to submit your application. The system immediately takes an **immutable snapshot** of your verified academic profile and role-relevant resume.
   - *Note:* Once applied, an application cannot be withdrawn.
2. **In Progress:** Drives you applied to that are currently underway (shortlisting, tests, interviews, pending results).
3. **Applied (Closed):** Drives where your participation has concluded (either an offer received, drive completed, or not selected in a round).
4. **Not Applied (Closed):** Drives you were eligible for but whose application deadline expired without an application.

### 3.6 Recruitment Rounds, Slot Tracking & Attendance
- **Round Details:** For drives in progress, check the drive card or detail page (`/drives/:driveId`) to view your scheduled rounds.
- **Interview Slots:** If individual slots are assigned, view your specific interview time and virtual meeting URL or physical campus venue.
- **Attendance Requirement:** You must attend every round you are scheduled for. Attendance is marked as *Present* or *Absent*.
- **Absence Sanction Policy:** Accruing **3 cumulative unexcused absences** across your entire college tenure triggers a Central Placement Coordinator review for permanent disbarment.

### 3.7 Offers, Stipends & Offer Letters
- When a final selection is declared:
  - **Salaried Drives (Placement / Convertible):** Recorded in LPA (Lakhs Per Annum).
  - **Plain Internship Drives:** Recorded as a monthly stipend (₹ / month).
- **Offer Letter Download:** Download your official signed offer letter directly from the **My Offers** section on your dashboard, the concluded drive card, or the offer notification link.

### 3.8 Post-Approval Profile Updates & Add Semester
- **Editable Profile Fields (`/student/profile`):** You can update technical skills, areas of interest/expertise, personal projects, achievements, and professional profile links at any time.
- **New Certifications:** Add certifications by specifying the credential name and uploading the certificate file. These route to your CPC for verification.
- **Add Subsequent Semesters (`/srf`):** When subsequent semester results are announced, click **Add Semester** on your registration form, enter marks, standing/historical arrears, and upload the marksheet. The new semester is pending until your CPC verifies it.

### 3.9 Opting Out & Recording Off-Campus Offers
- **Opting Out (`/student/opt-out`):** If you decide to pursue higher education, family business, or entrepreneurship, you can submit an opt-out request with a stated reason.
  - *Warning:* Opting out is **irreversible** once approved by the CPC. You are removed from all targeting and cannot rejoin campus placements.
- **Off-Campus Offer (`/student/off-campus`):** If you secure an offer outside the campus placement cell, submit the company name, role title, CTC in LPA, and upload the offer letter. Once verified by your CPC, it counts as a recognized *Self-Placed* statistic without penalizing your on-campus participation.

---

## 4. Campus Placement Coordinator (CPC) Guide

### 4.1 Campus Overview Dashboard
- Access **Campus Overview (`/dashboard`)**. The dashboard is automatically scoped by Row-Level Security to students enrolled at your designated campus.
- **Key Metrics:**
  - Total Enrolled Students on Roster
  - SRF Verification Pipeline (Registered, Submitted, Verified)
  - Placement Percentage (`Placed Students / Eligible Population`)
  - CTC Statistics: Highest, Median, and Average package
  - Campus Drive Progress Funnel (Applied → Shortlisted → In Rounds → Selected)

### 4.2 Student SRF Verification Queue
- Navigate to **Verification → Student verification (`/cpc/verification`)**.
- Displays students from your campus with status `srf_submitted`.
- **Review Protocol:**
  1. Click to expand student record.
  2. Inspect declared 10th and 12th marks or letter/scale grades (mandatory for Cambridge and Other boards where percentage is optional) against uploaded school marksheets.
  3. **School Marksheets Column:** Displays only qualification marksheets (`10th marksheet`, `12th marksheet`, `Diploma marksheet`, `Consolidated UG marksheet`). All non-school documents (certificates, resumes, offer letters) are strictly excluded, and only the single latest uploaded active scan is displayed per marksheet kind.
  4. Verify board selections (including state jurisdiction for State Boards, or board name for Other) and diploma credentials if present.
  5. Compare semester marks/CGPA, current arrears, and arrears history against each uploaded semester marksheet. The table's **Arrear history** column shows the student's cumulative degree arrear history, preventing inconsistencies where individual semester backlogs exceed the summary count.
  6. Validate uploaded category-specific resumes in their dedicated columns.
- **Actions:**
  - **Approve:** Converts student status to `srf_approved`. The student immediately becomes eligible for audience targeting.
  - **Send Back (Reject):** You must enter a clear, specific explanation in the comment box (e.g., *"Semester 4 marksheet is blurry; please re-upload clear marksheet"*). The student receives the comment and can edit and resubmit.

### 4.3 Certificate Verification Queue
- Navigate to **Verification → Certificate verification (`/cpc/certificates`)**.
- Review student-submitted extracurricular and technical certifications.
- Open the attached certificate file, verify authenticity and student name, then click **Verify** or **Reject**.

### 4.4 Subsequent Semester (CGPA) Verification Queue
- Navigate to **Verification → CGPA verification (`/cpc/semesters`)**.
- When students submit subsequent semesters via *Add Semester*, they appear in this queue.
- Verify entered semester marks and arrears against the newly uploaded marksheet. Approving updates their verified academic record and recalculates overall CGPA.

### 4.5 Drive Progress Tracking (Campus Cohort)
- Navigate to **Drives in progress → Drive progress (`/cpc/drives`)**.
- Read-only real-time tracking of all active drives where students from your campus have applied.
- Track funnel counts: Applied, Shortlisted, Stage-by-Stage Round progress, Offers, and Rejections.

### 4.6 Marking & Overriding Attendance
- Navigate to **Drives in progress → Attendance (`/cpc/attendance`)**.
- Select the drive and the active round.
- Only students scheduled by the recruiter for that round appear.
- **Bulk Operations:** Use **Select all / Unselect all** to quickly mark attendance in large exam halls or auditoriums.
- Toggle individuals between **Present** and **Absent**, then click **Save**.
- Any subsequent attendance override writes an audit record with timestamp and coordinator identity.

### 4.7 Processing Opt-Out and Off-Campus Requests
- **Opt-Out Requests (`/cpc/opt-outs`):** Review student opt-out applications. Confirm reason and click **Approve** (irreversibly marks student `opted_out`) or **Reject**.
- **Off-Campus Offers (`/cpc/off-campus`):** Verify company name, CTC, and uploaded offer letter. Approving records the student as *Self-Placed*.

---

## 5. Account Executive (AE) Guide

### 5.1 Account Executive Workspace & Landing Page
- Lands on **My Overview (`/ae/overview`)**.
- Displays key figures for your accounts: drives raised, drives approved, drives live, total applicants, and organization-wide aggregate figures.
- Note: AEs do not have direct read access to individual student academic dossiers to preserve student privacy.

### 5.2 Initiating a Placement Drive (PIF: Sections 1–4)
Navigate to **Drive initiation → Position information form (`/ae/pif`)**:

- **Section 1: Company Profile & Recruiter SPOC:**
  - Company Name, Industry category, Corporate Website.
  - Recruiter SPOC Contacts: Name, Designation, Email, Phone.
- **Section 2: Job Role & Compensation:**
  - Role Title and Role Category (must match one of the 5 canonical categories).
  - Job Description (text summary) + Mandatory JD Attachment upload (PDF/DOCX).
  - Number of openings, work locations, shift type (Day, Night, Rotational; night timing if applicable).
  - Bond / Service Agreement details (if any).
  - **Pay Structure:**
    - For Placement / Convertible drives: Enter Minimum CTC and Maximum CTC in LPA, plus detailed CTC Breakup.
    - For Plain Internships: Enter Minimum and Maximum monthly stipend (₹ / month).
- **Section 3: Eligibility & Selection Criteria:**
  - Minimum Overall CGPA and Scale.
  - Minimum 10th and 12th percentage bars.
  - Arrears Policy: `no_standing` (no live backlogs), `no_history` (zero standing and zero historical backlogs), or `flexible`.
  - Eligible Passing Years (e.g., 2026).
  - Mandatory technical skills required for the role.
- **Section 4: Logistics & Hiring Process:**
  - Drive Mode: `on_campus`, `physical_outside_campus`, `virtual`, or `pooled`.
  - If off-campus venue, specify physical venue address.
  - Number of hiring rounds and tentative recruitment timeline.
- **Saving & Submission:**
  - Click **Save Draft** to save partial data and return later.
  - Click **Submit PIF** to run validation and route the drive to the Delivery Head approval queue.

### 5.3 Tracking Submitted PIFs & Live Drive Funnels
- Open **Drives → Live / Completed** or canonical drive records (`/drives/:driveId`).
- Unique AE Privilege: AEs have exclusive access to view the full **Applicant List** of students who applied to their drives under the canonical Drive Record page.

---

## 6. Delivery Head Guide

### 6.1 Placement Overview & Metrics
- Lands on **Placement overview (`/dashboard`)**.
- Monitors organization-wide health across all campuses: overall placement percentage, CTC bands distribution, and active drive statuses.

### 6.2 PIF Review & Commercial Terms Validation
- Navigate to **Drive approval → PIF approvals (`/delivery-head/pif-approvals`)**.
- Review every submitted PIF from Account Executives.
- Verify company reputation, CTC sustainability, bond constraints, and hiring round feasibility.

### 6.3 Offer Category Banding & Immutable Classification
The Delivery Head holds the sole binding authority to classify the drive's **Offer Category**:
- **Reference Bands:**
  - **Regular:** Up to ₹5.00 LPA
  - **Dream:** ₹5.00 LPA up to ₹10.00 LPA (a boundary of exactly 5.00 LPA is Dream)
  - **Super Dream:** ₹10.00 LPA and above (a boundary of exactly 10.00 LPA is Super Dream)
  - **Internship:** Automatically set for plain internship drives.
- The system suggests a category based on CTC, but the Delivery Head makes the authoritative decision.
- *Critical Rule:* Once approved, the Offer Category is **permanently immutable**.

### 6.4 Approval vs. Permanent Rejection Rules
- **Approve:** Approves the PIF and forwards it directly to the Central Placement Coordinator's publishing cockpit.
- **Reject:** You must provide a clear rejection reason.
  - *Critical Rule:* A rejected PIF is **permanently closed**. It cannot be edited, re-opened, or resubmitted. The AE must raise a fresh PIF.

---

## 7. Central Placement Coordinator (Central CPC) Guide

### 7.1 Central Cockpit & Drive Lifecycle Oversight
The Central CPC is the operational owner of the campus placement pipeline.
- Navigate to **Drives → Yet to publish (`/central/drives/yet-to-publish`)** to view all Delivery Head-approved drives awaiting publication.
- Navigate to **Live** and **Completed** tabs to oversee drives currently in progress or finished.

### 7.2 Drive Completion & Publishing (DAF Configuration & Targeting)
- Select a drive from *Yet to publish* and open **Publish & Target (`/central/publish`)**.
- **Mandatory Pre-Live Check:** The system verifies readiness:
  - Company name, Job role, Valid JD, Locations, Pay structure (CTC or Stipend), Rounds configuration, Application Start & End timestamps.
- Set Application Start Date and Application End Date/Time (strict closing deadline).

### 7.3 Candidate Audience Filtering & Prestige Overrides
- **Audience Filters:** Combine filters to target the exact student cohort:
  - Target Cities & Target Campuses
  - Target Degrees & Target Branches
  - 10th % cutoff, 12th % cutoff, College CGPA cutoff, Arrears Policy
- **Live Audience Calculation:** The system evaluates all verified student records against the filters in real time, displaying the exact number of eligible students before publishing.
- **Open-to-All Prestige Override:** For tier-1 prestige recruiters (e.g., Google, Microsoft), enable *Open to all*. This bypasses category ladder restrictions and previous placement ceilings, while still enforcing academic cutoffs and absence sanctions.
- Click **Publish Drive**. Email and portal notifications are instantly queued for all eligible students.

### 7.4 Institutional Skill Repository Management
- Navigate to **Student details → Skill repository (`/central/skills`)**.
- Maintain institutional scores: Aptitude, Coding, Technical, Communication, Domain Knowledge.
- **Skills Assessed (`/central/skills-assessed`):** Configure the master taxonomy of evaluated skills.
- Bulk upload updated assessment scores via Excel/CSV templates.

### 7.5 AI-Assisted Internal Shortlisting & Ranking
- When the application window closes, navigate to **Drives in progress → Shortlisting (`/central/shortlisting`)**.
- Select the drive. View all student applicants.
- **Algorithmic & AI Ranking:**
  - Evaluates application snapshots: verified CGPA, arrear history, skill assessment scores, project keywords, coding profiles, and category preference alignment.
  - Adjust ranking weights (Academics vs. Coding vs. Aptitude) as required by the recruiter.
- **Dual Record Keeping:** The system records both the system recommendation and your final decision for institutional auditability.
- If shortlisting a student who opted out after applying, an explicit override reason must be entered.

### 7.6 Recruiter Export Pack Generation
- On the Shortlisting screen, click **Export Recruiter Pack**.
- Generates:
  1. An Excel/CSV roster of shortlisted candidates with configurable columns.
  2. A structured ZIP archive containing all shortlisted student resumes, renamed with standard naming conventions (`Campus_RollNo_Name_Role.pdf`).
- Every export is logged in the Recruiter Data Sharing Audit Trail.

### 7.7 Round Scheduling, Interview Slots CSV & Results Declaration
Navigate to **Drives in progress → Rounds & results (`/central/results`)**:
1. **Round Configuration:** Add or edit rounds (e.g., Online Assessment, Technical Interview, HR Round).
   - Set Mode (`virtual` with shared meeting link, or `physical` with venue details) and Scheduled Date/Time.
2. **Staging & Assigning Meeting Slots:**
   - Download the meeting slots CSV template.
   - Fill in student roll numbers, interview times, and individual meeting URLs.
   - Upload the CSV. The system validates and stages assignments: *"X links ready for X students. Nothing is sent until you save."*
   - Click **Save** to write slots and notify students.
3. **Recording Results:**
   - For each participant, select **Selected**, **Rejected**, **Waitlisted**, or **On Hold**.
   - Result corrections can be made; all edits write to the audit log and trigger student updates.
4. **Advancing Candidates:**
   - Click **Advance to Next Round**. Only candidates marked *Selected* move forward. You may attach proof of recruiter instruction.

### 7.8 Final Selection Declaration & Offer Letter Distribution
- Navigate to **Drives in progress → Final selection (`/central/offers`)**.
- Select the drive and view finalists.
- Enter the exact offered compensation for each candidate:
  - Salaried Drives: Annual CTC in LPA.
  - Plain Internships: Monthly stipend in ₹ / month.
- Attach the official signed offer letter PDF.
- Click **Declare Selection**. The student status immediately updates to *Placed*, notifications are dispatched, and the offer letter is published to the student dashboard.

### 7.9 Absence Sanctions & Disbarment Reviews
- When a student accumulates 3 unexcused absences, the system alerts the Central CPC.
- Disbarment is never automatic: review the student's attendance records across all rounds, evaluate reasons, and make the manual decision to sanction or clear.

---

## 8. Administrator Guide

### 8.1 Campus Configuration & Academic Programmes
- Navigate to **Organisation → Campuses (`/admin/campuses`)**.
- Add and manage partner colleges: College Name, Campus Code, City, Affiliation details.
- Configure degree programmes and branch specializations per campus for each passing year.

### 8.2 Staff Invitation, Role Scoping & Account Deactivation
- Navigate to **Organisation → Staff (`/admin/staff`)**.
- **Invite Staff:** Enter staff email, select role from the 11 system roles, and assign campus scoping:
  - Campus Placement Coordinators: Scoped to exactly one campus.
  - Campus Managers & KAMs: Scoped to one or more campuses.
  - Central Staff & Executives: Org-wide scope.
- Manage existing staff: change assigned roles, modify campus mappings, or deactivate accounts.

### 8.3 Student Roster Bulk CSV Import
- Navigate to **Organisation → Add students (`/admin/roster`)**.
- Download the official Roster CSV Template.
- Required columns: Full Name, Roll Number, Student Email, Mobile Number, Degree, Branch, Passing Year.
- Select target campus and upload the CSV file.
- **Pre-Import Verification:** The system pre-validates all rows, checks against existing email identities, highlights errors with exact spreadsheet row numbers, and displays accepted counts.
- Click **Import Roster**. Accepted students automatically receive portal access invitations.

### 8.4 Offer Category Bands & Global Configurations
- Configure default CTC thresholds for Regular, Dream, and Super Dream offer categories.
- Manage institutional export templates and notification parameters.

### 8.5 Audit Trail & System Integrity Oversight
- Full access to the append-only Postgres audit trail (`audit_logs`).
- Track actor identity, timestamps, table names, before-state JSON, after-state JSON, and action justifications for every mutating event across the system.

---

## 9. Executive & Management Guides

### 9.1 Campus Manager (CM)
- Lands on **Campus Overview (`/dashboard`)**.
- Real-time visibility into campus registration funnels, drive participation, student placement rates, and company hiring trends across assigned campuses.

### 9.2 Key Account Manager (KAM)
- Lands on **Account Overview (`/dashboard`)**.
- Consolidated reporting across institutional client groups and corporate accounts under management.

### 9.3 Enterprise Relations (ER) & ER Head
- Dedicated visibility into corporate engagement, company participation histories, and placement distribution.
- **ER Head:** Strictly read-only access to all executive analytics dashboards (`rajesh@faceprep.in`).

### 9.4 Chief Executive Officer (CEO)
- Lands on **Executive Overview (`/dashboard`)**.
- High-level executive KPIs:
  - Aggregate placement percentage across all colleges.
  - CTC package distribution (Regular vs. Dream vs. Super Dream).
  - Placement metrics: Highest package, Median package, and Average package.
  - Active recruitment funnel health and institutional performance comparisons.

---

## 10. End-to-End Core Business Rules & Policies

### 10.1 The Drive Lifecycle (Three Verbs, Three Roles)
```
[AE] Raises PIF ──► [Delivery Head] Approves & Categorizes ──► [Central CPC] Publishes DAF to Students
```
- A drive cannot be raised by anyone except the AE.
- A drive cannot be approved or categorized by anyone except the Delivery Head.
- A drive cannot be published to students by anyone except the Central CPC.
- If a Delivery Head rejects a PIF, it is permanently closed and cannot be resubmitted.

### 10.2 Offer Category Ladder & Multiple Offer Rules
Campus placements follow an upward career mobility ladder:
$$\text{Regular (}\le \text{₹5 LPA)} \longrightarrow \text{Dream (₹5–10 LPA)} \longrightarrow \text{Super Dream (> ₹10 LPA)}$$

1. **Automatic Placement:** Declaring a final selection result instantly marks the student as *Placed*.
2. **In-Process Drives Never Stop:** A placed student continues through all rounds of every drive they applied to *prior* to receiving an offer. They can secure multiple offers.
3. **New Drive Visibility:** Once placed, a student can only discover and apply to new drives in a **strictly higher category** than their current highest offer:
   - Holding Regular $\rightarrow$ Can view Dream and Super Dream.
   - Holding Dream $\rightarrow$ Can view Super Dream only.
   - Holding Super Dream $\rightarrow$ Excluded from new drives (unless *Open to all* prestige override is applied).
4. **Default Placement Record:** Where a student holds multiple offers, the system selects the highest CTC offer as the official placement record for institutional statistics. Central CPC can manually override the designated record with an audit justification.

### 10.3 Plain Internships vs. Salaried Placements (CTC vs. Stipend)
- **Internship (Plain):**
  - Paid via **monthly stipend** (₹ / month), never an annual CTC.
  - Capped at **one internship per student**.
  - Operates on a parallel track; receiving an internship does not block placement drive eligibility.
- **Internship Convertible to Full-Time:**
  - Treated as a salaried placement on the CTC category ladder.
  - Consumes both the placement rung and the one-internship cap.

### 10.4 Eligibility Evaluation & Profile Snapshots
- Eligibility is evaluated dynamically at the moment of application against **verified profile data only**.
- At submission, the system generates an **application snapshot**. All subsequent round reviews, recruiter exports, and evaluations read the frozen snapshot.

### 10.5 Strict Absence Limit Policy (3-Strike Rule)
- Student attendance is mandatory for every scheduled round.
- Absences accumulate across the student's entire collegiate tenure with no resets.
- On the **3rd unexcused absence**, the system flags the student for Central CPC disbarment review.

### 10.6 Immutable Audit Logging & Data Protection
- Every mutating action (approvals, result changes, overrides, exports) writes an immutable record to the audit table.
- Student data sharing with employers is tracked via the Recruiter Data-Sharing Log.
- All stored files (marksheets, resumes, offer letters) are served via secure, time-expiring signed URLs.

---

## 11. Troubleshooting & Frequently Asked Questions (FAQ)

#### Q1: Why can't a student see any open placement drives?
- **Cause 1:** The student's SRF is not yet approved (`srf_submitted` or `registered`). Drives are only visible to `srf_approved` students.
- **Cause 2:** The student does not meet the drive's academic eligibility criteria (CGPA, 10th/12th cutoffs, or standing arrears).
- **Cause 3:** The drive is for a role category not selected on the student's profile.
- **Cause 4:** The student is already placed in an equal or higher offer category.
- **Cause 5:** The student has opted out or been disbarred.

#### Q2: What happens if an Account Executive makes a mistake on a submitted PIF?
- If the PIF has not been reviewed, the Delivery Head can reject it with an explanatory note. The AE must raise a fresh PIF.
- If the PIF is approved, the Central CPC can correct fields during the completion and publishing phase before the drive goes live.

#### Q3: Can a student edit their 10th or 12th marks after SRF approval?
- No. Verified academic fields are locked to maintain institutional integrity. Any correction requires an Administrator to unlock the specific record with an audit justification.

#### Q4: How does a student update their CGPA after 5th or 6th semester results are released?
- The student visits `/srf`, clicks **Add Semester**, enters the new semester details, and uploads the official marksheet. The new semester remains pending until verified by the Campus Placement Coordinator.

#### Q5: Can an application be withdrawn after applying?
- No. Under PRD §7.4, applications are final once submitted. This ensures recruiter interview schedules and batch planning remain stable.

#### Q6: Why does an AE not see the general placement overview dashboard?
- By design, Account Executives do not have read access to student rosters or student profiles to protect student privacy. AEs have their own dedicated overview (`/ae/overview`) focusing on their specific drives and macro aggregates.

---
*Document prepared for FACE Prep Campus PMS. For technical support or administration inquiries, contact the central administration team.*
