FACE Prep Campus
Placement Management System
Product Requirements Document — Version 2.0
Field
	|	Detail
	|	
Version
	|	2.0 (supersedes v1.0)
	|	
Date
	|	31 July 2026
	|	
Status
	|	Final for build — pending PIF sample field mapping (Section 8.2)
	|	
Scope
	|	MVP + Phase 2 roadmap
	|	
Owner
	|	Karthik, CEO — FACE Prep (Focus 4D Career Education Pvt Ltd)
	|	

Contents
TOC \h \o "1-2"

1. Objective and Scope
Build a comprehensive Placement Management System (PMS) covering the end-to-end campus placement lifecycle across all FACE Prep Campus locations: student registration and verified profile management, placement drive initiation and publishing, targeted drive announcements, applications, AI-assisted internal shortlisting, recruiter handoff, recruitment round management, attendance, results, offers, opt-out and self-placement handling, compliance reporting, dashboards, and a complete audit trail.
The system supports multiple campuses with role-based access and centralised visibility. Scope for MVP covers degree-programme students only. The recruiter is deliberately kept outside the system in MVP; all recruiter interaction happens via one-click exports.
1.1 Phasing
Phase
	|	Scope
	|	
MVP
	|	All modules in this document except items listed under Phase 2. Web application, mobile-responsive for students. Email + portal notifications.
	|	
Phase 2
	|	WhatsApp alerts to students (Business API, per-event templates). Native mobile app for students. Candidate: lightweight recruiter portal (view shortlists, upload results).
	|	
2. Terminology
Term
	|	Meaning
	|	
SRF — Student Registration Form
	|	The one-time student profile form completed at portal registration, verified by the Campus Placement Coordinator. The primary data source for matching.
	|	
PIF — Placement Initiation Form
	|	The drive-initiation form raised by the Account Executive when a drive is finalised with a company. May be partially filled at creation.
	|	
DAF — Drive Application Form
	|	The per-drive announcement created by the Central Placement Coordinator from an approved PIF and sent to filtered eligible students. Carries the JD, rounds, place of posting, compensation, eligibility, company name, and application deadline.
	|	
Placed
	|	A student for whom a final selection result has been declared for a placement or internship-convertible drive. Result declaration is treated as offer made and accepted; there is no separate acceptance step in MVP.
	|	
Self-placed
	|	A student who has recorded an off-campus offer, approved by the Campus Placement Coordinator.
	|	
Naming note: earlier drafts used “SRF” for both the student profile and the per-drive form. In this document and in the product UI, the per-drive form is always the DAF.
3. User Roles
Role
	|	Summary of access
	|	
Admin
	|	System superuser. User and role management, campus setup, configuration (offer-category reference thresholds, notification templates, export templates), field-level unlocks on locked academic data, and system settings. Full audit visibility.
	|	
Student
	|	Registers via SRF; applies to DAFs; tracks round-wise progress; views own results, offer letters, attendance, and notifications only.
	|	
Campus Placement Coordinator (CPC)
	|	Verifies and approves student SRFs and semester updates; marks/confirms attendance; approves opt-out requests and self-placed offer records; campus dashboard; compliance reporting module.
	|	
Campus Manager
	|	Same dashboard and access as the CPC for their campus, including the compliance reporting module.
	|	
Account Executive (AE)
	|	Raises the PIF when a drive is finalised. May submit with partial data. Responds to Central Placement Coordinator queries for missing details. Does not manage attendance.
	|	
Delivery Head
	|	Approves or rejects PIFs submitted by Account Executives. A rejected PIF is final and cannot be edited or resubmitted; a fresh PIF must be raised. Approved PIFs flow to the Central Placement Coordinator. Organisation-wide dashboard.
	|	
Central Placement Coordinator (Central CPC)
	|	Operational owner of drives: completes approved PIFs, classifies the drive, creates and publishes DAFs with audience filters, runs AI-assisted shortlisting, exports to recruiters, schedules rounds, uploads and corrects results, manages absences and manual disbarment, uploads offers, performs semester-data bulk imports. Multiple Central CPCs are supported with campus/region scoping to avoid a single point of failure.
	|	
Key Account Manager (KAM)
	|	Consolidated dashboard across all campuses mapped to the KAM.
	|	
Enterprise Relations (ER) Team
	|	Supplies missing company/drive information to the Central CPC on request.
	|	
