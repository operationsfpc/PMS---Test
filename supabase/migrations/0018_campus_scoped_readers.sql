-- Campus scoping, finished.
--
-- Confirmed 2026-08-05: a KEY ACCOUNT MANAGER LOOKS AFTER A FEW CAMPUSES, and
-- campuses are mapped to them. Two parts of the system already believed this -
-- `requiresCampusAssignment()` collects campuses for a KAM at invitation time
-- and `staff_campus_assignments` stores them - but no policy ever read them.
-- A KAM matched neither is_campus_staff() nor is_org_reader(), so they could
-- read no student at all and their dashboard was all zeroes.
--
-- Fixing that exposed the larger hole. `students` was campus-filtered, but
-- `applications`, `offers`, `student_documents` and `student_semesters` were
-- not: any campus role could read every row in all four. `applications` in
-- particular carries `profile_snapshot`, a frozen copy of the student's ENTIRE
-- profile, so campus-scoping the student row while leaving the application
-- open scoped nothing. Every one of them is scoped here.
--
-- Reading and writing are separated at the same time. A KAM manages a client
-- relationship; they do not verify marksheets or mark attendance. So:
--
--   is_campus_reader() - CPC, Campus Manager, KAM   (select, campus-scoped)
--   is_campus_staff()  - CPC, Campus Manager        (write, campus-scoped)
--
-- ⚠️ ASSUMPTION - UNCONFIRMED (A29): `enterprise_relations` is treated as an
-- organisation-wide READER, mirroring `er_head`, which already is one. ER is a
-- company-facing role, not a campus-facing one, so campus assignment would not
-- describe their work. Reversible: remove them from is_org_reader().

-- Roles limited to the campuses mapped to them. Read-only members are welcome
-- here; the write policies below use is_campus_staff(), not this.
create or replace function is_campus_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select current_app_role() in (
    'campus_placement_coordinator', 'campus_manager', 'key_account_manager'
  )
$$;

create or replace function is_org_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select current_app_role() in (
    'admin', 'central_placement_coordinator', 'delivery_head', 'ceo',
    'er_head', 'enterprise_relations'
  )
$$;

-- The students on the campuses mapped to me. Defined once so that every
-- policy below scopes by exactly the same rule.
create or replace function my_student_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.id from students s
   where s.campus_id in (select campus_id
                           from staff_campus_assignments
                          where profile_id = auth.uid())
$$;

-- ---------------------------------------------------------------- students
drop policy if exists students_read_campus_staff on students;
create policy students_read_campus_staff on students for select
  using (is_campus_reader() and campus_id in (select my_campus_ids()));

-- ------------------------------------------------------------ applications
drop policy if exists applications_read_staff on applications;
create policy applications_read_staff on applications for select
  using (is_org_reader() or (is_campus_reader() and student_id in (select my_student_ids())));

-- The AE who raised a drive follows it to the end: PRD asks that they see the
-- applicants and the progress of the drives they raised. Scoped to THAT drive
-- and nothing else, and select-only - an AE never edits an application.
create policy applications_read_drive_owner on applications for select
  using (
    current_app_role() = 'account_executive'
    and drive_id in (select id from drives where created_by = auth.uid())
  );

-- ------------------------------------------------------------------ offers
drop policy if exists offers_read_staff on offers;
create policy offers_read_staff on offers for select
  using (is_org_reader() or (is_campus_reader() and student_id in (select my_student_ids())));

drop policy if exists offers_write_staff on offers;
create policy offers_write_staff on offers for all
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));

-- --------------------------------------------------------------- documents
drop policy if exists documents_read_staff on student_documents;
create policy documents_read_staff on student_documents for select
  using (is_org_reader() or (is_campus_reader() and student_id in (select my_student_ids())));

-- --------------------------------------------------------------- semesters
-- Was one `for all` policy, which made every reader a writer. Split, so that a
-- KAM may read a verified semester and only a coordinator may verify one.
drop policy if exists semesters_rw_staff on student_semesters;
create policy semesters_read_staff on student_semesters for select
  using (is_org_reader() or (is_campus_reader() and student_id in (select my_student_ids())));

create policy semesters_write_staff on student_semesters for all
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));

-- ---------------------------------------------------- self-placement (0014)
drop policy if exists student_reads_own_self_placement on self_placement_requests;
create policy student_reads_own_self_placement on self_placement_requests for select
  using (
    student_id = current_student_id()
    or is_org_reader()
    or (is_campus_reader() and student_id in (select my_student_ids()))
  );

drop policy if exists staff_decides_self_placement on self_placement_requests;
create policy staff_decides_self_placement on self_placement_requests for all
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));
