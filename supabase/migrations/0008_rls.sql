-- Row Level Security. PRD 21.2: "students can only ever see their own data".
-- Every helper is SECURITY DEFINER + STABLE so policies stay cheap.

create or replace function current_app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function current_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from students where auth_user_id = auth.uid()
$$;

create or replace function my_campus_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select campus_id from staff_campus_assignments where profile_id = auth.uid()
$$;

-- Roles with organisation-wide read access.
create or replace function is_org_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select current_app_role() in (
    'admin', 'central_placement_coordinator', 'delivery_head', 'ceo', 'er_head'
  )
$$;

-- Roles that may write operational data.
create or replace function is_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select current_app_role() in ('admin', 'central_placement_coordinator')
$$;

create or replace function is_campus_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select current_app_role() in ('campus_placement_coordinator', 'campus_manager')
$$;

-- FORCE so that even table owners are subject to policy in tests.
alter table students                enable row level security;
alter table students                force  row level security;
alter table applications            enable row level security;
alter table applications            force  row level security;
alter table offers                  enable row level security;
alter table offers                  force  row level security;
alter table notifications           enable row level security;
alter table notifications           force  row level security;
alter table student_documents       enable row level security;
alter table student_documents       force  row level security;
alter table student_semesters       enable row level security;
alter table student_semesters       force  row level security;
alter table shortlist_entries       enable row level security;
alter table shortlist_entries       force  row level security;
alter table audit_log               enable row level security;
alter table audit_log               force  row level security;
alter table drives                  enable row level security;
alter table drives                  force  row level security;

-- ---------------------------------------------------------------- students
create policy students_read_self on students for select
  using (auth_user_id = auth.uid());

create policy students_read_campus_staff on students for select
  using (is_campus_staff() and campus_id in (select my_campus_ids()));

create policy students_read_org on students for select
  using (is_org_reader());

-- Students may edit only free-form profile content; verified academic data is
-- protected by a column trigger, not by RLS (decision Q4).
create policy students_update_self on students for update
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

create policy students_write_staff on students for all
  using (is_operator() or (is_campus_staff() and campus_id in (select my_campus_ids())))
  with check (is_operator() or (is_campus_staff() and campus_id in (select my_campus_ids())));

-- ------------------------------------------------------------ applications
create policy applications_read_self on applications for select
  using (student_id = current_student_id());

create policy applications_read_staff on applications for select
  using (is_org_reader() or is_campus_staff());

create policy applications_insert_self on applications for insert
  with check (student_id = current_student_id());

-- ------------------------------------------------------------------ offers
create policy offers_read_self on offers for select
  using (student_id = current_student_id());

create policy offers_read_staff on offers for select
  using (is_org_reader() or is_campus_staff());

create policy offers_write_staff on offers for all
  using (is_operator() or is_campus_staff())
  with check (is_operator() or is_campus_staff());

-- --------------------------------------------------------------- documents
create policy documents_read_self on student_documents for select
  using (student_id = current_student_id());

create policy documents_read_staff on student_documents for select
  using (is_org_reader() or is_campus_staff());

create policy documents_write_self on student_documents for all
  using (student_id = current_student_id())
  with check (student_id = current_student_id());

-- --------------------------------------------------------------- semesters
create policy semesters_read_self on student_semesters for select
  using (student_id = current_student_id());

create policy semesters_rw_staff on student_semesters for all
  using (is_org_reader() or is_campus_staff())
  with check (is_operator() or is_campus_staff());

create policy semesters_insert_self on student_semesters for insert
  with check (student_id = current_student_id() and status = 'pending');

-- ------------------------------------------------------------ notifications
create policy notifications_read_self on notifications for select
  using (student_id = current_student_id());

create policy notifications_update_self on notifications for update
  using (student_id = current_student_id()) with check (student_id = current_student_id());

-- PRD 13.1: shortlist status and AI rationale are NEVER visible to students.
create policy shortlist_staff_only on shortlist_entries for all
  using (is_org_reader()) with check (is_operator());

-- PRD 17.7: full audit visibility is an Admin privilege.
create policy audit_admin_read on audit_log for select
  using (current_app_role() = 'admin');

-- ------------------------------------------------------------------ drives
-- Students never read the drives table directly; they read a filtered view.
create policy drives_staff_read on drives for select using (is_org_reader());
create policy drives_ae_read on drives for select
  using (current_app_role() = 'account_executive' and created_by = auth.uid());
create policy drives_ae_write on drives for all
  using (current_app_role() = 'account_executive' and created_by = auth.uid() and status = 'draft')
  with check (current_app_role() = 'account_executive' and created_by = auth.uid());
create policy drives_operator_write on drives for all
  using (is_operator()) with check (is_operator());
create policy drives_dh_write on drives for all
  using (current_app_role() = 'delivery_head') with check (current_app_role() = 'delivery_head');

grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