ER Head
	|	View-only role (rajesh@faceprep.in). Read-only access to organisation-wide analytics dashboards. No write actions.
	|	
CEO
	|	Organisation-wide executive dashboard.
	|	
4. Student Registration (SRF)
Every student completes a detailed SRF at portal registration. The SRF is the primary matching source and must capture information in depth.
4.1 SRF contents
Academic: 10th marks, 12th marks, graduation degree, PG degree (where applicable), branch/specialisation, semester-wise CGPA or marks, overall CGPA, current arrears, history of arrears.
Marksheet uploads: 10th, 12th, and each available UG/PG semester marksheet must be uploaded alongside the entered marks. Entered values are verified against marksheets during approval.
Personal: email ID, mobile number, WhatsApp number, alternate contact number.
Placement preferences (checkboxes): Technical, Sales, Digital Marketing, General Business, and other role categories.
Resumes: one PDF resume per selected role category (e.g. Technical Resume, Sales Resume).
Professional profiles: LinkedIn, GitHub, LeetCode, HackerRank.
Additional: projects, certifications, areas of interest, areas of expertise (captured in detail), technical skills, achievements.
Consent: explicit consent for sharing profile data and resumes with recruiting companies, captured at submission. All students are 18 or older.
4.2 Approval workflow
Student submits the SRF with marksheets.
The CPC verifies entered marks against uploaded marksheets and approves or rejects with reason.
Only approved students become active and can receive DAFs, apply, and participate in drives.
4.3 Semester updates
At the end of each semester the student adds the new semester via an Add Semester action: CGPA or marks, current arrears, updated history of arrears, plus the semester marksheet upload. The update is held in a pending state until the CPC verifies it against the marksheet, after which it is locked. Unverified semester data is never used for eligibility.
Alternative path: the Central CPC can bulk-import verified semester data (CGPA, arrears) for a campus or cohort; imported data is locked on import. Bulk import overrides any pending student-entered values for the same semester.
4.4 Editable vs locked fields
Locked (Admin unlock only)
	|	Editable by student without approval
	|	Editable with CPC verification
	|	
10th marks, 12th marks, degree/branch, all verified semester CGPA and arrears data
	|	Areas of interest, areas of expertise, certifications, projects, skills, achievements, resumes, professional profile links
	|	New semester CGPA/marks, current arrears, history of arrears (via Add Semester + marksheet)
	|	
