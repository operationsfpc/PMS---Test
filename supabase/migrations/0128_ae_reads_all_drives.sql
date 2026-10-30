-- 0128 — Account Executives can view all company drives.
--
-- Business requirement: Account Executives need visibility across all company drives
-- (live, in-rounds, completed, and past drives), not just the ones they personally raised,
-- while editing remains scoped to their own drafts.

-- 1. Drives: AE can view all drives
drop policy if exists drives_ae_read on drives;
create policy drives_ae_read on drives for select
  using (current_app_role() = 'account_executive');

-- 2. Applications: AE can read applications to see applicant counts
drop policy if exists applications_read_drive_owner on applications;
create policy applications_read_drive_owner on applications for select
  using (current_app_role() = 'account_executive');

-- 3. Shortlist entries: AE can read shortlist counts across drives
drop policy if exists shortlist_read_drive_owner on shortlist_entries;
create policy shortlist_read_drive_owner on shortlist_entries for select
  using (current_app_role() = 'account_executive');

-- 4. Offers: AE can read offer counts across drives
drop policy if exists offers_read_drive_owner on offers;
create policy offers_read_drive_owner on offers for select
  using (current_app_role() = 'account_executive');

-- 5. Attendance: AE can follow drive attendance
drop policy if exists attendance_ae_read on attendance;
create policy attendance_ae_read on attendance for select
  using (current_app_role() = 'account_executive');

-- 6. Round participants: AE can follow round participation
drop policy if exists rounds_ae_read on round_participants;
create policy rounds_ae_read on round_participants for select
  using (current_app_role() = 'account_executive');

-- 7. Round results: AE can follow round results
drop policy if exists results_ae_read on round_results;
create policy results_ae_read on round_results for select
  using (current_app_role() = 'account_executive');

