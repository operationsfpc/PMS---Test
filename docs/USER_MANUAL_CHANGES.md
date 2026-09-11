# FACE Prep Campus — Placement Management System (PMS)
## User Manual Updates & Release Changelog (Date-Wise)

**Document Reference:** `docs/USER_MANUAL_CHANGES.docx` & `docs/USER_MANUAL_CHANGES.md`  
**Scope:** Chronological release history of system enhancements, user manual adjustments, and bug fixes from **September 04 to September 11, 2026**.

---

### [September 11, 2026] SRF Dropdown Synchronization, Conditional Field Sanitization & Label Validation

- **Dropdown Value Replacement & State Sync:**
  When modifying any dropdown selection in the Student Registration Form (such as school board, marks scale, or degree fork), previous values are cleanly replaced. Form state stays completely synchronized with what the student sees on screen.
- **Automatic Obsolete Field Sanitization:**
  Switching away from conditional options (e.g. from State Board to CBSE, or from PG to UG) immediately wipes obsolete child fields (State Board state, Other board name, Cambridge/Other grades, completed UG degree details, and consolidated marksheets) from both the active form state and saved drafts. This eliminates hidden validation blocks caused by lingering orphan data.
- **Immediate Scale Switch Revalidation:**
  Changing the College Marks Scale between CGPA (10-point scale) and Percentage immediately re-evaluates all semester figures in real time without requiring the student to click submit.
- **Field Label Validation Highlighting (Red Labels & "Invalid" Badge):**
  Every required or invalid field now directly highlights its label in bold red (`text-danger-700 font-semibold`) with a clear, accessible "Invalid" badge. Students can immediately see which exact field is missing or contains formatting errors.
- **Real-Time Error Clearing:**
  As soon as the user corrects an invalid input or selects a valid option, the red label styling, error badge, and red border clear instantly in real time.
- **Consolidated Error Messaging:**
  Removed duplicate alert nodes and standardized error rendering across all inputs, ensuring clean DOM structure and eliminating confusing repeated messages.

---

### [September 10, 2026] Coordinator Verification Queue Enhancements & Database Arrears Sync (Migrations 0071–0074)

- **International Board Letter Grades Display:**
  In the CPC verification queue (`/cpc/verification`), the 10th and 12th marks columns now display letter grades (e.g., `Grade: A*` or `91.4% (Grade: A*)`) so coordinators can easily verify Cambridge (IGCSE/A-Levels) and Other board results without confusion.
- **Arrear History Discrepancy Resolution (2 vs 1):**
  Fixed a bug where a student who declared 2 arrears across degree semesters showed only 1 in the coordinator queue. The queue now accurately evaluates the true cumulative maximum across all declared semesters.
- **Automated Standing Arrears Synchronization:**
  The student's declared standing arrears from their latest semester are automatically synchronized into the core `students` table on form submission (via Migration 0073), ensuring recruiter drive eligibility filters always read current academic data.
- **School Marksheets Column Isolation:**
  The verification queue "School Marksheets" column is strictly isolated to educational qualification documents (10th, 12th, Diploma, Consolidated UG). Resumes and certificates are separated into their own designated columns.
- **Active Marksheet Scan Deduplication:**
  When a student re-uploads a corrected document, only the single latest active scan is displayed, preventing broken links and duplicate clutter.
- **Staff & Mentor Password Management:**
  Added secure database password reset capabilities for campus coordinators and placement mentors (Migration 0071).

---

### [September 04, 2026] Automated Email Notification System & Catalog Release

- **Automated Transactional Email Triggers:**
  Activated automated email dispatches for key placement milestones: SRF Approval Confirmation, SRF Rejection (with specific coordinator notes), New Placement Drive Announcements, Student Drive Registration Confirmation, and Shortlist Advancement Updates.
- **Official Email Notification Catalog:**
  Published comprehensive email catalog (`docs/FACE_Prep_PMS_Email_Notification_Catalog.docx`) detailing recipient rules, delivery triggers, dynamic template variables, and layout previews.
- **Resilient Dispatch Architecture:**
  Implemented decoupled email queue handling and background execution fallbacks so batch email operations never impede web interface responsiveness or core database transactions.

---

## Date-Wise Summary: September 04 to September 11, 2026

| Date | Feature / Area | Previous State (Problem) | Updated Behavior (Proper Fix) |
|---|---|---|---|
| **2026-09-11** | Dropdown Replacement | Changing dropdowns left old data or orphan fields behind. | Dropdown choices cleanly replace previous values and reset child fields. |
| **2026-09-11** | Conditional Sanitization | Old state board states / PG entries persisted in drafts. | Obsolete conditional values are automatically sanitized on live change and draft merge. |
| **2026-09-11** | Field Label Highlighting | Labels remained plain grey when inputs were empty or invalid. | Field labels highlight in bold red (`text-danger-700`) with an `Invalid` badge. |
| **2026-09-11** | Real-Time Error Clearing | Error indicators remained until full form submit. | Label highlighting and invalid badge clear instantly as user types or picks value. |
| **2026-09-11** | Scale Switch Validation | Toggling CGPA/Percentage scale did not revalidate marks. | Immediately re-evaluates all semester marks upon scale change in real time. |
| **2026-09-10** | Verification Board Grades | Cambridge/Other letter grades were invisible to CPCs. | Displays letter grades (`Grade: A*`) alongside percentage in verification queue. |
| **2026-09-10** | Arrear History Accuracy | Queue showed 1 arrear history when student entered 2. | Accurately calculates cumulative maximum arrear history across all semesters. |
| **2026-09-10** | Database Arrears Sync | Latest arrears were not synced to students table. | Database trigger automatically synchronizes standing arrears on submission. |
| **2026-09-10** | Marksheet Isolation | Queue marksheet column was cluttered with resumes and certs. | Shows strictly educational marksheets; resumes and certs in dedicated columns. |
| **2026-09-04** | Email Notification Engine | No automated email alerts sent to students or staff. | Automated transactional emails for SRF approval, rejection, and drives. |
| **2026-09-04** | Notification Catalog | No standardized documentation for email templates. | Published official email notification catalog with triggers and templates. |