5. Central Student Skill Repository
The Central CPC maintains an institutional skill profile per student: aptitude scores, technical assessment scores, coding scores, Excel skills, communication scores, domain assessments, and other institutional evaluations. These feed AI-assisted shortlisting. Scores enter via bulk upload (Excel template) in MVP; an API sync from assessment platforms (including H.E.R.O.S.) is a Phase 2 candidate.
6. Placement Drive Lifecycle
6.1 Flow
Step 1 — PIF creation: the Account Executive raises a PIF when a drive is finalised. Partial data is permitted at this stage.
Step 2 — Delivery Head approval: the Delivery Head approves or rejects the PIF. Rejection is final: the PIF cannot be edited or resubmitted; the AE must raise a fresh PIF. Rejected PIFs remain in the repository as closed records with the rejection reason logged.
Step 3 — Completion: approved PIFs flow to the Central CPC, who fills vacant fields by querying the AE or the ER Team, or by entering details directly.
Step 4 — Classification: while opening the drive, the Central CPC classifies it (Section 10) and selects the drive type (Section 11).
Step 5 — DAF creation and publishing: the Central CPC creates the DAF from the completed PIF and publishes it to the filtered audience with an application window. Only complete drives can go live.
6.2 Mandatory fields before going live
Company name, job role, job description, location / place of posting, compensation (CTC), role/drive type, eligibility criteria, hiring process (rounds), recruitment timeline, application start and end dates.
6.3 Edits after going live
If job details change after publishing, the change does not trigger a fresh eligibility check for existing applicants. Whether an email notification about the change is sent to recipients is at the Central CPC’s discretion, decided per change.
7. Audience Targeting, Application Window, and Applications
7.1 Audience filters
Before publishing, the Central CPC selects the target audience using any combination of: city, campus, degree, department, branch, 10th marks, 12th marks, graduation CGPA, arrears, area of interest, and any future eligibility parameter. Only targeted, eligible students can view and apply.
7.2 Eligibility evaluation
Eligibility is evaluated at the moment the student applies, against verified profile data only. Profile changes after application do not affect a submitted application.
7.3 Profile snapshot
On application, the system snapshots the student’s full profile and the role-relevant resume. All downstream steps — shortlisting, recruiter export, round management — use the snapshot, never the live profile.
7.4 Application window and withdrawal
Applications are accepted only within the configured window. No withdrawal is permitted once a student has applied.
7.5 Placed-student visibility rule
A placed student (Section 12) is shown newly announced drives only in categories higher than their current highest offer category. Drives the student had already applied to before being placed are unaffected: the student continues to participate in all further rounds of those drives.
8. Placement Initiation Form (PIF)
8.1 Behaviour
Raised by the AE; partial submission allowed.
Routed to the Delivery Head for approval; approval routes it to the Central CPC, rejection closes it permanently.
The Central CPC completes vacant fields before drive publishing.
8.2 Field structure — placeholder pending sample
The agreed PIF sample document has not yet been shared. The field set below is a working placeholder and will be replaced 1:1 with the fields of the actual PIF sample once received. No build should hard-code this list until the sample is mapped.
Placeholder fields: company name, industry, SPOC name and contact, drive type (placement / internship / internship convertible to full-time), job role(s), job description, place(s) of posting, CTC and compensation structure, bond/service agreement details, eligibility criteria (marks, arrears, branches), number of openings, hiring process and rounds, tentative timeline, campus(es) in scope, mode (on-campus / virtual / pooled), special instructions.
9. Notifications
MVP channels are email and portal notifications. WhatsApp alerts are Phase 2. Students receive notifications for: new DAF received (with company name, job role, deadline, key instructions), application deadline reminders, upcoming round details, round results, attendance marked absent, attendance updated/overridden, result corrections, final selection, offer letter available, disbarment warning, and disbarment decision. The notification system must handle bursts (e.g. results announced to hundreds of students simultaneously) via queued delivery.
10. Offer Categories and Drive Classification
Every placement and internship-convertible drive is classified by the Central CPC at the time of opening the drive. The CTC bands below are reference guidance for the Central CPC; the classification decision is his and is recorded on the drive. Bands are Admin-configurable.
Category
	|	Reference CTC band
	|	
Regular
	|	Up to ₹5 Lakhs
	|	
Dream
	|	Above ₹5 Lakhs and up to ₹10 Lakhs
	|	
Super Dream
	|	Above ₹10 Lakhs
	|	
11. Drive Types: Placement and Internships
Drive type
	|	Category classification
	|	Effect on eligibility
	|	Cap
	|	
Placement
	|	Regular / Dream / Super Dream
	|	Selection makes the student placed at that category; only higher-category new drives are shown thereafter.
	|	Multiple offers possible via in-process drives (Section 12).
	|	
Internship convertible to full-time
	|	Regular / Dream / Super Dream
	|	Treated exactly like a placement on the category ladder. Selection also consumes the internship cap.
	|	Counts toward both the placement record set and the one-internship cap.
	|	
Internship (plain)
	|	None
	|	Parallel track. Holding an internship blocks further internship drives only; placement-drive eligibility is untouched.
	|	Maximum one internship per student.
	|	
12. Placement, Multiple Offers, and the Placement Record
Result = placed: the moment a final selection result is declared for a student, the student is treated as placed. Result declaration is interpreted as offer made and accepted; there is no separate accept/decline step in MVP.
In-process drives continue: a placed student continues through all remaining rounds of every drive they had already applied to, regardless of category. Consequently a student may accumulate multiple placements.
New drives: after placement, only drives in categories above the student’s highest current offer category are visible for fresh application (Regular → Dream/Super Dream; Dream → Super Dream; Super Dream → none).
Placement record for statistics: where a student holds multiple offers, the highest-CTC offer is the student’s placement record by default; other selections are shown as additional offers. The Central CPC can manually override which offer is the record, with the override audit-logged.
Final documents: the Central CPC uploads the final selection list, result documents, and offer letters against the drive. Each student can securely view and download only their own documents. A student’s final offer is recorded against the company on the drive record.
13. Internal Shortlisting and Recruiter Export
13.1 Shortlisting
After the application window closes, the Central CPC either forwards all applicants or performs internal shortlisting (Select All is available). LLM/AI assistance ranks candidates using the application snapshot: resume, academic profile, skill repository scores, projects, certifications, role preferences, coding profiles, and institutional assessments. The Central CPC decides the number of students to present to the recruiter; the final decision always rests with the Central CPC. Shortlisting is a fully internal process: internal shortlist status is never visible to students.
For every AI-assisted shortlist, the system logs the AI recommendation (ranking and per-candidate reasoning) alongside the final human decision, so recommendation quality can be reviewed and tuned over time. AI rationale is internal-only.
13.2 Recruiter export
One-click export produces an Excel of shortlisted students with configurable columns (per-recruiter templates can be saved) plus a folder of shortlisted resumes using a consistent file-naming convention (e.g. Campus_RollNo_Name_Role.pdf). Every export is audit-logged with the exporting user, drive, timestamp, and field set (recruiter data-sharing log).
14. Recruitment Round Management
Drives support unlimited configurable rounds (internal shortlisting, online test, technical test, group discussion, technical interview, HR interview, managerial interview, final interview, and any custom round).
14.1 Scheduling
Per round the Central CPC configures: round name, date, time, venue, online link (if applicable), and instructions. Eligible students receive portal and email alerts and see upcoming rounds on their dashboard.
14.2 Results
The Central CPC uploads round results with statuses: Selected, Rejected, Waitlisted, On Hold. Selected students receive next-round details; all students are notified and can always view their current stage per company applied.
14.3 Corrections
Companies may revise results. The Central CPC can overturn any round result; every correction updates dashboards, notifies affected students, and writes a full audit entry (previous value, new value, reason).
15. Attendance and Absence Management
15.1 Attendance
Attendance is marked for every recruitment round of every drive, only by the CPC or the Central CPC — never the AE. Status values: Present, Absent. For large drives, students can self check-in via a round-specific QR code; QR check-ins are provisional until confirmed by the CPC or Central CPC. If an absent student receives another opportunity, the CPC or Central CPC can override the attendance record; every override is audit-logged.
15.2 Absence policy
Each absence triggers an email and portal notification warning that repeated absences may lead to disbarment.
Absences accumulate across all drives for the student’s entire tenure: the limit is three in total, with no reset and no excused category.
On the third absence the system alerts the Central CPC. Disbarment is never automatic: the Central CPC reviews the history and decides.
A disbarred student is notified and blocked from applying to future drives. The decision and reason are audit-logged.
16. Opt-Out and Self-Placed Offers
16.1 Opt-out
A student may opt out of the placement process entirely (e.g. higher studies, entrepreneurship) by submitting an opt-out request with a stated reason. The CPC approves or rejects. Opt-out is student-initiated only — it is never applied because of CGPA or any system rule — and it is irreversible: an opted-out student cannot rejoin the placement process. Opted-out students are excluded from all drive targeting and from the placement-percentage denominator, and reported as a separate line.
16.2 Self-placed offers
A student can record an off-campus offer (company, role, CTC, offer letter upload). The CPC verifies and approves the record. Approved self-placed offers count in statistics as a distinct “self-placed” line and do not affect the student’s on-campus drive eligibility or category ladder.
17. Dashboards
17.1 Student
Urgent notifications, new eligible DAFs, drives awaiting application with deadlines, upcoming rounds, live applications with round-wise status per company, rejected and selected applications, offer letters, final results, attendance alerts, and a personal placement summary.
17.2 CPC and Campus Manager
All students mapped to the campus: SRF and semester-verification queues, opt-out and self-placed approval queues, student profiles, applications, drive participation, attendance marking and confirmation, round results, offer letters, campus placement statistics, and the compliance reporting module (Section 18). The Campus Manager has identical access for their campus.
17.3 Key Account Manager
Consolidated across mapped campuses: registration status, drive participation, applications, offers, campus-wise performance, and placement analytics.
17.4 Central CPC
Operational cockpit: PIF completion queue, drive classification and publishing status, applicant statistics, AI shortlisting workspace, recruiter export, round scheduling, result and correction uploads, attendance oversight, absence monitor and manual disbarment queue, offer uploads, semester bulk import, and institution-wide analytics — scoped by assigned campuses/regions where multiple Central CPCs exist.
17.5 Delivery Head
PIF approval queue with approve/reject (reason mandatory on reject), plus organisation-wide operational analytics.
17.6 Executive (CEO) and ER Head
Organisation-wide analytics: campus-wise placements, company-wise hiring, student pipeline, applications, shortlisting rates, attendance metrics, selection rates, offer distribution across Regular/Dream/Super Dream, self-placed and opted-out lines, and performance trends. The ER Head’s access is strictly read-only.
17.7 Admin
User/role management, campus configuration, category band and template configuration, locked-field unlock requests, and full audit-trail access.
18. Compliance Reporting Module
Available to the CPC and Campus Manager. One-click generation of placement reports in the formats required by NIRF, NAAC, NBA, and AICTE for a chosen academic year and campus, computed from system data with explicit denominators (registered, opted-in, eligible) and clear treatment of self-placed and opted-out students. Reports export to Excel and PDF. Report definitions are maintainable by Admin as formats evolve.
19. Audit Trail
Every critical action is recorded: SRF approvals and semester verifications, PIF creation/approval/rejection, drive completion and publishing, drive-detail edits after go-live, DAF targeting, shortlisting decisions and AI recommendations, recruiter exports (data-sharing log), round scheduling, result uploads and corrections, attendance changes and overrides, offer uploads, placement-record overrides, opt-out approvals, self-placed approvals, disbarment decisions, and Admin unlocks. Each entry captures user, timestamp, previous value, updated value, and reason where applicable.
20. AI Features
AI-assisted capabilities, all internal-only and always subject to human decision: student-to-job matching, resume evaluation, internal shortlisting recommendations with per-candidate reasoning, candidate ranking, skill-gap analysis, eligibility validation, and intelligent search and filtering across student profiles. Recommendation-versus-decision logging per Section 13.1.
21. Non-Functional Requirements
21.1 Scale targets
Horizon
	|	Campuses
	|	Students
	|	
Launch (MVP)
	|	10
	|	600
	|	
12 months
	|	15
	|	1,500
	|	
24 months
	|	25
	|	2,000
	|	

21.2 Requirements
Mobile-responsive web for students: students will primarily use phones; every student-facing screen must work well at mobile widths. Native app is Phase 2.
Notification bursts: queued email delivery capable of a full-cohort announcement (2,000+ recipients) without loss; per-student delivery status visible to the Central CPC.
Concurrency: support at least 15 concurrent live drives and simultaneous round-result uploads across campuses.
Security: role-based access control exactly as scoped per role; students can only ever see their own data; documents (marksheets, resumes, offer letters) served via authorised, expiring links; passwords and sessions per current best practice.
Data protection: consent captured at SRF; recruiter data-sharing log maintained (Section 13.2); data retention and deletion policy configurable by Admin. Full DPDP programme deferred post-MVP as agreed, but these three foundations ship in MVP.
Bulk operations: Excel-template bulk import with validation and error reporting for semester data and skill-repository scores; row-level failure reporting.
Auditability and backups: immutable audit log; daily backups with tested restore.
22. Consolidated Key Business Rules
A student must have a CPC-approved SRF before receiving any DAF.
PIF approval authority is the Delivery Head; a rejected PIF is closed permanently and requires a fresh PIF.
Only complete drives, classified by the Central CPC, can go live.
DAFs are visible only to targeted, eligible students; area of interest is a valid targeting filter.
Eligibility is evaluated at application time against verified data; the application snapshots the profile and resume.
Applications are accepted only within the window; no withdrawal after applying.
Students cannot edit verified academic data; semester updates require CPC verification against marksheets, or Central CPC bulk import.
Internal shortlist status and AI rationale are never visible to students.
Result declaration = placed. Placed students see only higher-category new drives but continue all in-process drives; multiple offers are possible; highest CTC is the default placement record with Central CPC override.
Internship-convertible drives sit on the category ladder and consume the one-internship cap; plain internships are a parallel track, capped at one, with no effect on placement eligibility.
Attendance is managed only by the CPC and Central CPC; overrides are audit-logged; QR check-ins are provisional until confirmed.
Three cumulative absences (no reset, no exceptions) trigger a Central CPC review alert; disbarment is always a manual decision.
Opt-out is student-initiated, CPC-approved, and irreversible; self-placed offers are CPC-approved and reported as a separate statistic.
Students can access only their own results, documents, and offer letters.
Every important event generates email and portal notifications (WhatsApp in Phase 2).
Every critical action is audit-logged with user, timestamp, before/after values, and reason.
23. Open Items
PIF sample document to be shared; Section 8.2 placeholder fields to be replaced with the exact field structure before the drive-creation module is built.
Phase 2 detailing (WhatsApp templates, mobile app scope, recruiter portal) to be specified after MVP launch.
