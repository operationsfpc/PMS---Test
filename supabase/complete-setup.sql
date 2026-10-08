-- =============================================================================
-- FACE Prep Campus — Placement Management System (PMS)
-- Complete Database Schema (Consolidated Migrations 0001 - 0080)
-- Generated automatically by scripts/setup-database.ts
-- =============================================================================

-- =============================================================================
-- Migration: 0001_enums.sql
-- =============================================================================

-- Domain vocabularies. These mirror src/domain/types.ts one-for-one.
-- src/domain/types.test.ts pins the TypeScript side; changing either without
-- the other is a breaking change requiring a migration.

create type role_category as enum (
  'software_technical', 'technical_support_it_ops', 'digital_marketing',
  'sales', 'operations_business'
);

create type drive_type as enum ('placement', 'internship_convertible', 'internship');

-- 'off_campus' is deliberately absent: it means SELF-PLACED (PRD 16.2).
create type drive_mode as enum ('on_campus', 'physical_outside_campus', 'virtual', 'pooled');

create type arrear_policy as enum ('no_standing', 'no_history', 'flexible');

-- 'internship' is placed BEFORE 'regular' so that enum ordering treats it as
-- the lowest value — safe-fail insurance if anyone accidentally does MAX/ORDER BY.
-- It is not on the R3/R5 ladder; offerCategoryRank() in src/domain/offer-category.ts throws for it.
create type offer_category as enum ('internship', 'regular', 'dream', 'super_dream');

create type srf_status as enum (
  'invited', 'registered', 'srf_submitted', 'srf_approved', 'srf_rejected'
);

create type participation_status as enum ('active', 'opted_out', 'disbarred');

create type drive_status as enum (
  'draft', 'submitted', 'approved', 'live',
  'applications_closed', 'in_rounds', 'completed', 'rejected'
);

create type round_result as enum ('selected', 'rejected', 'waitlisted', 'on_hold');

create type attendance_status as enum ('scheduled', 'present', 'absent', 'provisional');

create type offer_source as enum ('on_campus', 'self_placed');

create type verification_status as enum ('pending', 'verified', 'rejected');

create type app_role as enum (
  'admin', 'student', 'campus_placement_coordinator', 'campus_manager',
  'account_executive', 'delivery_head', 'central_placement_coordinator',
  'key_account_manager', 'enterprise_relations', 'er_head', 'ceo'
);

-- =============================================================================
-- Migration: 0002_identity.sql
-- =============================================================================

-- Identity, org hierarchy, and the login allowlist.
-- Hierarchy is City -> Campus -> Degree -> Branch. There is no department level.

create table campuses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  city        text not null,
  created_at  timestamptz not null default now()
);

create table degrees (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique
);

create table branches (
  id         uuid primary key default gen_random_uuid(),
  degree_id  uuid not null references degrees(id) on delete cascade,
  name       text not null,
  unique (degree_id, name)
);

-- One campus offers many degrees; one degree runs at many campuses.
create table campus_degrees (
  campus_id  uuid not null references campuses(id) on delete cascade,
  degree_id  uuid not null references degrees(id) on delete cascade,
  primary key (campus_id, degree_id)
);

-- Staff accounts. Students do NOT get a row here; see public.students.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text not null,
  role        app_role not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Staff are invited by an Admin. The invitation is the allowlist entry that
-- lets them sign in; the profile row is created automatically on first login.
-- This also solves bootstrap: migration 0002 seeds the founding Admin invite.
create table staff_invitations (
  email       text primary key,
  full_name   text not null,
  role        app_role not null,
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  constraint staff_are_not_students check (role <> 'student')
);

-- Scopes CPCs, Campus Managers and KAMs to their campuses.
create table staff_campus_assignments (
  profile_id  uuid not null references profiles(id) on delete cascade,
  campus_id   uuid not null references campuses(id) on delete cascade,
  primary key (profile_id, campus_id)
);

create table settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Founding Admin.
insert into staff_invitations (email, full_name, role)
values ('karthikraja@faceprep.in', 'Karthik Raja', 'admin');

insert into settings (key, value) values
  ('offer_category_bands', '{"regularMaxLpa": 5, "dreamMaxLpa": 10}'),
  ('absence_limit',        '3'),
  ('max_upload_bytes',     '5242880');

-- =============================================================================
-- Migration: 0003_students.sql
-- =============================================================================

-- Students. Pre-loaded from the college roster, then claimed via invite.

create table students (
  id                  uuid primary key default gen_random_uuid(),
  -- Bound when the student claims their record by signing in with the
  -- rostered email. Null until claimed.
  auth_user_id        uuid unique references auth.users(id) on delete set null,

  campus_id           uuid not null references campuses(id),
  degree_id           uuid not null references degrees(id),
  branch_id           uuid references branches(id),

  roll_number         text not null,
  full_name           text not null,
  -- The rostered address. Login is restricted to exactly this address.
  email               text not null unique,
  passing_year        integer not null check (passing_year between 2000 and 2100),

  mobile              text,
  whatsapp            text,
  alternate_contact   text,

  srf_status            srf_status not null default 'invited',
  participation_status  participation_status not null default 'active',

  -- Verified academic data. Eligibility is evaluated against these ONLY.
  tenth_percentage    numeric(5,2) check (tenth_percentage between 0 and 100),
  twelfth_percentage  numeric(5,2) check (twelfth_percentage between 0 and 100),
  overall_cgpa        numeric(4,2) check (overall_cgpa between 0 and 10),
  current_arrears     integer not null default 0 check (current_arrears >= 0),
  history_of_arrears  integer not null default 0 check (history_of_arrears >= 0),

  technical_skills    text,
  areas_of_interest   text,
  areas_of_expertise  text,
  projects            text,
  certifications      text,
  achievements        text,
  linkedin_url        text,
  github_url          text,
  leetcode_url        text,
  hackerrank_url      text,

  consent_given_at    timestamptz,
  srf_submitted_at    timestamptz,
  srf_decided_at      timestamptz,
  srf_decided_by      uuid references profiles(id),
  srf_rejection_reason text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (campus_id, roll_number),

  -- A standing arrear is by definition part of the history (domain R-srf).
  constraint arrears_consistent check (history_of_arrears >= current_arrears),
  -- An approved SRF must have consent on record (PRD 4.1).
  constraint approved_requires_consent
    check (srf_status <> 'srf_approved' or consent_given_at is not null)
);

create index students_campus_idx on students (campus_id);
create index students_status_idx on students (srf_status, participation_status);

create table student_role_preferences (
  student_id  uuid not null references students(id) on delete cascade,
  category    role_category not null,
  primary key (student_id, category)
);

create type document_kind as enum (
  'tenth_marksheet', 'twelfth_marksheet', 'semester_marksheet', 'resume', 'offer_letter'
);

create table student_documents (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id) on delete cascade,
  kind           document_kind not null,
  -- Set only for resumes: one resume per selected role category (PRD 4.1).
  role_category  role_category,
  storage_path   text not null unique,
  size_bytes     integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  uploaded_at    timestamptz not null default now(),

  constraint resume_has_category
    check ((kind = 'resume') = (role_category is not null))
);

create unique index one_resume_per_category
  on student_documents (student_id, role_category)
  where kind = 'resume';

-- Semester-wise academic record. Student entries are pending until a
-- coordinator verifies them against the marksheet (PRD 4.3).
create table student_semesters (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references students(id) on delete cascade,
  semester_number     integer not null check (semester_number between 1 and 12),
  cgpa                numeric(4,2) not null check (cgpa between 0 and 10),
  current_arrears     integer not null default 0 check (current_arrears >= 0),
  history_of_arrears  integer not null default 0 check (history_of_arrears >= 0),
  marksheet_id        uuid references student_documents(id),
  status              verification_status not null default 'pending',
  verified_by         uuid references profiles(id),
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),

  unique (student_id, semester_number),
  constraint verified_has_verifier
    check (status <> 'verified' or verified_by is not null)
);

-- Central Student Skill Repository (PRD 5). Metric list is open by design:
-- the exact score schema is still pending from the business.
create table skill_scores (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  metric       text not null,
  score        numeric(6,2) not null,
  max_score    numeric(6,2) not null default 100 check (max_score > 0),
  source       text not null default 'bulk_upload',
  recorded_at  timestamptz not null default now(),
  unique (student_id, metric, recorded_at)
);

-- =============================================================================
-- Migration: 0004_drives.sql
-- =============================================================================

-- Drives. The PIF and the DAF are ONE record moving through three owners:
-- AE drafts -> Delivery Head approves & classifies -> Central CPC completes & publishes.

create table drives (
  id                 uuid primary key default gen_random_uuid(),

  -- PIF Section 1: company
  company_name       text not null,
  industry           text,
  company_website    text,
  spoc_name          text,
  spoc_designation   text,
  spoc_email         text,
  spoc_phone         text,

  -- PIF Section 2: role
  role_title         text,
  role_category      role_category,
  job_description    text,
  openings           integer check (openings > 0),
  work_locations     text,
  ctc_min_lpa        numeric(6,2) check (ctc_min_lpa > 0),
  ctc_max_lpa        numeric(6,2) check (ctc_max_lpa > 0),
  ctc_breakup        text,
  shift_type         text,
  bond_details       text,

  -- PIF Section 3: eligibility
  min_overall_cgpa      numeric(4,2) check (min_overall_cgpa between 0 and 10),
  min_tenth_percentage  numeric(5,2) check (min_tenth_percentage between 0 and 100),
  min_twelfth_percentage numeric(5,2) check (min_twelfth_percentage between 0 and 100),
  arrears_policy        arrear_policy not null default 'flexible',
  eligible_passing_years integer[] not null default '{}',
  mandatory_skills      text,

  -- PIF Section 4: process
  drive_mode         drive_mode,
  tentative_date     date,
  timeline_notes     text,

  -- Classification. offer_category is the Delivery Head's and is FINAL.
  -- drive_type may be set by the AE and edited by the Central CPC.
  drive_type         drive_type,
  offer_category     offer_category,

  -- Lifecycle
  status             drive_status not null default 'draft',
  on_hold            boolean not null default false,
  on_hold_reason     text,

  -- R5a: the Central CPC's prestige-drive escape hatch.
  open_to_all_override boolean not null default false,
  open_to_all_reason   text,

  application_start  timestamptz,
  application_end    timestamptz,

  created_by         uuid references profiles(id),
  approved_by        uuid references profiles(id),
  approved_at        timestamptz,
  rejection_reason   text,
  published_by       uuid references profiles(id),
  published_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint ctc_range_ascends
    check (ctc_max_lpa is null or ctc_min_lpa is null or ctc_max_lpa >= ctc_min_lpa),
  constraint window_ascends
    check (application_end is null or application_start is null
           or application_end > application_start),
  constraint on_hold_needs_reason
    check (not on_hold or on_hold_reason is not null),
  -- R5a must always be justified, because it bypasses the ladder and the cap.
  constraint override_needs_reason
    check (not open_to_all_override or open_to_all_reason is not null),
  constraint rejection_needs_reason
    check (status <> 'rejected' or rejection_reason is not null),
  -- Plain internships are not on the category ladder (PRD 11).
  constraint internship_has_no_category
    check (drive_type is distinct from 'internship' or offer_category is null),

  -- PRD 6.2: everything a drive needs before it may go live, plus the
  -- invariant that an on-hold drive can never be published.
  constraint live_requires_complete_record check (
    status in ('draft', 'submitted', 'approved', 'rejected')
    or (
      not on_hold
      and role_title is not null and job_description is not null
      and work_locations is not null and ctc_min_lpa is not null
      and role_category is not null and drive_type is not null
      and (drive_type = 'internship' or offer_category is not null)
      and application_start is not null and application_end is not null
    )
  )
);

create index drives_status_idx on drives (status);

create table drive_eligible_degrees (
  drive_id  uuid not null references drives(id) on delete cascade,
  degree_id uuid not null references degrees(id) on delete cascade,
  primary key (drive_id, degree_id)
);

create table drive_eligible_branches (
  drive_id  uuid not null references drives(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  primary key (drive_id, branch_id)
);

create table drive_target_campuses (
  drive_id  uuid not null references drives(id) on delete cascade,
  campus_id uuid not null references campuses(id) on delete cascade,
  primary key (drive_id, campus_id)
);

create table drive_rounds (
  id            uuid primary key default gen_random_uuid(),
  drive_id      uuid not null references drives(id) on delete cascade,
  sequence      integer not null check (sequence > 0),
  name          text not null,
  scheduled_at  timestamptz,
  venue         text,
  online_link   text,
  instructions  text,
  created_at    timestamptz not null default now(),
  unique (drive_id, sequence)
);

-- =============================================================================
-- Migration: 0005_applications.sql
-- =============================================================================

-- Applications, shortlisting, rounds, attendance.

create table applications (
  id            uuid primary key default gen_random_uuid(),
  drive_id      uuid not null references drives(id) on delete cascade,
  student_id    uuid not null references students(id) on delete cascade,
  applied_at    timestamptz not null default now(),

  -- PRD 7.3: the full verified profile and the role-relevant resume, frozen at
  -- apply time. Every downstream step reads THIS, never the live profile.
  profile_snapshot jsonb not null,
  resume_id        uuid references student_documents(id),

  -- One application per student per drive. There is no withdrawal (PRD 7.4),
  -- so this constraint is the whole rule.
  unique (drive_id, student_id)
);

create index applications_student_idx on applications (student_id);

create table shortlist_entries (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade unique,
  included       boolean not null default false,
  rank           integer,
  score          numeric(6,2),
  -- PRD 13.1: the recommendation is logged ALONGSIDE the human decision so
  -- recommendation quality can be reviewed. Internal only, never shown to students.
  rationale      text,
  decided_by     uuid references profiles(id),
  decided_at     timestamptz not null default now()
);

-- PRD 13.2: the recruiter data-sharing log.
create table recruiter_exports (
  id            uuid primary key default gen_random_uuid(),
  drive_id      uuid not null references drives(id) on delete cascade,
  exported_by   uuid not null references profiles(id),
  exported_at   timestamptz not null default now(),
  columns       text[] not null,
  student_count integer not null check (student_count >= 0)
);

-- Who actually sits a round. For round 1 the RECRUITER chooses from the
-- exported list; for later rounds only 'selected' students advance.
create table round_participants (
  id             uuid primary key default gen_random_uuid(),
  round_id       uuid not null references drive_rounds(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  added_by       uuid references profiles(id),
  added_at       timestamptz not null default now(),
  unique (round_id, application_id)
);

create table round_results (
  id             uuid primary key default gen_random_uuid(),
  round_id       uuid not null references drive_rounds(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  result         round_result not null,
  declared_by    uuid references profiles(id),
  declared_at    timestamptz not null default now(),
  unique (round_id, application_id)
);

create table attendance (
  id             uuid primary key default gen_random_uuid(),
  round_id       uuid not null references drive_rounds(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  status         attendance_status not null default 'scheduled',
  marked_by      uuid references profiles(id),
  marked_at      timestamptz,
  -- A QR self check-in stays provisional until a coordinator confirms it.
  confirmed_by   uuid references profiles(id),
  unique (round_id, application_id),
  constraint provisional_is_unconfirmed
    check (status <> 'provisional' or confirmed_by is null)
);

create index attendance_absent_idx on attendance (application_id) where status = 'absent';

-- =============================================================================
-- Migration: 0006_outcomes.sql
-- =============================================================================

-- Offers, opt-out, disbarment, notifications.

create table offers (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id) on delete cascade,
  -- Null for self-placed offers, which have no drive.
  drive_id       uuid references drives(id) on delete set null,
  source         offer_source not null default 'on_campus',

  company_name   text not null,
  role_title     text,
  drive_type     drive_type not null,
  offer_category offer_category,
  ctc_lpa        numeric(6,2) not null check (ctc_lpa >= 0),

  declared_at    timestamptz not null default now(),
  declared_by    uuid references profiles(id),
  offer_letter_id uuid references student_documents(id),

  -- Self-placed offers require CPC approval (PRD 16.2).
  approved_by    uuid references profiles(id),
  approved_at    timestamptz,

  constraint on_campus_has_drive
    check (source <> 'on_campus' or drive_id is not null),
  constraint self_placed_needs_approval
    check (source <> 'self_placed' or approved_by is not null),
  constraint internship_offer_has_no_category
    check (drive_type is distinct from 'internship' or offer_category is null),
  constraint ladder_offer_has_category
    check (drive_type = 'internship' or offer_category is not null)
);

create index offers_student_idx on offers (student_id);

-- PRD 12: highest CTC is the default record; the Central CPC may override.
create table placement_record_overrides (
  student_id  uuid primary key references students(id) on delete cascade,
  offer_id    uuid not null references offers(id) on delete cascade,
  reason      text not null,
  set_by      uuid not null references profiles(id),
  set_at      timestamptz not null default now()
);

-- PRD 16.1: student-initiated only, CPC-approved, IRREVERSIBLE.
create table opt_out_requests (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  reason       text not null,
  status       verification_status not null default 'pending',
  decided_by   uuid references profiles(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

create unique index one_approved_opt_out_per_student
  on opt_out_requests (student_id) where status = 'verified';

-- PRD 15.2: never automatic. The Central CPC reviews and decides.
create table disbarment_decisions (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  disbarred     boolean not null,
  reason        text not null,
  absence_count integer not null check (absence_count >= 0),
  decided_by    uuid not null references profiles(id),
  decided_at    timestamptz not null default now()
);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_unread_idx on notifications (student_id) where read_at is null;

-- PRD 21.2: per-student delivery status must be visible to the Central CPC.
create table email_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid not null references notifications(id) on delete cascade,
  recipient_email     text not null,
  provider_message_id text,
  status              text not null default 'queued',
  error               text,
  updated_at          timestamptz not null default now()
);

-- =============================================================================
-- Migration: 0007_audit.sql
-- =============================================================================

-- Immutable audit trail (PRD 19).
-- Written by triggers, never by application code. Append-only at the DB level.

create table audit_log (
  id            bigserial primary key,
  actor_id      uuid,
  entity_table  text not null,
  entity_id     text not null,
  action        text not null,
  before_data   jsonb,
  after_data    jsonb,
  reason        text,
  created_at    timestamptz not null default now()
);

create index audit_entity_idx on audit_log (entity_table, entity_id);

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_id    text;
  v_new   jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_old   jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
begin
  begin
    v_actor := auth.uid();
  exception when others then
    v_actor := null;
  end;

  v_id := coalesce(
    coalesce(v_new, v_old) ->> 'id',
    coalesce(v_new, v_old) ->> 'student_id'
  );

  insert into audit_log (actor_id, entity_table, entity_id, action, before_data, after_data, reason)
  values (
    v_actor,
    tg_table_name,
    v_id,
    lower(tg_op),
    v_old,
    v_new,
    -- Read generically: this one trigger serves every audited table, so it
    -- must not reference a column that only some of them have.
    coalesce(
      v_new ->> 'rejection_reason',
      v_new ->> 'on_hold_reason',
      v_new ->> 'open_to_all_reason',
      v_new ->> 'reason',
      v_new ->> 'srf_rejection_reason'
    )
  );
  return coalesce(new, old);
end;
$$;

-- Every table whose changes PRD 19 requires us to record.
create trigger audit_students   after insert or update or delete on students
  for each row execute function audit_row();
create trigger audit_drives     after insert or update or delete on drives
  for each row execute function audit_row();
create trigger audit_offers     after insert or update or delete on offers
  for each row execute function audit_row();
create trigger audit_results    after insert or update or delete on round_results
  for each row execute function audit_row();
create trigger audit_attendance after insert or update or delete on attendance
  for each row execute function audit_row();
create trigger audit_shortlist  after insert or update or delete on shortlist_entries
  for each row execute function audit_row();
create trigger audit_exports    after insert on recruiter_exports
  for each row execute function audit_row();
create trigger audit_optout     after insert or update or delete on opt_out_requests
  for each row execute function audit_row();
create trigger audit_disbar     after insert or update or delete on disbarment_decisions
  for each row execute function audit_row();
create trigger audit_semesters  after insert or update or delete on student_semesters
  for each row execute function audit_row();

-- The log is append-only. Nobody, including the service role, may rewrite history.
create rule audit_log_no_update as on update to audit_log do instead nothing;
create rule audit_log_no_delete as on delete to audit_log do instead nothing;

-- =============================================================================
-- Migration: 0008_rls.sql
-- =============================================================================

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

-- =============================================================================
-- Migration: 0009_guards.sql
-- =============================================================================

-- Guards that RLS cannot express: login allowlist, field locking, irreversibility.

-- Login is restricted to addresses already on the roster or on staff.
-- A Google sign-in with any other Gmail address is refused at the database.
create or replace function enforce_login_allowlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- A student on the college roster, or a staff member an Admin invited.
  if exists (select 1 from students where lower(email) = lower(new.email))
     or exists (select 1 from staff_invitations where lower(email) = lower(new.email)) then
    return new;
  end if;
  raise exception
    'Address % is not registered. Ask your placement coordinator for an invitation.',
    new.email
    using errcode = 'check_violation';
end;
$$;

create trigger enforce_login_allowlist
  before insert on auth.users
  for each row execute function enforce_login_allowlist();

-- Binds the claimed account to the rostered student record.
create or replace function claim_student_record() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update students
     set auth_user_id = new.id,
         srf_status = case when srf_status = 'invited' then 'registered' else srf_status end
   where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end;
$$;

create trigger claim_student_record
  after insert on auth.users
  for each row execute function claim_student_record();

-- Materialises the staff profile from the invitation on first sign-in.
create or replace function accept_staff_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  invite staff_invitations%rowtype;
begin
  select * into invite from staff_invitations where lower(email) = lower(new.email);
  if not found then
    return new;
  end if;

  insert into profiles (id, email, full_name, role)
  values (new.id, invite.email, invite.full_name, invite.role)
  on conflict (id) do nothing;

  update staff_invitations set accepted_at = now() where email = invite.email;
  return new;
end;
$$;

create trigger accept_staff_invitation
  after insert on auth.users
  for each row execute function accept_staff_invitation();

-- Decision Q4: students may never change verified academic data.
-- Coordinators may, directly and instantly; the change is audit-logged.
create or replace function protect_verified_academics() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- FAIL CLOSED. Students have no `profiles` row, so role lookup returns NULL
  -- for them; keying the guard off the role would let every student through.
  -- Identify the actor positively instead.

  -- Trusted server context (migrations, service role, admin tooling). Student
  -- requests always carry a JWT, and RLS already blocks anonymous writes.
  if auth.uid() is null then
    return new;
  end if;

  -- Staff: not linked to any student record.
  if not exists (select 1 from students where auth_user_id = auth.uid()) then
    return new;
  end if;

  if new.tenth_percentage   is distinct from old.tenth_percentage
  or new.twelfth_percentage is distinct from old.twelfth_percentage
  or new.overall_cgpa       is distinct from old.overall_cgpa
  or new.current_arrears    is distinct from old.current_arrears
  or new.history_of_arrears is distinct from old.history_of_arrears
  or new.degree_id          is distinct from old.degree_id
  or new.branch_id          is distinct from old.branch_id
  or new.roll_number        is distinct from old.roll_number
  or new.srf_status         is distinct from old.srf_status
  or new.participation_status is distinct from old.participation_status then
    raise exception 'Verified academic data can only be changed by a placement coordinator'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger protect_verified_academics
  before update on students
  for each row execute function protect_verified_academics();

-- PRD 6.1: a rejected PIF is closed permanently. A fresh PIF must be raised.
create or replace function enforce_drive_transitions() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'A rejected PIF is final and cannot be reopened. Raise a fresh PIF.'
      using errcode = 'check_violation';
  end if;

  -- An on-hold drive can never be published (decision Q4 on holds).
  if new.status = 'live' and new.on_hold then
    raise exception 'A drive on hold cannot be published.'
      using errcode = 'check_violation';
  end if;

  -- offer_category is the Delivery Head's decision and is final once approved.
  if old.status not in ('draft', 'submitted')
     and old.offer_category is not null
     and new.offer_category is distinct from old.offer_category then
    raise exception 'Offer category is set by the Delivery Head and cannot be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger enforce_drive_transitions
  before update on drives
  for each row execute function enforce_drive_transitions();

-- PRD 16.1: opting out is irreversible.
create or replace function enforce_opt_out_irreversible() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.participation_status = 'opted_out' and new.participation_status <> 'opted_out' then
    raise exception 'Opting out is irreversible; the student cannot rejoin placements.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_opt_out_irreversible
  before update on students
  for each row execute function enforce_opt_out_irreversible();

-- =============================================================================
-- Migration: 0010_storage.sql
-- =============================================================================

-- Private storage buckets. Documents are only ever served through short-lived
-- signed URLs (PRD 21.2); nothing here is publicly readable.
--
-- storage.* is provided by Supabase. Guarded so the local PGlite harness,
-- which has no storage schema, can still run every other migration.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('marksheets',    'marksheets',    false, 5242880, array['application/pdf','image/jpeg','image/png']),
    ('resumes',       'resumes',       false, 5242880, array['application/pdf']),
    ('offer-letters', 'offer-letters', false, 5242880, array['application/pdf'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  -- Objects are namespaced by student id: <student_uuid>/<filename>.
  -- A student may only ever touch their own folder.
  execute $p$
    create policy "students read own documents" on storage.objects for select
      using (
        bucket_id in ('marksheets','resumes','offer-letters')
        and (storage.foldername(name))[1] = (
          select id::text from public.students where auth_user_id = auth.uid()
        )
      )
  $p$;

  execute $p$
    create policy "students upload own documents" on storage.objects for insert
      with check (
        bucket_id in ('marksheets','resumes')
        and (storage.foldername(name))[1] = (
          select id::text from public.students where auth_user_id = auth.uid()
        )
      )
  $p$;

  execute $p$
    create policy "staff read all documents" on storage.objects for select
      using (
        bucket_id in ('marksheets','resumes','offer-letters')
        and public.current_app_role() is not null
      )
  $p$;

  execute $p$
    create policy "operators manage documents" on storage.objects for all
      using (public.is_operator()) with check (public.is_operator())
  $p$;
end $$;

-- =============================================================================
-- Migration: 0011_reference_degrees.sql
-- =============================================================================

-- Eligible degrees, PIF Q13. Confirmed 2026-08-02.
--
-- Seeded as rows rather than hardcoded in the AE's form: adding a seventh
-- degree should be a row, not a release. The list starts as exactly the six
-- from the PIF.
--
-- "Any degree" is deliberately absent. It is not a degree - it is the ABSENCE
-- of a degree restriction, expressed as an empty eligible-degrees list on the
-- drive. evaluateEligibility (R2) treats an empty list as "no filter". Storing
-- it as a row would silently break eligibility, because no student's degree is
-- ever literally "Any degree".

insert into degrees (name) values
  ('B.E / B.Tech (CSE / IT / allied)'),
  ('BCA'),
  ('B.Sc CS / CT'),
  ('MCA'),
  ('M.Sc CS')
on conflict (name) do nothing;

-- =============================================================================
-- Migration: 0012_org_hierarchy.sql
-- =============================================================================

-- City -> Campus -> Degree -> Branch, completed.
--
-- Two things happen here, and the second is the urgent one.
--
-- 1. City becomes a real table and a campus gains a complete, mandatory
--    identity. Confirmed 2026-08-02.
--
-- 2. RLS is enabled on the reference and identity tables. 0008 granted
--    insert+update on EVERY table to `authenticated` but enabled RLS on only
--    nine, leaving four proven escalation paths from student to admin. See
--    src/db/org-hierarchy.test.ts, which reproduces all four.
--
-- Precondition: `campuses` is empty in every environment (verified against
-- production 2026-08-02), so the restructure needs no backfill.

create table cities (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  state  text not null
);

-- City was free text on the campus. One city, one row, one state - stored
-- once so "Chennai"/"chennai" can never become two cities in a report.
alter table campuses drop column city;

alter table campuses
  add column city_id                uuid not null references cities(id),
  add column code                   text not null unique,
  add column address                text not null,
  add column primary_contact_name   text not null,
  add column primary_contact_email  text not null,
  add column primary_contact_phone  text not null;

-- Deactivate, never delete: a campus has students, applications and offers
-- hanging off it, and a branch is referenced by every student in it.
-- `authenticated` was never granted DELETE, so this is the only retirement
-- path that exists.
alter table campuses add column is_active boolean not null default true;
alter table branches add column is_active boolean not null default true;

-- ---------------------------------------------------------------------------
-- Reference and identity tables are admin-write, everyone-read.
-- ---------------------------------------------------------------------------

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select current_app_role() = 'admin'
$$;

-- NOTE: deliberately no FORCE. The login guards in 0009 (enforce_login_allowlist,
-- claim_student_record, accept_staff_invitation) are SECURITY DEFINER and must
-- keep bypassing these policies, or no one can ever sign in again.
alter table cities                   enable row level security;
alter table campuses                 enable row level security;
alter table degrees                  enable row level security;
alter table branches                 enable row level security;
alter table campus_degrees           enable row level security;
alter table profiles                 enable row level security;
alter table staff_campus_assignments enable row level security;
alter table staff_invitations        enable row level security;
alter table settings                 enable row level security;

-- Readable by anyone signed in: students need campuses, degrees and branches
-- to read a drive, and the app needs settings for the offer bands.
create policy read_cities            on cities                   for select using (true);
create policy read_campuses          on campuses                 for select using (true);
create policy read_degrees           on degrees                  for select using (true);
create policy read_branches          on branches                 for select using (true);
create policy read_campus_degrees    on campus_degrees           for select using (true);
create policy read_profiles          on profiles                 for select using (true);
create policy read_assignments       on staff_campus_assignments for select using (true);
create policy read_settings          on settings                 for select using (true);

-- Staff invitations are an allowlist of pending accounts. A student reading it
-- learns nothing they should, so it is admin-only in both directions.
create policy read_invitations       on staff_invitations for select using (is_admin());

create policy write_cities           on cities                   for all using (is_admin()) with check (is_admin());
create policy write_campuses         on campuses                 for all using (is_admin()) with check (is_admin());
create policy write_degrees          on degrees                  for all using (is_admin()) with check (is_admin());
create policy write_branches         on branches                 for all using (is_admin()) with check (is_admin());
create policy write_campus_degrees   on campus_degrees           for all using (is_admin()) with check (is_admin());
create policy write_profiles         on profiles                 for all using (is_admin()) with check (is_admin());
create policy write_assignments      on staff_campus_assignments for all using (is_admin()) with check (is_admin());
create policy write_invitations      on staff_invitations for all using (is_admin()) with check (is_admin());
create policy write_settings         on settings                 for all using (is_admin()) with check (is_admin());

-- 0008's blanket grant only covered tables that existed then.
grant select, insert, update on cities to authenticated;

-- =============================================================================
-- Migration: 0013_staff_campus_invitations.sql
-- =============================================================================

-- Campus assignments chosen at invitation time.
--
-- staff_campus_assignments references profiles(id), but a profile does not
-- exist until the invitee first signs in - 0009's accept_staff_invitation
-- materialises it. So an Admin who picks campuses while inviting has nowhere
-- to put them. They are staged against the invited email here and applied by
-- the same trigger.
--
-- Without this, a CPC signs in successfully, is scoped to no campus, and sees
-- an application with nothing in it.

create table staff_campus_invitations (
  email      text not null,
  campus_id  uuid not null references campuses(id) on delete cascade,
  primary key (email, campus_id)
);

alter table staff_campus_invitations enable row level security;

create policy read_staff_campus_invitations
  on staff_campus_invitations for select using (is_admin());

create policy write_staff_campus_invitations
  on staff_campus_invitations for all using (is_admin()) with check (is_admin());

grant select, insert, update on staff_campus_invitations to authenticated;

-- Extends 0009's trigger. Redefined in full rather than patched, so the whole
-- behaviour is readable in one place.
create or replace function accept_staff_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  invite staff_invitations%rowtype;
begin
  select * into invite from staff_invitations where lower(email) = lower(new.email);
  if not found then
    return new;
  end if;

  insert into profiles (id, email, full_name, role)
  values (new.id, invite.email, invite.full_name, invite.role)
  on conflict (id) do nothing;

  -- Apply whatever campuses the Admin staged at invitation time.
  insert into staff_campus_assignments (profile_id, campus_id)
  select new.id, sci.campus_id
    from staff_campus_invitations sci
   where lower(sci.email) = lower(new.email)
  on conflict do nothing;

  update staff_invitations set accepted_at = now() where email = invite.email;
  return new;
end;
$$;

-- =============================================================================
-- Migration: 0014_self_placement.sql
-- =============================================================================

-- Self-placement: the student's own off-campus offer.
--
-- `offers` refuses a self-placed row without an approver, so a PENDING
-- self-placement has nowhere to live. It also demanded an offer category for
-- anything that is not an internship - but the category is the Delivery Head's
-- decision on a drive, and a self-placed offer has no drive. That constraint
-- is narrowed to on-campus offers, where it means something.
--
-- The flow: student raises a request -> coordinator approves -> an `offers`
-- row is created with approved_by set. R3, R4 and R9 ignore it either way,
-- because source = 'self_placed' (PRD 16.2).

create table self_placement_requests (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  company_name text not null,
  role_title   text,
  ctc_lpa      numeric(6,2) not null check (ctc_lpa >= 0),
  offer_letter_id uuid references student_documents(id),
  status       verification_status not null default 'pending',
  decided_by   uuid references profiles(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index self_placement_requests_student_idx on self_placement_requests (student_id);

alter table offers drop constraint ladder_offer_has_category;

alter table offers add constraint ladder_offer_has_category
  check (
    source <> 'on_campus'
    or drive_type = 'internship'
    or offer_category is not null
  );

alter table self_placement_requests enable row level security;
alter table self_placement_requests force  row level security;

-- A student sees and raises only their own.
create policy student_reads_own_self_placement
  on self_placement_requests for select
  using (student_id = current_student_id() or is_org_reader() or is_campus_staff());

create policy student_raises_own_self_placement
  on self_placement_requests for insert
  with check (student_id = current_student_id());

-- Approval is the coordinator's. A student has no update policy at all, so
-- their attempt to approve themselves matches no row and changes nothing.
create policy staff_decides_self_placement
  on self_placement_requests for update
  using (is_operator() or is_campus_staff())
  with check (is_operator() or is_campus_staff());

grant select, insert, update on self_placement_requests to authenticated;

-- =============================================================================
-- Migration: 0015_staff_removal.sql
-- =============================================================================

-- Removing a staff member, and moving one to a different role.
--
-- 0012 already restricts both to Admins: `write_profiles`, `write_invitations`
-- and `write_staff_campus_invitations` are FOR ALL, which includes DELETE. But
-- 0008 granted `authenticated` only SELECT, INSERT and UPDATE, so a DELETE
-- never reached the policy at all - it failed at the grant with a bare
-- "permission denied for table profiles" and no way for an Admin to act on it.
--
-- WHY DELETE AT ALL, given the audit trail is append-only:
--   An invitation is the login allowlist. Getting one wrong - a typo'd address,
--   a test account, someone who left before they ever signed in - leaves an
--   account that can sign in and must be revocable. Deactivation does not
--   remove an unaccepted invitation, because there is no profile to deactivate.
--
-- WHAT DELETE CANNOT DO:
--   profiles.id is referenced by drives.created_by, approved_by, published_by
--   and by the offer and result tables, none of them ON DELETE anything. So
--   Postgres refuses to remove anyone whose work is still on record, and the
--   attribution PRD 19 depends on survives. The application turns that refusal
--   into "deactivate them instead".
--
--   The audit_log itself keeps actor_id as a plain uuid with no foreign key,
--   so history is never touched by any of this.

grant delete on profiles                  to authenticated;
grant delete on staff_invitations         to authenticated;
grant delete on staff_campus_invitations  to authenticated;
grant delete on staff_campus_assignments  to authenticated;

-- =============================================================================
-- Migration: 0016_invitation_accepts_existing_account.sql
-- =============================================================================

-- An invitation must be actionable whenever it is written, not only when a
-- Google account happens to be created.
--
-- THE BUG THIS FIXES, observed in production 2026-08-04:
--   0009's accept_staff_invitation is AFTER INSERT ON auth.users. Google
--   sign-in inserts that row exactly once, ever. So for anyone who had already
--   signed in, a NEW invitation was inert: no profile was created, and
--   resolveAuthState finds neither a profile nor a student record, returns
--   signed-out, and bounces them back to /login with nothing to explain it.
--
--   0015 made this reachable. Removing a staff member deletes their profile and
--   invitation, but the browser cannot delete the auth.users row, so re-inviting
--   the same person produced an account that could never sign in again.
--
-- THE RULE, stated once: a staff invitation for an address that already has an
-- account is accepted immediately. Acceptance is idempotent and driven by the
-- invitation, which is the thing an Admin actually controls.
--
-- 0009's trigger stays: it covers the ordinary case where the invitation comes
-- first and the account second. The two are complementary and both idempotent.

create or replace function accept_invitation_for_existing_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  account_id uuid;
begin
  select id into account_id from auth.users where lower(email) = lower(new.email);

  -- The ordinary case: invited first, signs in later. 0009 handles that.
  if account_id is null then
    return new;
  end if;

  -- `do update` rather than `do nothing`: an existing profile on the old role
  -- is exactly the situation a re-invitation is meant to correct.
  insert into profiles (id, email, full_name, role)
  values (account_id, new.email, new.full_name, new.role)
  on conflict (id) do update
    set role      = excluded.role,
        full_name = excluded.full_name;

  insert into staff_campus_assignments (profile_id, campus_id)
  select account_id, sci.campus_id
    from staff_campus_invitations sci
   where lower(sci.email) = lower(new.email)
  on conflict do nothing;

  -- Only ever fires on `role`, so this write cannot re-enter the trigger.
  update staff_invitations
     set accepted_at = now()
   where email = new.email and accepted_at is null;

  return new;
end;
$$;

create trigger accept_invitation_for_existing_account
  after insert or update of role on staff_invitations
  for each row execute function accept_invitation_for_existing_account();

-- =============================================================================
-- Migration: 0017_semester_academics.sql
-- =============================================================================

-- Semester-wise academics. Confirmed 2026-08-04, supersedes the single
-- cumulative CGPA the SRF collected.
--
-- A student declares whether they are pursuing UG or PG:
--   UG -> one line per semester, at most 10.
--   PG -> a single aggregate for the UG they already finished, then one line
--         per PG semester, at most 4.
--
-- Each line carries CGPA (not GPA - cumulative to the end of that semester),
-- standing arrears and history of arrears. `student_semesters` already had
-- exactly that shape from 0003; what was missing was the programme level, the
-- per-level cap, and anywhere to put a postgraduate's UG result.
--
-- ELIGIBILITY reads the LATEST VERIFIED semester (src/domain/academics.ts).
-- students.overall_cgpa is kept for now because the roster importer and the
-- existing screens still write it, but it is no longer what decides whether a
-- student may apply.

create type programme_level as enum ('ug', 'pg');

alter table students
  add column programme_level    programme_level not null default 'ug',
  -- Postgraduates only: the one aggregate line standing in for a whole degree.
  add column ug_aggregate_cgpa  numeric(4,2) check (ug_aggregate_cgpa between 0 and 10);

-- The cap depends on the student's own programme level, which a CHECK
-- constraint cannot reach. 0003 allowed semester_number 1..12 for everyone.
create or replace function enforce_semester_cap() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  level programme_level;
  limit_for_level integer;
  used integer;
begin
  select programme_level into level from students where id = new.student_id;
  if not found then
    return new;
  end if;

  limit_for_level := case level when 'pg' then 4 else 10 end;

  if new.semester_number < 1 or new.semester_number > limit_for_level then
    raise exception
      'Semester % is outside the range for this programme (at most % semesters).',
      new.semester_number, limit_for_level
      using errcode = 'check_violation';
  end if;

  select count(*) into used
    from student_semesters
   where student_id = new.student_id
     and (tg_op = 'INSERT' or id <> new.id);

  if used + 1 > limit_for_level then
    raise exception 'This student has at most % semesters.', limit_for_level
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_semester_cap
  before insert or update on student_semesters
  for each row execute function enforce_semester_cap();

-- =============================================================================
-- Migration: 0018_campus_scoped_readers.sql
-- =============================================================================

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

-- =============================================================================
-- Migration: 0019_drive_owner_reads_shortlist.sql
-- =============================================================================

-- The AE who raised a drive may see its shortlist.
--
-- The shortlist IS the list the recruiter is sent (PRD §13.2), and the Account
-- Executive owns that client relationship: their drive portfolio counts how
-- many applicants were included. Without this the count is not merely missing,
-- it reads a confident zero, which is worse.
--
-- PRD §13.1 is unaffected: it forbids showing rank, rationale or inclusion to
-- STUDENTS, and shortlist_entries still has no student policy of any kind.
-- Scoped to drives the AE raised, and select-only - shortlisting stays the
-- Central CPC's decision.

create policy shortlist_read_drive_owner on shortlist_entries for select
  using (
    current_app_role() = 'account_executive'
    and application_id in (
      select a.id from applications a
       where a.drive_id in (select d.id from drives d where d.created_by = auth.uid())
    )
  );

-- Same argument for the outcome. An offer is the most important thing that can
-- happen to a drive, and the AE who raised it is asked by the client how many
-- were made. Their own drive only, select-only: declaring an offer stays with
-- the Central CPC (is_operator).
create policy offers_read_drive_owner on offers for select
  using (
    current_app_role() = 'account_executive'
    and drive_id in (select id from drives where created_by = auth.uid())
  );

-- =============================================================================
-- Migration: 0020_student_may_submit_srf.sql
-- =============================================================================

-- The registration form could never be submitted.
--
-- Reported from UAT 2026-08-05: "the student registration form is still not
-- getting submitted successfully". It never could, since 0009.
--
-- protect_verified_academics refuses ANY student change to tenth_percentage,
-- twelfth_percentage or srf_status. The SRF writes all three in one statement,
-- so every submission raised 'Verified academic data can only be changed by a
-- placement coordinator' and the student saw a generic failure.
--
-- The guard is still exactly right in intent (decision Q4): a student must
-- never be able to edit marks a coordinator has checked, and must never be
-- able to approve themselves. It was simply drawn one step too wide, because
-- it never distinguished DECLARING marks from CHANGING VERIFIED ones.
--
-- The line this migration draws:
--
--   before verification  - the student's own declaration. They typed these
--                          figures; nobody has checked them; they may correct
--                          them and send the form in.
--   after  srf_approved  - the coordinator's data. Locked, because every
--                          eligibility decision has already been made against
--                          it (R5 reads the latest VERIFIED semester, but the
--                          A28 fallback still reads these columns).
--
-- srf_status stays the coordinator's in every direction but one: a student may
-- move their OWN form to 'srf_submitted', and only from a state that has not
-- been approved. They can never write 'srf_approved' or 'srf_rejected'.

create or replace function protect_verified_academics() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_student boolean;
begin
  -- FAIL CLOSED. Students have no `profiles` row, so a role lookup returns
  -- NULL for them; keying the guard off the role would let every student
  -- through. Identify the actor positively instead.

  -- Trusted server context (migrations, service role, admin tooling). Student
  -- requests always carry a JWT, and RLS already blocks anonymous writes.
  if auth.uid() is null then
    return new;
  end if;

  is_student := exists (select 1 from students where auth_user_id = auth.uid());

  -- Staff: not linked to any student record.
  if not is_student then
    return new;
  end if;

  -- ---------------------------------------------------------------- status
  -- The one transition a student owns: sending their own form for checking.
  -- Everything else about srf_status remains the coordinator's.
  if new.srf_status is distinct from old.srf_status then
    if not (
      new.srf_status = 'srf_submitted'
      and old.srf_status in ('invited', 'registered', 'srf_rejected')
    ) then
      raise exception 'Verified academic data can only be changed by a placement coordinator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ----------------------------------------------------------------- marks
  -- Their own declaration until it is approved, and never afterwards.
  if old.srf_status = 'srf_approved' then
    if new.tenth_percentage   is distinct from old.tenth_percentage
    or new.twelfth_percentage is distinct from old.twelfth_percentage then
      raise exception 'Verified academic data can only be changed by a placement coordinator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- --------------------------------------------------- never the student's
  -- Identity and standing come from the roster and from verification, never
  -- from the form. overall_cgpa and the arrear columns are the coordinator's
  -- figures: the student declares theirs per semester, in student_semesters,
  -- where an unverified line can never decide eligibility.
  if new.overall_cgpa       is distinct from old.overall_cgpa
  or new.current_arrears    is distinct from old.current_arrears
  or new.history_of_arrears is distinct from old.history_of_arrears
  or new.degree_id          is distinct from old.degree_id
  or new.branch_id          is distinct from old.branch_id
  or new.roll_number        is distinct from old.roll_number
  or new.participation_status is distinct from old.participation_status then
    raise exception 'Verified academic data can only be changed by a placement coordinator'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- =============================================================================
-- Migration: 0021_srf_draft.sql
-- =============================================================================

-- Save the registration form as a draft.
--
-- UAT 2026-08-05: "the registration form does not save the student's progress
-- as a draft. An auto-save or Save as Draft feature should be implemented so
-- students can continue the registration later without losing their data."
--
-- The draft is the student's own working copy of a form they have not sent
-- yet, so it lives on their row and inherits the policies that already protect
-- it: theirs to write, nobody else's to read, and visible to the coordinator
-- who has to help when they get stuck.
--
-- It carries NO authority. Eligibility never reads it, verification never
-- reads it, and `protect_verified_academics` still governs every column that
-- matters - a student cannot smuggle an approval or a mark into a draft,
-- because the draft is one opaque jsonb column and the guarded columns are not
-- in it. Submitting remains the only thing that moves the form forward.

alter table students
  add column if not exists srf_draft          jsonb,
  add column if not exists srf_draft_saved_at timestamptz;

comment on column students.srf_draft is
  'The student''s unsent registration form. No authority: never read by '
  'eligibility or verification. Cleared when the form is submitted.';

-- =============================================================================
-- Migration: 0022_participation_evidence.sql
-- =============================================================================

-- Evidence for the two decisions a student makes about their own placement.
--
-- UAT 2026-08-05, two items:
--   * an off-campus placement "should be mandatory for students to upload
--     their Offer Letter for verification"
--   * opting out "should mandate the upload of a handwritten and signed
--     declaration letter confirming their decision"
--
-- Both decisions are irreversible in practice. An approved opt-out can never
-- be undone (0009's enforce_opt_out_irreversible), and a self-placement
-- becomes a number the college reports. Neither may rest on a student's word
-- alone, and neither may rest on a screen remembering to ask - so the
-- requirement lives here, where no client can forget it.
--
-- A18 already said a self-placement "requires an offer letter upload, because
-- there is no drive to corroborate it". It was written down and never
-- enforced.

alter type document_kind add value if not exists 'opt_out_declaration';

alter table self_placement_requests
  add column if not exists offer_letter_id uuid references student_documents(id);

alter table opt_out_requests
  add column if not exists declaration_id uuid references student_documents(id);

-- NOT VALID deliberately: one self-placement request already exists on the
-- live project, raised before this was required. The constraint governs every
-- new and updated row from now on, and leaves that one alone rather than
-- refusing to deploy. It is listed in HANDOVER for a coordinator to chase.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'self_placement_needs_offer_letter'
  ) then
    alter table self_placement_requests
      add constraint self_placement_needs_offer_letter
      check (offer_letter_id is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'opt_out_needs_declaration'
  ) then
    alter table opt_out_requests
      add constraint opt_out_needs_declaration
      check (declaration_id is not null) not valid;
  end if;
end $$;

-- Storage. A student could not upload an offer letter at all: the insert
-- policy in 0010 covered 'marksheets' and 'resumes' only, so the bucket their
-- own evidence belongs in was readable by them and writable by nobody.
--
-- Declarations get their own bucket rather than sharing offer-letters: they
-- are a different document with a different retention story, and a handwritten
-- signed sheet arrives as a PHOTOGRAPH from a phone, so images are allowed.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('declarations', 'declarations', false, 5242880,
          array['application/pdf','image/jpeg','image/png','image/heic'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  update storage.buckets
     set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/heic']
   where id = 'offer-letters';

  execute $p$ drop policy if exists "students upload own documents" on storage.objects $p$;
  execute $p$
    create policy "students upload own documents" on storage.objects for insert
      with check (
        bucket_id in ('marksheets','resumes','offer-letters','declarations')
        and (storage.foldername(name))[1] = (
          select id::text from public.students where auth_user_id = auth.uid()
        )
      )
  $p$;

  execute $p$ drop policy if exists "students read own documents" on storage.objects $p$;
  execute $p$
    create policy "students read own documents" on storage.objects for select
      using (
        bucket_id in ('marksheets','resumes','offer-letters','declarations')
        and (storage.foldername(name))[1] = (
          select id::text from public.students where auth_user_id = auth.uid()
        )
      )
  $p$;

  execute $p$ drop policy if exists "staff read all documents" on storage.objects $p$;
  execute $p$
    create policy "staff read all documents" on storage.objects for select
      using (
        bucket_id in ('marksheets','resumes','offer-letters','declarations')
        and public.current_app_role() is not null
      )
  $p$;
end $$;

-- =============================================================================
-- Migration: 0023_marksheet_evidence.sql
-- =============================================================================

-- Every declared figure is evidenced by the document that proves it.
--
-- `student_semesters.marksheet_id` was created in 0003 for exactly this and
-- nothing ever wrote it. The SRF marked the marksheet uploads REQUIRED, let
-- the student pick their files, and then discarded every one: the files never
-- left the browser, no storage object was created, no `student_documents` row
-- was recorded, and no semester line was ever linked to anything.
--
-- The consequence was not cosmetic. A coordinator opening the verification
-- queue saw a declared CGPA and no document to check it against, which makes
-- "verified" a signature on the student's own typing - and a verified semester
-- is what R5 reads to decide whether that student may apply to a drive
-- (0017). The evidence chain had a hole exactly where the business rule
-- depends on it.
--
-- The application now uploads and links them. This migration is why that
-- cannot quietly stop being true.

-- ------------------------------------------------------------------- A31
-- A postgraduate declares ONE aggregate CGPA standing in for an entire
-- completed degree (0017). Unevidenced, it is the largest unverifiable number
-- on the form, so it is evidenced like any other declared mark.
-- ASSUMPTION - UNCONFIRMED: that a consolidated UG marksheet is the document
-- a PG student can actually produce. Cheap to reverse: drop the enum value's
-- use and the column.
alter type document_kind add value if not exists 'ug_consolidated_marksheet';

alter table students
  add column if not exists ug_marksheet_id uuid references student_documents(id);

-- ------------------------------------------------------ evidence is required
-- Safe as a plain NOT NULL: `student_semesters` has no rows on any deployed
-- project (checked against Mumbai, 2026-08-06), and nothing but the SRF has
-- ever inserted into it. A line with no marksheet is a number nobody can
-- check, and it would sit in the queue looking exactly like one that had been
-- evidenced.
alter table student_semesters
  alter column marksheet_id set not null;

-- --------------------------------------------------- evidence must be theirs
-- The foreign key says "a document". It does not say WHOSE document, or that
-- it is a marksheet at all. Without this, one student's marksheet could
-- evidence another's CGPA, or a resume could - and the coordinator, following
-- a correctly-signed link to a real PDF, would have no way to tell.
--
-- A trigger rather than a CHECK: the rule spans two tables.
create or replace function enforce_marksheet_belongs_to_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  doc_kind document_kind;
begin
  if new.marksheet_id is null then
    return new;
  end if;

  select student_id, kind into owner, doc_kind
    from student_documents where id = new.marksheet_id;

  if owner is distinct from new.student_id then
    raise exception 'A semester can only be evidenced by that student''s own marksheet.'
      using errcode = 'check_violation';
  end if;

  if doc_kind <> 'semester_marksheet' then
    raise exception 'A semester must be evidenced by a semester marksheet, not a %.', doc_kind
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_marksheet_belongs_to_student
  before insert or update on student_semesters
  for each row execute function enforce_marksheet_belongs_to_student();

-- The same rule for the postgraduate aggregate, which has the same hole.
create or replace function enforce_ug_marksheet_belongs_to_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  doc_kind document_kind;
begin
  if new.ug_marksheet_id is null
     or new.ug_marksheet_id is not distinct from old.ug_marksheet_id then
    return new;
  end if;

  select student_id, kind into owner, doc_kind
    from student_documents where id = new.ug_marksheet_id;

  if owner is distinct from new.id then
    raise exception 'A student''s UG aggregate can only be evidenced by their own marksheet.'
      using errcode = 'check_violation';
  end if;

  if doc_kind <> 'ug_consolidated_marksheet' then
    raise exception 'The UG aggregate must be evidenced by a consolidated UG marksheet.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_ug_marksheet_belongs_to_student
  before insert or update on students
  for each row execute function enforce_ug_marksheet_belongs_to_student();

-- =============================================================================
-- Migration: 0024_academic_history.sql
-- =============================================================================

-- The academic history the SRF actually collects. Asked for 2026-08-06.
--
-- The form asked for two school percentages and jumped straight to the degree.
-- It had nowhere to record WHICH school issued them, no diploma at all - the
-- route most polytechnic students take into an engineering degree - and no way
-- to say that a college reports percentages rather than a CGPA.
--
-- That last one is not cosmetic. Every cutoff in this system is a CGPA on the
-- 10-point scale (`drives.min_overall_cgpa`), so a student whose college
-- reports 78% had two options: mistype it as a CGPA of 7.8, which is wrong by
-- a fifth of a grade and decides eligibility, or be refused outright by the
-- 0..10 check constraint.

create type marks_scale as enum ('cgpa', 'percentage');

alter type document_kind add value if not exists 'diploma_marksheet';

-- --------------------------------------------------------------- the schools
alter table students
  add column if not exists tenth_institution   text,
  add column if not exists twelfth_institution text;

-- --------------------------------------------------------------- the diploma
-- Optional to declare. Once declared it is a mark like any other, and the
-- constraint below refuses one with nothing behind it.
alter table students
  add column if not exists diploma_institution   text,
  add column if not exists diploma_marks         numeric(5,2) check (diploma_marks between 0 and 100),
  add column if not exists diploma_marks_scale   marks_scale,
  add column if not exists diploma_marksheet_id  uuid references student_documents(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diploma_is_all_or_nothing') then
    alter table students add constraint diploma_is_all_or_nothing check (
      -- No diploma at all, or a complete one: a figure, the scale it is on,
      -- and the document that proves it. A half-declared diploma is a mark
      -- nobody can verify.
      (diploma_marks is null and diploma_marks_scale is null and diploma_marksheet_id is null)
      or (diploma_marks is not null and diploma_marks_scale is not null
          and diploma_marksheet_id is not null)
    );
  end if;
end $$;

-- ------------------------------------------- the completed undergraduate one
-- A PG student's aggregate said nothing about WHERE or IN WHAT.
alter table students
  add column if not exists ug_degree  text,
  add column if not exists ug_college text,
  add column if not exists ug_branch  text,
  -- What the student actually typed, beside the CGPA it normalises to.
  add column if not exists ug_aggregate_declared numeric(5,2)
    check (ug_aggregate_declared between 0 and 100),
  add column if not exists ug_aggregate_scale    marks_scale;

-- ------------------------------------------------------------- college marks
-- BOTH figures are stored, deliberately:
--
--   cgpa           - normalised to the 10-point scale. The ONLY thing a cutoff
--                    can be compared against, and what every existing reader
--                    (eligibility, ranking, the dashboards) already assumes.
--   declared_marks - what the student typed, on `marks_scale`. What a
--                    coordinator checks against the marksheet, because a
--                    converted CGPA is a number they cannot find on it.
--
-- Storing only the first loses the audit trail; only the second makes every
-- comparison re-derive a figure it could get wrong. The conversion itself is
-- one constant in src/domain/marks.ts (A33).
alter table student_semesters
  add column if not exists declared_marks numeric(5,2) check (declared_marks between 0 and 100),
  add column if not exists marks_scale    marks_scale not null default 'cgpa';

-- `cgpa` keeps its 0..10 check from 0003 and keeps its meaning: every row that
-- existed before this migration was a CGPA, which is exactly what the default
-- says.

-- ------------------------------------------------- the diploma's own evidence
-- Same hole the semester marksheet had: the foreign key says "a document", not
-- whose, and not that it is the right kind.
create or replace function enforce_diploma_marksheet_belongs_to_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  doc_kind document_kind;
begin
  if new.diploma_marksheet_id is null
     or new.diploma_marksheet_id is not distinct from old.diploma_marksheet_id then
    return new;
  end if;

  select student_id, kind into owner, doc_kind
    from student_documents where id = new.diploma_marksheet_id;

  if owner is distinct from new.id then
    raise exception 'A diploma can only be evidenced by that student''s own marksheet.'
      using errcode = 'check_violation';
  end if;

  if doc_kind <> 'diploma_marksheet' then
    raise exception 'A diploma must be evidenced by a diploma marksheet, not a %.', doc_kind
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger enforce_diploma_marksheet_belongs_to_student
  before insert or update on students
  for each row execute function enforce_diploma_marksheet_belongs_to_student();

-- =============================================================================
-- Migration: 0025_other_profiles.sql
-- =============================================================================

-- Profiles beyond the four the form names. Asked for 2026-08-06:
-- "in professional profiles, have field to enter others also. they can add
-- fields, give a name and mention the url/user name."
--
-- The SRF hard-coded LinkedIn, GitHub, LeetCode and HackerRank. A student with
-- a Kaggle profile, a Behance portfolio, a Codeforces handle or their own site
-- had nowhere to put it - and for many students that is the strongest evidence
-- they have.
--
-- A jsonb LIST rather than a child table, deliberately:
--   * these are display-only links, owned entirely by the student row, with no
--     independent lifecycle and nothing referencing them;
--   * every new table is another chance to get RLS wrong on a system whose
--     hard rule is "students can only ever see their own data" (PRD 21.2).
-- The existing student policies therefore cover this with no new surface, and
-- the audit trigger on `students` already records before/after.
--
-- The SHAPE is owned by src/domain/profile-links.ts. Postgres guarantees only
-- what it can cheaply guarantee: that this is a list.

alter table students
  add column if not exists other_profiles jsonb not null default '[]'::jsonb;

-- Empty list, never null, so no reader has to branch on absence.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'other_profiles_is_a_list') then
    alter table students add constraint other_profiles_is_a_list
      check (jsonb_typeof(other_profiles) = 'array');
  end if;
end $$;

-- =============================================================================
-- Migration: 0026_optional_diploma_evidence.sql
-- =============================================================================

-- The diploma marksheet becomes OPTIONAL. Asked for 2026-08-06: "need an
-- optional upload field as well here for mark sheet."
--
-- 0024 made a declared diploma all-or-nothing, marksheet included, on the
-- principle that a declared figure must be evidenced. That principle still
-- holds where it matters: a SEMESTER figure is what R5 reads to decide whether
-- a student may apply to a drive, and `student_semesters.marksheet_id` stays
-- NOT NULL.
--
-- A diploma figure feeds no cutoff. It is context for a recruiter, not an
-- eligibility input, so an unevidenced one cannot decide anything. Demanding a
-- document for it blocked registration over a scan a student may not have to
-- hand - for a qualification that is optional in the first place.
--
-- What is still required is the pair that makes the number READABLE: a figure
-- with no scale is meaningless, because 78.5 is a fine percentage and an
-- impossible CGPA.

alter table students drop constraint if exists diploma_is_all_or_nothing;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diploma_marks_have_a_scale') then
    alter table students add constraint diploma_marks_have_a_scale check (
      (diploma_marks is null and diploma_marks_scale is null)
      or (diploma_marks is not null and diploma_marks_scale is not null)
    );
  end if;
end $$;

-- The consolidated UG marksheet was never constrained - only ever required by
-- the application - so relaxing that side needs no DDL. The ownership and
-- kind triggers from 0023/0024 still apply to BOTH: optional to supply, but
-- if supplied it must be that student's own document, of the right kind.

-- =============================================================================
-- Migration: 0027_student_replaces_own_semesters.sql
-- =============================================================================

-- A student may replace their own semester lines when they re-submit the SRF.
--
-- UAT 2026-08-05: "Shashwathi Test is not able to submit the student
-- registration form." Her first submission worked. The next eight failed, and
-- the edge logs name the failure exactly: eight
-- `POST /rest/v1/student_semesters` returning **409**, one per attempt.
--
-- The form shows the student's whole academic record, so submitting replaces
-- the semester lines wholesale - delete, then insert. Merging would silently
-- keep a line the student deleted. But 0008 gave a student SELECT and INSERT
-- on `student_semesters` and nothing else:
--
--   semesters_read_self    select   student_id = current_student_id()
--   semesters_insert_self  insert   student_id = current_student_id()
--
-- With no DELETE policy the delete matched no rows. RLS does not raise on
-- that - it is a filter, not a guard - so the client saw a perfectly ordinary
-- 204 and moved on to the insert, which hit
-- `student_semesters_student_id_semester_number_key`.
--
-- So the FIRST submission always succeeded and every later one was impossible.
-- Correcting a mistyped CGPA or re-uploading a marksheet is the normal case,
-- and it was unreachable for every student who had already submitted once.
--
-- Two separate things were missing, at two different levels.

-- 1. THE GRANT. 0008 grants `select, insert, update` to `authenticated` and no
--    delete, so on a database built purely from these migrations NOBODY could
--    delete a semester line - not even a coordinator, whose `semesters_write_staff`
--    policy is `for all` and has been quietly unusable for deletes.
--
--    The live database does not show this, because a Supabase project ships
--    with `grant all` already applied to `authenticated`. That drift is why
--    the schema tests could not reproduce the production failure: locally the
--    delete died at the grant, in production it sailed through and deleted
--    nothing. Granting it here makes the migrations describe the database we
--    actually run, which is the only way the tests can be trusted.
grant delete on student_semesters to authenticated;

-- 2. THE POLICY. Scoped exactly like the insert it undoes: the student's own
--    rows, and only while they are still PENDING.
--
--    `status = 'pending'` is the whole safety of this. Once a coordinator has
--    verified a line it belongs to them, not to the student - a student who
--    could delete a verified 6.2 and insert a declared 8.5 in its place would
--    launder an unchecked figure through a row that eligibility has already
--    been run against. That is the same principle `protect_verified_academics`
--    (0009) enforces on the students table, applied to the table the marks
--    actually live in.
create policy semesters_delete_self on student_semesters for delete
  using (student_id = current_student_id() and status = 'pending');

-- =============================================================================
-- Migration: 0028_submit_srf_atomically.sql
-- =============================================================================

-- Submitting the registration form becomes ONE transaction.
--
-- Called out while fixing the re-submission bug (0027), 2026-08-05. The
-- repository wrote the form in four round trips: insert the marksheet rows,
-- update the student, delete the semester lines, insert the new ones.
-- PostgREST gives every request its own transaction, so a failure at step
-- three committed steps one and two and rolled back nothing.
--
-- The live database was found in exactly that state: a student row saying
-- `srf_submitted` while the student was being told - correctly - that
-- submission had failed, and semester lines that were never written.
--
-- A half-submitted form is worse than a failed one. A coordinator opening the
-- queue cannot see that anything is missing, so they verify what is in front
-- of them and sign marks off against evidence that does not exist. And the
-- student cannot repair it, because to them the form simply "did not submit".
--
-- SECURITY INVOKER, deliberately. This is a transaction boundary, not a
-- privilege: RLS, `protect_verified_academics` (0009) and every marksheet
-- ownership trigger (0023, 0024) still judge the caller exactly as they did
-- when the four statements were separate. The only thing that changes is that
-- they now all succeed together or leave nothing behind.
--
-- Business rules stay in src/domain and are applied before the call - CGPA
-- normalisation, profile-link tidying, which marksheets are required. This
-- function decides nothing. It writes, in order, and whitelists what it will
-- write.

create or replace function submit_srf(
  p_student   jsonb,
  p_semesters jsonb,
  p_documents jsonb
)
returns table (student_id uuid, srf_status srf_status)
language plpgsql
-- INVOKER is the whole point; stated rather than left to the default so that
-- nobody "tidies" it into a definer and silently disables every guard above.
security invoker
set search_path = public
as $$
declare
  v_student_id uuid;
  v_slots      jsonb;
begin
  -- Who is calling, from the session - never from the payload. A student may
  -- send whatever they like; it can only ever submit their own form.
  v_student_id := current_student_id();

  if v_student_id is null then
    raise exception 'We could not find your student record. Contact your placement coordinator.'
      using errcode = 'no_data_found';
  end if;

  -- 1. The evidence first, so the marks below have something to point at.
  --    `student_id` is taken from the session, so a payload naming another
  --    student files nothing against them.
  with inserted as (
    insert into student_documents (student_id, kind, storage_path, size_bytes)
    select v_student_id,
           (d->>'kind')::document_kind,
           d->>'storage_path',
           (d->>'size_bytes')::int
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    returning id, storage_path
  )
  -- Marry each new row back to the slot key the form used ("tenth",
  -- "semester-3", ...), so the writes below can reference documents that did
  -- not exist when the payload was built.
  select coalesce(
           jsonb_object_agg(d->>'slot', i.id),
           '{}'::jsonb
         )
    into v_slots
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    join inserted i on i.storage_path = d->>'storage_path';

  -- 2. The student's own row. Every column is named: a field the student does
  --    not own cannot be reached from here even if the payload carries it.
  --    `roll_number`, `campus_id`, `overall_cgpa`, `srf_status` and the rest
  --    are simply absent, and the 0009 trigger remains the backstop.
  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = p_student->>'whatsapp',
    alternate_contact     = p_student->>'alternate_contact',
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = (p_student->>'tenth_percentage')::numeric,
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = (p_student->>'twelfth_percentage')::numeric,
    diploma_institution   = p_student->>'diploma_institution',
    diploma_marks         = (p_student->>'diploma_marks')::numeric,
    diploma_marks_scale   = (p_student->>'diploma_marks_scale')::marks_scale,
    diploma_marksheet_id  = (v_slots->>(p_student->>'diploma_marksheet_slot'))::uuid,
    passing_year          = (p_student->>'passing_year')::int,
    programme_level       = (p_student->>'programme_level')::programme_level,
    ug_degree             = p_student->>'ug_degree',
    ug_college            = p_student->>'ug_college',
    ug_branch             = p_student->>'ug_branch',
    ug_aggregate_declared = (p_student->>'ug_aggregate_declared')::numeric,
    ug_aggregate_scale    = (p_student->>'ug_aggregate_scale')::marks_scale,
    ug_aggregate_cgpa     = (p_student->>'ug_aggregate_cgpa')::numeric,
    ug_marksheet_id       = (v_slots->>(p_student->>'ug_marksheet_slot'))::uuid,
    technical_skills      = p_student->>'technical_skills',
    areas_of_interest     = p_student->>'areas_of_interest',
    areas_of_expertise    = p_student->>'areas_of_expertise',
    projects              = p_student->>'projects',
    certifications        = p_student->>'certifications',
    achievements          = p_student->>'achievements',
    linkedin_url          = p_student->>'linkedin_url',
    github_url            = p_student->>'github_url',
    leetcode_url          = p_student->>'leetcode_url',
    hackerrank_url        = p_student->>'hackerrank_url',
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    consent_given_at      = now(),
    srf_status            = 'srf_submitted',
    srf_submitted_at      = now(),
    -- The draft has served its purpose. Left behind, the next visit would
    -- restore a copy of a form already submitted.
    srf_draft             = null,
    srf_draft_saved_at    = null
  where id = v_student_id;

  -- 3. Semester lines, replaced wholesale: the form shows the student's whole
  --    record, so what is on screen must be what ends up stored. Merging would
  --    silently keep a line the student deleted.
  --
  --    The delete is scoped by 0027 to rows still pending, so a line a
  --    coordinator has verified survives - and the insert below then collides
  --    with it, which is the correct answer to a student trying to replace a
  --    verified mark.
  delete from student_semesters where student_semesters.student_id = v_student_id;

  -- Written AFTER the student row, because the per-level cap trigger (0017)
  -- reads programme_level from it - inserting first would size a
  -- postgraduate's record against the undergraduate limit.
  insert into student_semesters (
    student_id, semester_number, cgpa, declared_marks, marks_scale,
    current_arrears, history_of_arrears, marksheet_id
  )
  select v_student_id,
         (s->>'semester_number')::int,
         (s->>'cgpa')::numeric,
         (s->>'declared_marks')::numeric,
         (s->>'marks_scale')::marks_scale,
         (s->>'current_arrears')::int,
         (s->>'history_of_arrears')::int,
         (v_slots->>(s->>'marksheet_slot'))::uuid
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s;

  return query
    select s.id, s.srf_status from students s where s.id = v_student_id;
end;
$$;

-- Students are the only callers. Staff edit these records directly, through
-- policies written for them.
grant execute on function submit_srf(jsonb, jsonb, jsonb) to authenticated;

-- =============================================================================
-- Migration: 0029_one_campus_per_coordinator.sql
-- =============================================================================

-- A Campus Placement Coordinator is mapped to ONE campus.
--
-- Confirmed 2026-08-05: "remember that a placement coordinator is for one
-- campus alone. this has to be mapped by admin while mapping their role."
--
-- This mapping is not a label on a screen. It is the whole of a coordinator's
-- authority: `my_student_ids()` reads this table to decide whose marksheets
-- they may verify and whose registration they may approve. A second row
-- silently widens that over students who belong to another coordinator, and
-- nothing anywhere would report it.
--
-- The rule lives in `src/domain/staff.ts` and the admin screen applies it. It
-- is enforced here as well because the screen is not the only thing that can
-- write to this table - a roster fix-up, an import, or a feature written next
-- year can too, and none of them will remember this conversation.
--
-- Campus Managers and Key Account Managers genuinely span campuses, so the
-- rule is deliberately scoped to the coordinator alone.

create or replace function enforce_one_campus_per_coordinator() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select role from profiles where id = new.profile_id) = 'campus_placement_coordinator'
     and exists (
       select 1 from staff_campus_assignments
        where profile_id = new.profile_id
          and campus_id is distinct from new.campus_id
     )
  then
    raise exception
      'A placement coordinator works with one campus. Move them instead of adding a second.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- BEFORE INSERT OR UPDATE: moving a coordinator is legitimate and must keep
-- working - delete the old row, insert the new one - so only a SECOND
-- concurrent campus is refused, never a change of campus.
drop trigger if exists enforce_one_campus_per_coordinator on staff_campus_assignments;

create trigger enforce_one_campus_per_coordinator
  before insert or update on staff_campus_assignments
  for each row execute function enforce_one_campus_per_coordinator();

-- =============================================================================
-- Migration: 0030_students_read_published_drives.sql
-- =============================================================================

-- A student can read the drives that were published TO them.
--
-- Reported 2026-08-05: "even after drives are published by Central PC, they
-- are not shown to eligible students." TCS and Cognizant, both `live`, both
-- inside their application window, both targeted at exactly the campus, degree
-- and branch of three approved students who cleared every cutoff.
--
-- They were eligible. They could not SEE the row. 0008 gave `drives` five
-- policies and not one of them admits a student:
--
--   -- Students never read the drives table directly; they read a filtered view.
--   create policy drives_staff_read on drives for select using (is_org_reader());
--
-- The filtered view was never built. The drives screen queries `drives`
-- directly, and because row level security is a FILTER rather than a guard it
-- returned no rows and no error - so the page rendered a perfectly healthy
-- "no drives open to you right now". Every student has seen that since the day
-- it shipped, and nothing anywhere could have reported it.
--
-- What a student may see is deliberately coarser than what they may APPLY to.
-- R5/R6 live in `src/domain/visibility.ts`, decide the harder question with
-- reasons a student can read, and are evaluated over the rows this returns.
-- Duplicating that logic here would give a student two different answers
-- depending on which layer they asked.
create policy drives_student_read on drives for select
  using (
    current_student_id() is not null
    -- Published, in the ordinary sense: a drive still being negotiated is
    -- commercially confidential and may never happen at all. `applications_
    -- closed`, `in_rounds` and `completed` stay readable because a student
    -- who applied still needs to see what they applied to.
    and status in ('live', 'applications_closed', 'in_rounds', 'completed')
    and (
      -- An empty targeting list means ANY campus, never none - the same rule
      -- `evaluateEligibility` applies, so the two cannot disagree.
      not exists (select 1 from drive_target_campuses t where t.drive_id = drives.id)
      or exists (
        select 1
          from drive_target_campuses t
          join students s on s.id = current_student_id()
         where t.drive_id = drives.id
           and t.campus_id = s.campus_id
      )
    )
  );

-- ---------------------------------------------------------------- targeting
-- The three link tables carry the drive's targeting, and `drive_rounds` its
-- schedule. All four had row level security switched OFF entirely - no
-- policies, no protection - while 0008 grants insert and update on every table
-- in the schema to `authenticated`.
--
-- So any signed-in student could add their own branch to a drive they were not
-- eligible for, or delete the campus targeting that excluded them, and
-- eligibility would then agree with them. Nothing would have looked wrong.
--
-- They must stay READABLE by students, because eligibility is evaluated
-- against them client-side and a student is entitled to know why they do not
-- qualify.
alter table drive_target_campuses   enable row level security;
alter table drive_eligible_degrees  enable row level security;
alter table drive_eligible_branches enable row level security;
alter table drive_rounds            enable row level security;

do $$
declare
  link_table text;
  owns_drive constant text :=
    'is_operator() or current_app_role() = ''delivery_head'' or exists (
       select 1 from drives d
        where d.id = drive_id
          and current_app_role() = ''account_executive''
          and d.created_by = auth.uid())';
begin
  foreach link_table in array array[
    'drive_target_campuses', 'drive_eligible_degrees', 'drive_eligible_branches', 'drive_rounds'
  ]
  loop
    -- Anyone signed in may read the targeting. It says who a drive is for,
    -- which is the one thing a student most needs to be told.
    execute format(
      'create policy %I on %I for select using (auth.uid() is not null)',
      link_table || '_read', link_table
    );

    -- Written by the people who own the drive: the Central CPC or Admin who
    -- publishes it, the Delivery Head who approves it, and the AE who drafted
    -- it. Mirrors the `drives` write policies rather than inventing a second
    -- rule that could drift away from them.
    --
    -- Deliberately THREE policies rather than one `for all`. A `for all`
    -- policy also applies to SELECT, and since these conditions read `drives`
    -- - whose own student policy reads this table back - Postgres refuses the
    -- query outright with "infinite recursion detected in policy". Splitting
    -- the write commands out keeps the read path free of any reference to
    -- `drives`, so the cycle cannot form.
    execute format('create policy %I on %I for insert with check (%s)',
                   link_table || '_insert', link_table, owns_drive);
    execute format('create policy %I on %I for update using (%s) with check (%s)',
                   link_table || '_update', link_table, owns_drive, owns_drive);
    execute format('create policy %I on %I for delete using (%s)',
                   link_table || '_delete', link_table, owns_drive);
  end loop;
end $$;

-- Publishing REPLACES a drive's targeting - delete, then insert - so the
-- delete has to be granted or the publish screen silently keeps the old
-- targeting. 0008 grants only select, insert and update; the live database
-- happens to have `grant all` from Supabase's own setup, which is exactly the
-- drift that hid the SRF re-submission bug for a day.
grant delete on drive_target_campuses, drive_eligible_degrees,
                drive_eligible_branches, drive_rounds to authenticated;

-- =============================================================================
-- Migration: 0031_approval_verifies_semesters.sql
-- =============================================================================

-- Approving a registration form verifies the semesters it declared.
--
-- Found 2026-08-05 while fixing why published drives were invisible to
-- eligible students. All three approved students carried
-- `student_semesters.status = 'pending'`: the coordinator approved the form
-- and the semester rows never moved, because `decide()` updates the students
-- row and nothing else.
--
-- `academicStandingFrom` counts only VERIFIED semesters - §7.2 requires
-- eligibility to be evaluated against verified data. With none verified it
-- returns null, the drives view falls back to `students.overall_cgpa`, and the
-- SRF deliberately never writes that column because an overall CGPA is not the
-- student's to declare. So every approved student is judged at a CGPA of ZERO.
--
-- Both live drives set no CGPA cutoff, so nothing is wrong today. The next
-- drive that sets one - which is the ordinary case - silently excludes the
-- whole cohort, and it looks exactly like the bug just fixed: an eligible
-- student sees an empty list and nobody can say why.
--
-- Approving IS the verification. The queue puts each declared figure beside
-- the marksheet that evidences it and asks the coordinator to compare them;
-- pressing approve is them saying they did. Recording that on the rows the
-- comparison was about keeps the claim where the eligibility rules read it.

create or replace function verify_semesters_on_srf_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.srf_status = 'srf_approved' and old.srf_status is distinct from 'srf_approved' then
    update student_semesters
       set status      = 'verified',
           -- `verified_has_verifier` insists a verified line names who
           -- verified it. The decider is the coordinator who just approved;
           -- falling back to the caller covers a direct correction made
           -- without going through the queue.
           verified_by = coalesce(new.srf_decided_by, auth.uid()),
           verified_at = coalesce(new.srf_decided_at, now())
     where student_id = new.id
       and status = 'pending';
  end if;

  return new;
end;
$$;

-- SECURITY DEFINER, unlike everything else added this week, and for a specific
-- reason: `semesters_write_staff` scopes a coordinator to their own campus's
-- students via `my_student_ids()`, and this runs inside their own UPDATE on a
-- student they have already been allowed to decide. Leaving it as invoker
-- would make approval depend on a second, differently-shaped permission check
-- passing at the same moment. The trigger only ever touches the semesters of
-- the row being approved.
drop trigger if exists verify_semesters_on_srf_approval on students;

create trigger verify_semesters_on_srf_approval
  after update on students
  for each row execute function verify_semesters_on_srf_approval();

-- Students already approved before this existed.
--
-- This asserts nothing new on the coordinator's behalf. Approval is exactly
-- the claim being recorded, and `srf_decided_by` says who made it - so only
-- rows whose form was approved AND carries a decider are touched. Anything
-- else stays pending and gets checked properly.
update student_semesters ss
   set status      = 'verified',
       verified_by = s.srf_decided_by,
       verified_at = coalesce(s.srf_decided_at, now())
  from students s
 where ss.student_id = s.id
   and ss.status = 'pending'
   and s.srf_status = 'srf_approved'
   and s.srf_decided_by is not null;

-- =============================================================================
-- Migration: 0032_uat_feedback_decisions_and_pif.sql
-- =============================================================================

-- UAT 2026-08-06 ("Copy of Testing"): F1, F7, F11, F12.
--
-- F1 — "central placement coordinator should have - decline button with
-- reason. The status of approval or rejection should go to student."
--
-- Both requests could already be rejected; nothing recorded WHY. From the
-- student's side a decline was indistinguishable from the request never having
-- been read — and each request costs them a scanned, signed document. The
-- reason is therefore not optional metadata, it is the entire message.
--
-- F7 — "if its one interview process, multiple designations only one PIF is
-- required". One drive, several job titles.
--
-- F11 — the AE states how many rounds the recruiter runs, so the Central CPC
-- stops retyping the round list from an email.
--
-- F12 — "the Minimum overall CGPA must be acceptable of both percentage and
-- GPA." Two columns, deliberately: what the recruiter said, and the figure
-- every student is measured against.

-- ---------------------------------------------------------------- F1
alter table opt_out_requests
  add column if not exists decision_reason text;

alter table self_placement_requests
  add column if not exists decision_reason text;

-- `not valid`: rows decided before today were rejected without a reason field
-- existing, and refusing to migrate over history helps nobody. Everything
-- decided from now on is held to it.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'opt_out_decline_states_a_reason'
  ) then
    alter table opt_out_requests
      add constraint opt_out_decline_states_a_reason
      check (status <> 'rejected' or coalesce(btrim(decision_reason), '') <> '') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'self_placement_decline_states_a_reason'
  ) then
    alter table self_placement_requests
      add constraint self_placement_decline_states_a_reason
      check (status <> 'rejected' or coalesce(btrim(decision_reason), '') <> '') not valid;
  end if;
end $$;

comment on column opt_out_requests.decision_reason is
  'F1: shown to the student verbatim. Required to decline; it is all they are told.';
comment on column self_placement_requests.decision_reason is
  'F1: shown to the student verbatim. Required to decline; it is all they are told.';

-- ---------------------------------------------------------------- F7
alter table drives
  add column if not exists additional_designations text[] not null default '{}';

comment on column drives.additional_designations is
  'F7: other job titles covered by this ONE interview process. A second title is not a second drive.';

-- ---------------------------------------------------------------- F11
alter table drives
  add column if not exists round_count integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'drive_round_count_positive') then
    alter table drives
      add constraint drive_round_count_positive
      check (round_count is null or round_count > 0);
  end if;
end $$;

comment on column drives.round_count is
  'F11: how many rounds the recruiter runs, per the AE. Seeds the publish screen.';

-- ---------------------------------------------------------------- F12
-- `min_overall_cgpa` keeps its 0..10 check and stays the ONLY column any
-- eligibility rule reads. The declared pair sits beside it so a coordinator
-- can check the PIF against the recruiter's mail without doing arithmetic.
alter table drives
  add column if not exists min_overall_marks      numeric(5,2),
  add column if not exists min_overall_cgpa_scale marks_scale not null default 'cgpa';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'min_overall_marks_fits_its_scale') then
    alter table drives
      add constraint min_overall_marks_fits_its_scale
      check (
        min_overall_marks is null
        or (min_overall_cgpa_scale = 'cgpa'       and min_overall_marks between 0 and 10)
        or (min_overall_cgpa_scale = 'percentage' and min_overall_marks between 0 and 100)
      ) not valid;
  end if;
end $$;

-- Existing drives declared their cutoff as a CGPA, because there was no other
-- option. Saying so explicitly beats leaving the declared figure null and
-- making the publish screen guess.
update drives
   set min_overall_marks = min_overall_cgpa
 where min_overall_cgpa is not null
   and min_overall_marks is null;

comment on column drives.min_overall_marks is
  'F12: the cutoff as the recruiter stated it. min_overall_cgpa is the normalised figure R5 filters on.';

-- =============================================================================
-- Migration: 0033_drive_specific_resume.sql
-- =============================================================================

-- A resume per DRIVE, not only per role category. F14 (UAT 2026-08-06).
--
-- "Ask for a drive specific resume to be uploaded at the time of applying."
--
-- The SRF collects one resume per role category, and `one_resume_per_category`
-- (0003) enforces exactly that. It is the right rule for the PROFILE resume
-- and fatal for this one: the second software drive a student applies to would
-- hit a unique violation, and they would be told their application failed for
-- no reason they could act on.
--
-- So the index is narrowed to the profile resume - the row with no drive - and
-- a second one keeps the per-drive resumes to one each. A student re-thinking
-- their CV before the deadline replaces the row rather than accruing copies
-- nobody can tell apart.

alter table student_documents
  add column if not exists drive_id uuid references drives(id) on delete cascade;

comment on column student_documents.drive_id is
  'F14: set only on a resume uploaded for one application. NULL is the profile resume.';

-- The profile resume: still one per category, exactly as before.
drop index if exists one_resume_per_category;

create unique index one_resume_per_category
  on student_documents (student_id, role_category)
  where kind = 'resume' and drive_id is null;

-- The application resume: one per student per drive.
create unique index if not exists one_resume_per_drive
  on student_documents (student_id, drive_id)
  where kind = 'resume' and drive_id is not null;

-- A marksheet does not belong to a drive. Left unchecked, a bug elsewhere
-- would quietly delete a student's 10th marksheet when a drive was removed,
-- because of the cascade above.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'drive_document_is_a_resume') then
    alter table student_documents
      add constraint drive_document_is_a_resume
      check (drive_id is null or kind = 'resume');
  end if;
end $$;

-- =============================================================================
-- Migration: 0034_student_certificates.sql
-- =============================================================================

-- A certificate is a NAME and a DOCUMENT. F9 and F17 (UAT 2026-08-06).
--
-- F17: "The student registration form should also contain an upload button for
-- students to upload the certificates. Name of certificate + upload
-- certificate."
--
-- F9: "Currently, students can upload certificates multiple times, which
-- should be restricted to a single upload."
--
-- The SRF collected `students.certifications`, a free-text box. It is both
-- failures at once: nothing in it can be verified, and nothing in it is
-- unique. A coordinator reading "AWS Cloud Practitioner, AWS Cloud
-- Practitioner, aws cert" has no way to tell whether that is one certificate
-- or three, and no document to check any of them against.
--
-- The uniqueness lives HERE rather than on a screen, because it was a screen
-- that let the duplicates in.

alter type document_kind add value if not exists 'certificate';

create table if not exists student_certificates (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  name        text not null,
  -- NOT NULL: a name with no document is the unverifiable claim this replaces.
  document_id uuid not null references student_documents(id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint certificate_has_a_name check (btrim(name) <> '')
);

create index if not exists student_certificates_student_idx
  on student_certificates (student_id);

-- One upload per certificate, compared the way a human would compare two
-- names: case and spacing are not the difference between two certificates.
create unique index if not exists one_certificate_per_name
  on student_certificates (student_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

alter table student_certificates enable row level security;
alter table student_certificates force  row level security;

-- The student owns them; the coordinators who verify a registration form read
-- them. Mirrors the policies on student_documents, which is where the file is.
create policy student_reads_own_certificates
  on student_certificates for select
  using (student_id = current_student_id() or is_org_reader() or is_campus_staff());

create policy student_adds_own_certificates
  on student_certificates for insert
  with check (student_id = current_student_id());

-- Removing one is how a student replaces it (there is no update path: a
-- certificate whose name and document can both change is a different
-- certificate, and the audit trail should say so).
create policy student_removes_own_certificates
  on student_certificates for delete
  using (student_id = current_student_id());

grant select, insert, delete on student_certificates to authenticated;

comment on table student_certificates is
  'F17: name + document. F9: one_certificate_per_name is what stops repeat uploads.';

-- =============================================================================
-- Migration: 0035_submit_srf_with_certificates.sql
-- =============================================================================

-- Certificates travel with the form, in the SAME transaction. F9 and F17.
--
-- They cannot be a second round trip. The entire reason `submit_srf` exists
-- (0028) is that PostgREST gives every request its own transaction, and a
-- half-submitted form is worse than a failed one: a coordinator opening the
-- queue cannot see what is missing, so they verify what is in front of them.
-- A form claiming three certificates and carrying two documents is exactly
-- that failure.
--
-- The body below is 0028's, unchanged apart from the certificate block and the
-- dropped `certifications` write. It is reproduced rather than patched because
-- Postgres has no way to amend a function in place.
--
-- `students.certifications` is left in place and no longer written. Dropping a
-- column that holds real data is a separate, deliberate decision; see
-- docs/PENDING-USER-ACTION.md.

drop function if exists submit_srf(jsonb, jsonb, jsonb);

create or replace function submit_srf(
  p_student      jsonb,
  p_semesters    jsonb,
  p_documents    jsonb,
  p_certificates jsonb default '[]'::jsonb
)
returns table (student_id uuid, srf_status srf_status)
language plpgsql
-- INVOKER is the whole point; stated rather than left to the default so that
-- nobody "tidies" it into a definer and silently disables every guard above.
security invoker
set search_path = public
as $$
declare
  v_student_id uuid;
  v_slots      jsonb;
begin
  -- Who is calling, from the session - never from the payload. A student may
  -- send whatever they like; it can only ever submit their own form.
  v_student_id := current_student_id();

  if v_student_id is null then
    raise exception 'We could not find your student record. Contact your placement coordinator.'
      using errcode = 'no_data_found';
  end if;

  -- 1. The evidence first, so the marks below have something to point at.
  --    `student_id` is taken from the session, so a payload naming another
  --    student files nothing against them.
  with inserted as (
    insert into student_documents (student_id, kind, storage_path, size_bytes)
    select v_student_id,
           (d->>'kind')::document_kind,
           d->>'storage_path',
           (d->>'size_bytes')::int
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    returning id, storage_path
  )
  -- Marry each new row back to the slot key the form used ("tenth",
  -- "semester-3", ...), so the writes below can reference documents that did
  -- not exist when the payload was built.
  select coalesce(
           jsonb_object_agg(d->>'slot', i.id),
           '{}'::jsonb
         )
    into v_slots
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    join inserted i on i.storage_path = d->>'storage_path';

  -- 2. The student's own row. Every column is named: a field the student does
  --    not own cannot be reached from here even if the payload carries it.
  --    `roll_number`, `campus_id`, `overall_cgpa`, `srf_status` and the rest
  --    are simply absent, and the 0009 trigger remains the backstop.
  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = p_student->>'whatsapp',
    alternate_contact     = p_student->>'alternate_contact',
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = (p_student->>'tenth_percentage')::numeric,
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = (p_student->>'twelfth_percentage')::numeric,
    diploma_institution   = p_student->>'diploma_institution',
    diploma_marks         = (p_student->>'diploma_marks')::numeric,
    diploma_marks_scale   = (p_student->>'diploma_marks_scale')::marks_scale,
    diploma_marksheet_id  = (v_slots->>(p_student->>'diploma_marksheet_slot'))::uuid,
    passing_year          = (p_student->>'passing_year')::int,
    programme_level       = (p_student->>'programme_level')::programme_level,
    ug_degree             = p_student->>'ug_degree',
    ug_college            = p_student->>'ug_college',
    ug_branch             = p_student->>'ug_branch',
    ug_aggregate_declared = (p_student->>'ug_aggregate_declared')::numeric,
    ug_aggregate_scale    = (p_student->>'ug_aggregate_scale')::marks_scale,
    ug_aggregate_cgpa     = (p_student->>'ug_aggregate_cgpa')::numeric,
    ug_marksheet_id       = (v_slots->>(p_student->>'ug_marksheet_slot'))::uuid,
    technical_skills      = p_student->>'technical_skills',
    areas_of_interest     = p_student->>'areas_of_interest',
    areas_of_expertise    = p_student->>'areas_of_expertise',
    projects              = p_student->>'projects',
    achievements          = p_student->>'achievements',
    linkedin_url          = p_student->>'linkedin_url',
    github_url            = p_student->>'github_url',
    leetcode_url          = p_student->>'leetcode_url',
    hackerrank_url        = p_student->>'hackerrank_url',
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    consent_given_at      = now(),
    srf_status            = 'srf_submitted',
    srf_submitted_at      = now(),
    -- The draft has served its purpose. Left behind, the next visit would
    -- restore a copy of a form already submitted.
    srf_draft             = null,
    srf_draft_saved_at    = null
  where id = v_student_id;

  -- 3. Semester lines, replaced wholesale: the form shows the student's whole
  --    record, so what is on screen must be what ends up stored. Merging would
  --    silently keep a line the student deleted.
  --
  --    The delete is scoped by 0027 to rows still pending, so a line a
  --    coordinator has verified survives - and the insert below then collides
  --    with it, which is the correct answer to a student trying to replace a
  --    verified mark.
  delete from student_semesters where student_semesters.student_id = v_student_id;

  -- Written AFTER the student row, because the per-level cap trigger (0017)
  -- reads programme_level from it - inserting first would size a
  -- postgraduate's record against the undergraduate limit.
  insert into student_semesters (
    student_id, semester_number, cgpa, declared_marks, marks_scale,
    current_arrears, history_of_arrears, marksheet_id
  )
  select v_student_id,
         (s->>'semester_number')::int,
         (s->>'cgpa')::numeric,
         (s->>'declared_marks')::numeric,
         (s->>'marks_scale')::marks_scale,
         (s->>'current_arrears')::int,
         (s->>'history_of_arrears')::int,
         (v_slots->>(s->>'marksheet_slot'))::uuid
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s;

  -- 4. Certificates, replaced wholesale for the same reason as the semester
  --    lines: the form shows the student's whole list, so merging would
  --    silently keep one they had deleted. `one_certificate_per_name` (0034)
  --    then refuses a payload naming the same certificate twice - F9,
  --    enforced where no screen can forget it.
  delete from student_certificates where student_certificates.student_id = v_student_id;

  insert into student_certificates (student_id, name, document_id)
  select v_student_id,
         c->>'name',
         (v_slots->>(c->>'document_slot'))::uuid
    from jsonb_array_elements(coalesce(p_certificates, '[]'::jsonb)) as c;

  return query
    select s.id, s.srf_status from students s where s.id = v_student_id;
end;
$$;

-- Students are the only callers. Staff edit these records directly, through
-- policies written for them.
grant execute on function submit_srf(jsonb, jsonb, jsonb, jsonb) to authenticated;

comment on column students.certifications is
  'SUPERSEDED by student_certificates (0034). No longer written: free text could be neither verified nor de-duplicated - F9/F17, UAT 2026-08-06.';

-- =============================================================================
-- Migration: 0036_campus_programmes.sql
-- =============================================================================

-- A programme belongs to a COLLEGE and a YEAR OF PASSING. F6 (UAT 2026-08-06).
--
-- "A separate page for degree and branches is not required for the admin. This
-- is always mapped to colleges for a particular year of Passing. Degree+Branch
-- is one field. This can be added or edited later under the colleges created.
-- Students can just select this from a drop down while filling the form."
--
-- `degrees` and `branches` were a global catalogue with no owner and no year.
-- Two consequences, both live:
--
--   * an Admin adding "AI and DS" added it for EVERY college, so a student at
--     a college that has never run it could select it and then be judged
--     eligible for drives targeting it;
--   * a branch that stopped running in 2026 was still offered to the 2028
--     cohort, because nothing recorded which year a programme belonged to.
--
-- The catalogue tables stay: they are referenced by `students`, by the drive
-- targeting tables and by the roster import, and normalising the names in one
-- place is still right. What changes is that a college now says which of them
-- it actually runs, and for whom.

create table if not exists campus_programmes (
  id           uuid primary key default gen_random_uuid(),
  campus_id    uuid not null references campuses(id) on delete cascade,
  degree_id    uuid not null references degrees(id)  on delete restrict,
  -- Nullable: an MBA has no branches, and demanding one would force an Admin
  -- to invent a name that then appears in a student's dropdown.
  branch_id    uuid references branches(id) on delete restrict,
  passing_year integer not null,
  created_at   timestamptz not null default now(),

  -- ⚠️ ASSUMPTION — UNCONFIRMED (A34). Wide enough for a cohort that graduated
  -- five years ago and one that starts next year; narrow enough to refuse a
  -- typo like 2072. Mirrors src/domain/programmes.ts.
  constraint passing_year_is_plausible check (passing_year between 2015 and 2100)
);

-- One row per cohort: the same branch NEXT year is a different cohort and is
-- allowed, the same branch twice in one year is a duplicate in a dropdown.
create unique index if not exists one_programme_per_campus_year
  on campus_programmes (campus_id, degree_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), passing_year);

create index if not exists campus_programmes_campus_idx
  on campus_programmes (campus_id, passing_year);

/**
 * A branch belongs to exactly one degree, so a row naming both must agree.
 *
 * Without this, "B.E + Finance" is storable, appears in the student's dropdown
 * as a real option, and lands on their record — where every eligibility rule
 * then reads a degree and a branch that never went together.
 */
create or replace function branch_belongs_to_the_degree() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.branch_id is not null
     and not exists (
       select 1 from branches
        where id = new.branch_id and degree_id = new.degree_id
     ) then
    raise exception 'branch_belongs_to_the_degree: that branch is not part of that degree'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists campus_programme_branch_matches on campus_programmes;
create trigger campus_programme_branch_matches
  before insert or update on campus_programmes
  for each row execute function branch_belongs_to_the_degree();

alter table campus_programmes enable row level security;
alter table campus_programmes force  row level security;

-- Everyone signed in may READ it: a student needs the dropdown, and staff need
-- to know what a college runs before they target a drive at it.
create policy anyone_reads_campus_programmes
  on campus_programmes for select
  using (auth.uid() is not null);

-- Only an Admin maintains it, under the college (F6). Three separate commands
-- rather than `for all`, which would also cover SELECT and silently narrow the
-- read policy above to Admins only.
create policy admin_adds_campus_programmes
  on campus_programmes for insert with check (is_admin());

create policy admin_edits_campus_programmes
  on campus_programmes for update using (is_admin()) with check (is_admin());

create policy admin_removes_campus_programmes
  on campus_programmes for delete using (is_admin());

grant select, insert, update, delete on campus_programmes to authenticated;

/**
 * The backfill. WITHOUT THIS, 0036 IS AN OUTAGE.
 *
 * `campus_programmes` starts empty, and the registration form now offers only
 * what it contains. So the moment this migration lands, every student already
 * on the roster opens their form and finds no degree to select - blocked, on a
 * form they may be halfway through, because a table that did not exist until
 * now has nothing in it.
 *
 * Their college has been running their programme for years. Every distinct
 * (campus, degree, branch, passing year) on the roster IS, by definition,
 * something that college runs, so that is where the seed comes from.
 *
 * A FUNCTION rather than a bare INSERT, for two reasons: it is testable
 * against a seeded database (a bare statement in a migration runs once, on an
 * empty schema, and proves nothing), and it is idempotent, so an Admin can run
 * it again after importing a new roster without creating duplicates.
 */
create or replace function backfill_campus_programmes() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_added integer;
begin
  insert into campus_programmes (campus_id, degree_id, branch_id, passing_year)
  select distinct s.campus_id, s.degree_id, s.branch_id, s.passing_year
    from students s
   where s.campus_id is not null
     and s.degree_id is not null
     -- The plausible range is the table's own (A34); a roster row outside it
     -- is bad data, and importing it here would just move the problem.
     and s.passing_year between 2015 and 2100
  on conflict do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- Run once, now, as part of the same migration. A backfill that only a human
-- remembers to run is not a backfill.
select backfill_campus_programmes();

comment on function backfill_campus_programmes is
  'F6: seeds campus_programmes from the roster. Idempotent - safe after any roster import.';

comment on table campus_programmes is
  'F6: degree+branch is one choice, and it belongs to a college for a passing year.';

-- =============================================================================
-- Migration: 0037_skill_repository.sql
-- =============================================================================

-- The Central Student Skill Repository (PRD §5). Asked for on 2026-08-06:
-- "add some skillsets to respective students on areas such as Aptitude,
-- Communication skills, Fundamentals of Programming, Data Structures and
-- Algorithms, GIT Hub strength, Programming skills, AI skills, AI assisted
-- Full stack development etc., more can be added. Central PC should be able
-- to add these fields and edit them."
--
-- Two tables, not columns on students: the areas are a catalogue the Central
-- CPC extends at will ("more can be added"), and a catalogue-as-columns needs
-- a migration per skill. These scores later feed shortlisting (R11), which is
-- why every write is audited and why a student can never read them — an
-- internal assessment that leaks is an internal shortlist that leaks.
--
-- ⚠️ ASSUMPTION — UNCONFIRMED (A35, refines A12): a score is 0–100 with at
-- most two decimals. Mirrored by parseSkillScore in src/domain/skills.ts.
-- ⚠️ ASSUMPTION — UNCONFIRMED (A36): students do not see their own scores.

-- 0003's placeholder dies with this migration. It said so itself: "the exact
-- score schema is still pending from the business" — this request IS that
-- schema arriving. Nothing has ever written a row to it (there is no write
-- path in the app and none in production), and only the shortlisting view
-- read it; that view now reads the tables below. Two parallel skill tables
-- would drift, and a drifted score decides a shortlist.
drop table skill_scores;

create table skill_areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),

  constraint skill_area_has_a_name check (btrim(name) <> '')
);

-- One area per name, compared the way a human would: case and spacing are
-- not the difference between two skills. Mirrors skillAreaKey() in
-- src/domain/skills.ts — the two must not drift.
create unique index one_skill_area_per_name
  on skill_areas (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

-- The areas asked for, verbatim (spelling normalised). Seeds, not a limit.
insert into skill_areas (name) values
  ('Aptitude'),
  ('Communication skills'),
  ('Fundamentals of Programming'),
  ('Data Structures and Algorithms'),
  ('GitHub strength'),
  ('Programming skills'),
  ('AI skills'),
  ('AI-assisted Full Stack Development');

create table student_skill_scores (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  -- Removing an area removes its scores: a score with no area is a number
  -- with no meaning, and keeping it would feed a ghost into shortlisting.
  skill_area_id uuid not null references skill_areas(id) on delete cascade,
  score         numeric(5,2) not null,
  recorded_by   uuid references profiles(id),
  recorded_at   timestamptz not null default now(),

  constraint score_within_scale check (score >= 0 and score <= 100),
  -- One score per student per area: a re-assessment REPLACES, it never
  -- accumulates. The history lives in the audit log, where it belongs.
  constraint one_score_per_student_per_area unique (student_id, skill_area_id)
);

create index student_skill_scores_student_idx on student_skill_scores (student_id);
create index student_skill_scores_area_idx    on student_skill_scores (skill_area_id);

alter table skill_areas          enable row level security;
alter table skill_areas          force  row level security;
alter table student_skill_scores enable row level security;
alter table student_skill_scores force  row level security;

-- The catalogue: staff-wide read (a campus CPC discussing a student's scores
-- must see the same column names the Central CPC scored under); writes are
-- the operator's (admin + Central CPC — is_operator(), 0008).
create policy skill_areas_staff_read on skill_areas for select
  using (is_org_reader() or is_campus_reader());

create policy skill_areas_operator_insert on skill_areas for insert
  with check (is_operator());
create policy skill_areas_operator_update on skill_areas for update
  using (is_operator()) with check (is_operator());
create policy skill_areas_operator_delete on skill_areas for delete
  using (is_operator());

-- Scores: org-wide roles read everything; campus roles read their own
-- students only (the 0018 pattern — an unscoped read here would un-scope the
-- campus scoping of students, exactly the hole 0018 closed). Students read
-- NOTHING: A36, these are internal assessments feeding an internal shortlist.
create policy skill_scores_staff_read on student_skill_scores for select
  using (is_org_reader() or (is_campus_reader() and student_id in (select my_student_ids())));

create policy skill_scores_operator_insert on student_skill_scores for insert
  with check (is_operator());
create policy skill_scores_operator_update on student_skill_scores for update
  using (is_operator()) with check (is_operator());
create policy skill_scores_operator_delete on student_skill_scores for delete
  using (is_operator());

grant select, insert, update, delete on skill_areas          to authenticated;
grant select, insert, update, delete on student_skill_scores to authenticated;

-- Every write audited (PRD §19): these numbers decide who reaches a
-- recruiter, so "who changed this score, from what, to what, when" must be
-- answerable. audit_row() reads new/old 'id' generically.
create trigger audit_skill_scores
  after insert or update or delete on student_skill_scores
  for each row execute function audit_row();

comment on table skill_areas is
  'PRD §5: the catalogue of institutional skill areas. Seeded; Central CPC extends it.';
comment on table student_skill_scores is
  'PRD §5: one institutional score per student per area, 0-100 (A35). Feeds R11 shortlisting. Internal-only (A36).';

-- =============================================================================
-- Migration: 0038_certificate_verification.sql
-- =============================================================================

-- A certificate is verified by the coordinator, like a CGPA. Asked for
-- 2026-08-06: "skill certifications uploaded by students will also need
-- verification of campus placement coordinator similar to CGPA approval. This
-- is applicable for first upload as well as subsequent additions."
--
-- 0034 stored a name and a document and stopped there. Nothing recorded
-- whether anybody had ever opened the file, so a recruiter reading a profile
-- could not tell a checked certificate from a claim typed a minute earlier -
-- and the coordinator had no screen on which to check one.
--
-- Decided PER CERTIFICATE, not folded into the registration form's approval
-- the way semesters are (0031). A certificate can arrive at any time: the
-- profile page has accepted one since F20, including the day after approval.
-- Verifying at approval would have left every later upload with no path at
-- all, and "subsequent additions" is half the request.

alter table student_certificates
  add column status           verification_status not null default 'pending',
  add column verified_by      uuid references profiles(id),
  add column verified_at      timestamptz,
  add column rejection_reason text;

-- Mirrors student_semesters' own `verified_has_verifier`: a verified claim
-- must name who made it, or the audit trail cannot answer "who checked this".
alter table student_certificates
  add constraint certificate_verified_has_verifier
    check (status <> 'verified' or verified_by is not null);

-- F1's rule, and for the same reason: the reason is the only thing the
-- student is told, so a rejection without one is not a decision they can act
-- on. `btrim` because a space is not a reason.
alter table student_certificates
  add constraint certificate_rejected_has_reason
    check (status <> 'rejected' or btrim(coalesce(rejection_reason, '')) <> '');

create index student_certificates_pending_idx
  on student_certificates (status) where status = 'pending';

-- Existing certificates are unverified claims - nobody has ever checked one,
-- because until now there was nowhere to do it. `pending` is the honest
-- default and puts them all in the queue, which is what was asked for.

-- The decision itself. Campus staff for their own students, operators
-- org-wide; the same shape as every other student-scoped write (0018).
create policy staff_decides_certificates
  on student_certificates for update
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));

-- 0034 granted select/insert/delete only, so verification was not merely
-- unpoliced - it was ungranted. A policy alone would still have failed.
grant update on student_certificates to authenticated;

-- Q4 applied to certificates: verified data is not the student's to remove.
-- Deleting one would also destroy the coordinator's record of having checked
-- it. A rejected one they may remove - that is how a replacement is made.
drop policy student_removes_own_certificates on student_certificates;

create policy student_removes_own_certificates
  on student_certificates for delete
  using (student_id = current_student_id() and status <> 'verified');

-- 0034 never audited this table. A verification is a claim a named person
-- made about a document, which is exactly what PRD §19 exists to record.
create trigger audit_certificates
  after insert or update or delete on student_certificates
  for each row execute function audit_row();

comment on column student_certificates.status is
  'Verified by the campus coordinator, like a CGPA (2026-08-06). Applies to the first upload and every later one.';

-- ---------------------------------------------------------------------------
-- submit_srf, around a verified certificate.
--
-- 0035 replaced the certificate list wholesale: delete everything, insert the
-- payload. Both halves break the moment a certificate can be verified.
--
--   1. The delete would destroy the coordinator's decision. The new delete
--      policy stops the student's own DELETE, but this function is SECURITY
--      INVOKER, so it would simply match nothing - RLS is a filter, not an
--      error.
--   2. The insert would then re-declare that same certificate and collide
--      with `one_certificate_per_name`, raising 23505 and failing the WHOLE
--      submission.
--
-- (2) is not hypothetical. It is precisely what made the SRF unsubmittable
-- for every student before 0027: an RLS-filtered delete matching nothing,
-- followed by a unique violation with no visible cause. Eight 409s in the
-- edge logs and one useless "please try again" on screen.
--
-- So: delete only what is still undecided, and insert only what is not
-- already on file. A verified certificate survives a re-submission untouched,
-- and re-declaring it is a no-op rather than a failure.
--
-- This deliberately differs from the semester lines a few statements above,
-- where the collision IS the answer. A semester is only ever verified at
-- approval, after which the form is read-only, so a verified line and a
-- re-submission cannot co-occur. A certificate is verified on its own
-- schedule, so they co-occur constantly.
--
-- The body is 0035's, unchanged apart from the certificate block. Reproduced
-- rather than patched because Postgres cannot amend a function in place.
-- ---------------------------------------------------------------------------

create or replace function submit_srf(
  p_student      jsonb,
  p_semesters    jsonb,
  p_documents    jsonb,
  p_certificates jsonb default '[]'::jsonb
)
returns table (student_id uuid, srf_status srf_status)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_student_id uuid;
  v_slots      jsonb;
begin
  v_student_id := current_student_id();

  if v_student_id is null then
    raise exception 'We could not find your student record. Contact your placement coordinator.'
      using errcode = 'no_data_found';
  end if;

  with inserted as (
    insert into student_documents (student_id, kind, storage_path, size_bytes)
    select v_student_id,
           (d->>'kind')::document_kind,
           d->>'storage_path',
           (d->>'size_bytes')::int
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    returning id, storage_path
  )
  select coalesce(jsonb_object_agg(d->>'slot', i.id), '{}'::jsonb)
    into v_slots
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    join inserted i on i.storage_path = d->>'storage_path';

  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = p_student->>'whatsapp',
    alternate_contact     = p_student->>'alternate_contact',
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = (p_student->>'tenth_percentage')::numeric,
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = (p_student->>'twelfth_percentage')::numeric,
    diploma_institution   = p_student->>'diploma_institution',
    diploma_marks         = (p_student->>'diploma_marks')::numeric,
    diploma_marks_scale   = (p_student->>'diploma_marks_scale')::marks_scale,
    diploma_marksheet_id  = (v_slots->>(p_student->>'diploma_marksheet_slot'))::uuid,
    passing_year          = (p_student->>'passing_year')::int,
    programme_level       = (p_student->>'programme_level')::programme_level,
    ug_degree             = p_student->>'ug_degree',
    ug_college            = p_student->>'ug_college',
    ug_branch             = p_student->>'ug_branch',
    ug_aggregate_declared = (p_student->>'ug_aggregate_declared')::numeric,
    ug_aggregate_scale    = (p_student->>'ug_aggregate_scale')::marks_scale,
    ug_aggregate_cgpa     = (p_student->>'ug_aggregate_cgpa')::numeric,
    ug_marksheet_id       = (v_slots->>(p_student->>'ug_marksheet_slot'))::uuid,
    technical_skills      = p_student->>'technical_skills',
    areas_of_interest     = p_student->>'areas_of_interest',
    areas_of_expertise    = p_student->>'areas_of_expertise',
    projects              = p_student->>'projects',
    achievements          = p_student->>'achievements',
    linkedin_url          = p_student->>'linkedin_url',
    github_url            = p_student->>'github_url',
    leetcode_url          = p_student->>'leetcode_url',
    hackerrank_url        = p_student->>'hackerrank_url',
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    consent_given_at      = now(),
    srf_status            = 'srf_submitted',
    srf_submitted_at      = now(),
    srf_draft             = null,
    srf_draft_saved_at    = null
  where id = v_student_id;

  delete from student_semesters where student_semesters.student_id = v_student_id;

  insert into student_semesters (
    student_id, semester_number, cgpa, declared_marks, marks_scale,
    current_arrears, history_of_arrears, marksheet_id
  )
  select v_student_id,
         (s->>'semester_number')::int,
         (s->>'cgpa')::numeric,
         (s->>'declared_marks')::numeric,
         (s->>'marks_scale')::marks_scale,
         (s->>'current_arrears')::int,
         (s->>'history_of_arrears')::int,
         (v_slots->>(s->>'marksheet_slot'))::uuid
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s;

  -- Certificates. Only the undecided ones are the student's to replace.
  delete from student_certificates
   where student_certificates.student_id = v_student_id
     and student_certificates.status <> 'verified';

  -- Only what is not already on file. Compared exactly as
  -- `one_certificate_per_name` compares it, so the guard and the check can
  -- never disagree about whether two names are the same certificate.
  insert into student_certificates (student_id, name, document_id)
  select v_student_id,
         c->>'name',
         (v_slots->>(c->>'document_slot'))::uuid
    from jsonb_array_elements(coalesce(p_certificates, '[]'::jsonb)) as c
   where lower(regexp_replace(btrim(c->>'name'), '\s+', ' ', 'g')) not in (
           select lower(regexp_replace(btrim(sc.name), '\s+', ' ', 'g'))
             from student_certificates sc
            where sc.student_id = v_student_id
         );

  return query
    select s.id, s.srf_status from students s where s.id = v_student_id;
end;
$$;

grant execute on function submit_srf(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- =============================================================================
-- Migration: 0039_approval_verifies_certificates.sql
-- =============================================================================

-- Approving a registration form also confirms the certificates that came with
-- it. Asked for 2026-08-06, after A37 was put to the client:
--
--   "make approving the registration form also confirm the certificates that
--    came with it, and keep the standing queue for later uploads."
--
-- This SUPERSEDES half of A37. 0038 made every certificate a separate
-- decision, so a coordinator processing a new student did two jobs: approve
-- the form, then work through that student's certificates one at a time. The
-- initial batch now rides along with the approval, exactly as the semester
-- lines have since 0031. Anything uploaded afterwards still lands `pending`
-- and still goes to /cpc/certificates - that is the "standing queue" half,
-- and it is what makes a certificate earned in the final semester verifiable
-- at all.
--
-- 🔴 THE CONDITION THIS DEPENDS ON, stated because it is the whole risk:
-- approval may only verify these rows because the verification queue now puts
-- each certificate NEXT TO ITS DOCUMENT, the way it already does for semester
-- marksheets. That screen change ships WITH this migration, not after it.
-- Without it, one click would certify files the coordinator was never shown -
-- which is precisely the hole that made semester verification meaningless
-- before 0023, and the reason this was pushed back on before being built.
--
-- Deliberately NOT swept up:
--   * a certificate already REJECTED - a coordinator looked at it and refused
--     it, and an approval elsewhere on the form must not quietly reverse that
--   * a certificate already VERIFIED - nothing to do, and re-stamping it would
--     rewrite who checked it
--   * anybody else's certificates
--
-- Modelled on verify_semesters_on_srf_approval (0031), including SECURITY
-- DEFINER and for the same reason: `staff_decides_certificates` scopes a
-- coordinator to their own campus via my_student_ids(), and this runs inside
-- their own UPDATE on a student they have already been allowed to decide.
-- Leaving it INVOKER would make approval depend on a second, differently
-- shaped permission check passing at the same instant. The trigger only ever
-- touches certificates belonging to the row being approved.

create or replace function verify_certificates_on_srf_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.srf_status = 'srf_approved' and old.srf_status is distinct from 'srf_approved' then
    update student_certificates
       set status      = 'verified',
           -- `certificate_verified_has_verifier` (0038) insists a verified
           -- certificate names who verified it. The decider is the
           -- coordinator who just approved; falling back to the caller covers
           -- a correction made directly rather than through the queue.
           verified_by = coalesce(new.srf_decided_by, auth.uid()),
           verified_at = coalesce(new.srf_decided_at, now())
     where student_id = new.id
       and status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists verify_certificates_on_srf_approval on students;

create trigger verify_certificates_on_srf_approval
  after update on students
  for each row execute function verify_certificates_on_srf_approval();

-- No backfill. Production holds zero certificates (checked before 0038
-- shipped), so there is nothing to sweep up - and retro-verifying a
-- certificate on a coordinator's behalf would assert they had checked a
-- document they were never shown, which is the one thing this migration's
-- comment above refuses to do.

comment on function verify_certificates_on_srf_approval is
  'Approving an SRF confirms the certificates submitted with it (2026-08-06). Later uploads stay pending for /cpc/certificates.';

-- =============================================================================
-- Migration: 0040_one_email_one_person.sql
-- =============================================================================

-- One email identifies one person. Asked for 2026-08-06:
-- "can you block an email id from being entered twice? student + student as
--  well as student+staff"
--
-- This is P8's ROOT CAUSE, not a tidiness rule. `sainaveen@faceprep.in` was on
-- the student roster AND held a staff profile, on one Google account. Everyone
-- signs in with their address, so that is one identity wearing two hats, and
-- `protect_verified_academics` (0009) identifies a student by exactly that
-- address. The result: the only campus placement coordinator could not approve
-- ANY registration form, and had the certificate feature been used by them,
-- they could have verified their own.
--
-- Two separate gaps are closed here.
--
--   1. student-vs-student was already `unique` (0003) but CASE-SENSITIVE, so
--      `Priya@gmail.com` and `priya@gmail.com` were two different people to
--      Postgres and one person to Google. Same for profiles and invitations.
--   2. student-vs-staff was not checked anywhere at all.
--
-- 🔴 A staff INVITATION and the PROFILE it becomes are ONE person, not two.
-- That pair is the normal state of every staff member - all six in production
-- have it - so the cross-table rule deliberately compares students against
-- staff, and never staff against staff.
--
-- Checked against production before writing this: 0 non-canonical addresses,
-- 0 case-duplicates in any of the three tables, 0 student/staff overlap. So
-- there is nothing to backfill and no existing row these constraints break.

-- ---------------------------------------------------------------------------
-- 1. Canonical storage. Identity is the normalised address, so that is what
--    gets stored - otherwise the row read back differs from the row matched.
-- ---------------------------------------------------------------------------
create or replace function normalise_email() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

create trigger normalise_student_email
  before insert or update of email on students
  for each row execute function normalise_email();

create trigger normalise_profile_email
  before insert or update of email on profiles
  for each row execute function normalise_email();

create trigger normalise_invitation_email
  before insert or update of email on staff_invitations
  for each row execute function normalise_email();

-- ---------------------------------------------------------------------------
-- 2. Case-insensitive uniqueness within each table.
--
--    The existing `unique` columns stay: they are a subset of these, and
--    dropping a constraint to replace it with a weaker-looking index is how
--    a window gets left open during a migration.
-- ---------------------------------------------------------------------------
create unique index one_person_per_email_students    on students           (lower(btrim(email)));
create unique index one_person_per_email_profiles    on profiles           (lower(btrim(email)));
create unique index one_person_per_email_invitations on staff_invitations  (lower(btrim(email)));

-- ---------------------------------------------------------------------------
-- 3. A student and a staff member are different people.
--
--    Postgres cannot express this as a constraint - it spans tables - so it is
--    a trigger on each side. Both raise `unique_violation` (23505) so the
--    application layer can treat it exactly like any other duplicate.
-- ---------------------------------------------------------------------------
create or replace function refuse_staff_email_for_student() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from profiles p where lower(btrim(p.email)) = new.email)
     or exists (select 1 from staff_invitations i where lower(btrim(i.email)) = new.email)
  then
    raise exception
      '% is already a staff account. One person is either a student or staff, never both.', new.email
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

create or replace function refuse_student_email_for_staff() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from students s where lower(btrim(s.email)) = new.email) then
    raise exception
      '% is already on the student roster. One person is either a student or staff, never both.', new.email
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

-- AFTER the normalising trigger, so `new.email` is already canonical when
-- compared. Trigger order within the same timing is alphabetical, and
-- `normalise_*` sorts before `refuse_*` on every one of these tables - stated
-- because it is load-bearing and silent if it ever stops being true.
create trigger refuse_staff_email_for_student
  before insert or update of email on students
  for each row execute function refuse_staff_email_for_student();

create trigger refuse_student_email_for_staff_profile
  before insert or update of email on profiles
  for each row execute function refuse_student_email_for_staff();

create trigger refuse_student_email_for_staff_invitation
  before insert or update of email on staff_invitations
  for each row execute function refuse_student_email_for_staff();

comment on function refuse_staff_email_for_student is
  'P8 root cause (2026-08-06): one address is one identity, because sign-in is by address.';

-- =============================================================================
-- Migration: 0041_apply_gates.sql
-- =============================================================================

-- 0041 — The apply gate, enforced in the database; self-placed offers join
-- the ladder (D5/D6, confirmed 2026-08-12).
--
-- Until now the category ladder ran only in the browser — and not even there,
-- because the offers select named a column that does not exist and the error
-- was swallowed. applications_insert_self checked only "it is your own
-- student id", so one crafted POST could apply anywhere. The gates below are
-- the ones that protect OTHER people's opportunities; academic eligibility
-- (R2) stays a Layer 0 decision surfaced in the UI.

-- ---------------------------------------------------------------- offers
-- D6: the approving coordinator must classify a self-placed offer. 0014
-- relaxed this so a self-placed offer could arrive without a category; now
-- that self-placed offers climb the ladder (D5), an unclassified one would
-- hold no rung and block nothing. Restores 0006's original rule.
--
-- One live row predates this rule (checked at push time, 2026-08-12, the
-- hard way: the constraint refused it): a self-placed offer at Rs 3.50 LPA
-- with no category. Backfilled from the default bands (R1,
-- src/domain/offer-category.ts): <=5 regular, <=10 dream, else super_dream.
-- Rs 3.50 is unambiguously regular. Flagged for coordinator review in
-- docs/PENDING-USER-ACTION.md - changing it is one UPDATE.
update offers
   set offer_category = case
         when ctc_lpa <= 5 then 'regular'
         when ctc_lpa <= 10 then 'dream'
         else 'super_dream'
       end::offer_category
 where drive_type <> 'internship' and offer_category is null;

alter table offers drop constraint ladder_offer_has_category;

alter table offers add constraint ladder_offer_has_category
  check (drive_type = 'internship' or offer_category is not null);

-- ------------------------------------------------------------ the gate
create or replace function enforce_application_gates() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d drives%rowtype;
  s students%rowtype;
  highest_rank integer;
  drive_rank   integer;
begin
  -- Positive identification, like protect_verified_academics (0009): the
  -- gate binds STUDENTS. A trusted server context (imports, backfills) does
  -- not resolve to a student and passes through; a student can never reach
  -- this trigger unidentified because applications_insert_self already
  -- requires student_id = current_student_id().
  if current_student_id() is null then
    return new;
  end if;

  select * into d from drives where id = new.drive_id;

  if d.status <> 'live' then
    raise exception 'This drive is not open.' using errcode = 'check_violation';
  end if;

  if d.application_start is null or d.application_end is null
     or now() < d.application_start or now() > d.application_end then
    raise exception 'The application window for this drive is closed.'
      using errcode = 'check_violation';
  end if;

  select * into s from students where id = new.student_id;

  if s.srf_status <> 'srf_approved' then
    raise exception 'Your registration form has not been approved yet.'
      using errcode = 'check_violation';
  end if;

  if s.participation_status <> 'active' then
    raise exception 'You have opted out of campus placements or are not currently eligible.'
      using errcode = 'check_violation';
  end if;

  -- Targeting: a drive aimed at specific campuses is closed to the rest.
  -- No rows means targeted at nobody, i.e. open (same reading as R2/0030).
  if exists (select 1 from drive_target_campuses where drive_id = d.id)
     and not exists (select 1 from drive_target_campuses
                      where drive_id = d.id and campus_id = s.campus_id) then
    raise exception 'This drive is not open to your campus.'
      using errcode = 'check_violation';
  end if;

  -- R5a: the override bypasses the cap and the ladder — never the gates above.
  if d.open_to_all_override then
    return new;
  end if;

  -- R4 — the internship cap, checked BEFORE the ladder (decision Q2).
  -- D5: a self-placed internship consumes it too, so no source filter.
  if d.drive_type in ('internship', 'internship_convertible') and exists (
       select 1 from offers o
        where o.student_id = new.student_id
          and o.drive_type in ('internship', 'internship_convertible')
     ) then
    raise exception 'You have already accepted an internship offer.'
      using errcode = 'check_violation';
  end if;

  -- R3/R5 — the ladder. Rank mirrors offerCategoryRank in
  -- src/domain/offer-category.ts; change both or neither.
  if d.drive_type in ('placement', 'internship_convertible')
     and d.offer_category is not null then
    select max(case o.offer_category
                 when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
               end)
      into highest_rank
      from offers o
     where o.student_id = new.student_id
       and o.drive_type in ('placement', 'internship_convertible')
       and o.offer_category is not null;

    drive_rank := case d.offer_category
                    when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
                  end;

    if highest_rank is not null and drive_rank <= highest_rank then
      raise exception
        'You are already placed at this category or higher, so this drive is not open to you.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_application_gates
  before insert on applications
  for each row execute function enforce_application_gates();

-- =============================================================================
-- Migration: 0042_verification_is_campus_cpc_only.sql
-- =============================================================================

-- 0042 — Verification belongs to the campus placement coordinator alone (D3,
-- confirmed 2026-08-12).
--
-- "Certificate verification, student verification will only be done by the
-- campus placement coordinator. It will not be done by the Central PC."
--
-- The Central CPC (and the is_operator() umbrella generally) ran both queues
-- while the campus seat was empty. The seat is filled now, and the client
-- keeps it that way. Accepted consequence, recorded in the approved spec: if
-- the seat is ever empty, verification HALTS until an Admin fills it. That is
-- the client's stated preference over a quiet fallback that erodes the rule.

-- ------------------------------------------------- registration decisions
-- A trigger rather than a policy: the is_operator() write policy on students
-- covers many legitimate central-CPC writes (participation, disbarment), so
-- narrowing THE DECISION needs to name the decision, not the table.
create or replace function verification_is_campus_cpc_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Trusted server context (migrations, service role). Real coordinator
  -- requests always carry a JWT.
  if auth.uid() is null then
    return new;
  end if;

  if new.srf_status is distinct from old.srf_status
     and new.srf_status in ('srf_approved', 'srf_rejected')
     and current_app_role() is distinct from 'campus_placement_coordinator' then
    raise exception
      'Registration forms are verified by the campus placement coordinator.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger verification_is_campus_cpc_only
  before update on students
  for each row execute function verification_is_campus_cpc_only();

-- ---------------------------------------------------- certificate decisions
-- 0038 let operators decide org-wide. Now: the campus coordinator, for their
-- own campus's students, and nobody else. RLS is a filter, so a central CPC's
-- UPDATE simply matches nothing — same shape as every other refused write.
drop policy staff_decides_certificates on student_certificates;

create policy campus_cpc_decides_certificates
  on student_certificates for update
  using (
    current_app_role() = 'campus_placement_coordinator'
    and student_id in (select my_student_ids())
  )
  with check (
    current_app_role() = 'campus_placement_coordinator'
    and student_id in (select my_student_ids())
  );

-- =============================================================================
-- Migration: 0043_rounds_reach_the_student.sql
-- =============================================================================

-- 0043 — the shortlist reaches the student; the round tables are locked down.
-- D7/D8/D9, confirmed 2026-08-12.
--
-- Three things in one migration because they are one story:
--
-- 1. round_participants, round_results, attendance, recruiter_exports and
--    email_deliveries had NO RLS AT ALL, while 0008 grants insert/update on
--    every table to authenticated — any signed-in student could write
--    themselves a 'selected' result. Same class of hole 0030 closed.
-- 2. "After shortlisting ... data not reflecting in panel. Data not
--    reflecting to student." Nothing connected the shortlist to Round 1, so
--    the student dashboard and the results screen read from empty tables.
--    Saving the shortlist now schedules Round 1 and notifies; results notify
--    (selected AND rejected — the client asked for both); an offer notifies.
--    Recruiters are not users (D8): the Central CPC's entry is final and IS
--    the communication.
-- 3. An opted-out student cannot be shortlisted without an explicit override
--    reason (D7), and is never notified of anything.

-- ------------------------------------------------------------ 1. lockdown

alter table round_participants enable row level security;
alter table round_participants force  row level security;
alter table round_results      enable row level security;
alter table round_results      force  row level security;
alter table attendance         enable row level security;
alter table attendance         force  row level security;
alter table recruiter_exports  enable row level security;
alter table recruiter_exports  force  row level security;
alter table email_deliveries   enable row level security;
alter table email_deliveries   force  row level security;

-- A student reads their own rows: the dashboard's round progress ran only
-- because RLS was off. Staff read by scope; the drive's AE reads their own
-- drive's rows (0019's argument). Writes stay with the operators — and the
-- campus CPC for attendance, which they mark (domain rule R8's marking).

create policy rounds_self_read on round_participants for select
  using (application_id in (select id from applications where student_id = current_student_id()));
create policy results_self_read on round_results for select
  using (application_id in (select id from applications where student_id = current_student_id()));
create policy attendance_self_read on attendance for select
  using (application_id in (select id from applications where student_id = current_student_id()));

create policy rounds_staff_read on round_participants for select
  using (is_org_reader()
         or (is_campus_reader() and application_id in
             (select id from applications where student_id in (select my_student_ids()))));
create policy results_staff_read on round_results for select
  using (is_org_reader()
         or (is_campus_reader() and application_id in
             (select id from applications where student_id in (select my_student_ids()))));
create policy attendance_staff_read on attendance for select
  using (is_org_reader()
         or (is_campus_reader() and application_id in
             (select id from applications where student_id in (select my_student_ids()))));

create policy rounds_ae_read on round_participants for select
  using (current_app_role() = 'account_executive'
         and application_id in (select a.id from applications a
              where a.drive_id in (select id from drives where created_by = auth.uid())));
create policy results_ae_read on round_results for select
  using (current_app_role() = 'account_executive'
         and application_id in (select a.id from applications a
              where a.drive_id in (select id from drives where created_by = auth.uid())));
create policy attendance_ae_read on attendance for select
  using (current_app_role() = 'account_executive'
         and application_id in (select a.id from applications a
              where a.drive_id in (select id from drives where created_by = auth.uid())));

create policy rounds_operator_write on round_participants for all
  using (is_operator()) with check (is_operator());
create policy results_operator_write on round_results for all
  using (is_operator()) with check (is_operator());
-- Attendance is marked at the venue: the campus CPC for their own students,
-- or the operators.
create policy attendance_staff_write on attendance for all
  using (is_operator()
         or (is_campus_staff() and application_id in
             (select id from applications where student_id in (select my_student_ids()))))
  with check (is_operator()
         or (is_campus_staff() and application_id in
             (select id from applications where student_id in (select my_student_ids()))));

create policy exports_staff_read on recruiter_exports for select using (is_org_reader());
create policy exports_operator_insert on recruiter_exports for insert with check (is_operator());

-- Delivery status is read by staff; only the server (service role) writes it.
create policy deliveries_staff_read on email_deliveries for select using (is_org_reader());

-- ------------------------------------------------- 2. the opt-out override

alter table shortlist_entries add column opt_out_override_reason text;

create or replace function shortlist_respects_opt_out() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.included
     and (tg_op = 'INSERT' or old.included is distinct from new.included
          or old.opt_out_override_reason is distinct from new.opt_out_override_reason)
     and exists (
       select 1 from applications a
         join students s on s.id = a.student_id
        where a.id = new.application_id
          and s.participation_status = 'opted_out'
     )
     and (new.opt_out_override_reason is null
          or length(trim(new.opt_out_override_reason)) = 0) then
    raise exception
      'This student has opted out and cannot be shortlisted. Overriding needs an explicit reason.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger shortlist_respects_opt_out
  before insert or update on shortlist_entries
  for each row execute function shortlist_respects_opt_out();

-- --------------------------------- 3. inclusion schedules Round 1, and tells

create or replace function shortlist_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first_round uuid;
  v_company     text;
  v_student     uuid;
  v_opted_out   boolean;
begin
  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted_out
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select dr.id into v_first_round
    from drive_rounds dr
    join applications a on a.drive_id = dr.drive_id
   where a.id = new.application_id
   order by dr.sequence
   limit 1;

  if new.included and (tg_op = 'INSERT' or not old.included) then
    -- Schedule Round 1. A drive published before rounds existed has none;
    -- the notification still goes, and scheduling happens on the attendance
    -- screen as before.
    if v_first_round is not null then
      insert into round_participants (round_id, application_id, added_by)
      values (v_first_round, new.application_id, new.decided_by)
      on conflict (round_id, application_id) do nothing;

      insert into attendance (round_id, application_id, status)
      values (v_first_round, new.application_id, 'scheduled')
      on conflict (round_id, application_id) do nothing;
    end if;

    -- D7: an opted-out student gets NO notification, overridden or not.
    if not v_opted_out then
      insert into notifications (student_id, kind, title, body)
      values (
        v_student,
        'shortlisted',
        'You are shortlisted for ' || v_company,
        'You are on the shortlist for ' || v_company ||
        '. Round 1 is next — you are expected to attend every round.'
      );
    end if;
  end if;

  -- Un-including takes back an untouched Round 1 slot. Anything already
  -- marked or decided stays: history is not rewritten by a checkbox.
  if not new.included and tg_op = 'UPDATE' and old.included and v_first_round is not null then
    delete from attendance
     where round_id = v_first_round
       and application_id = new.application_id
       and status = 'scheduled'
       and marked_by is null
       and not exists (select 1 from round_results r
                        where r.round_id = v_first_round
                          and r.application_id = new.application_id);
    delete from round_participants rp
     where rp.round_id = v_first_round
       and rp.application_id = new.application_id
       and not exists (select 1 from attendance att
                        where att.round_id = v_first_round
                          and att.application_id = new.application_id);
  end if;

  return new;
end;
$$;

create trigger shortlist_reaches_student
  after insert or update on shortlist_entries
  for each row execute function shortlist_reaches_student();

-- ------------------------------------------------- 4. results notify, both ways

create or replace function round_result_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student  uuid;
  v_company  text;
  v_sequence integer;
  v_opted    boolean;
begin
  if new.result not in ('selected', 'rejected') then
    return new;  -- waitlisted / on_hold are interim states, not outcomes
  end if;
  if tg_op = 'UPDATE' and old.result = new.result then
    return new;  -- re-saving the same result is not news
  end if;

  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select sequence into v_sequence from drive_rounds where id = new.round_id;

  if v_opted then
    return new;
  end if;

  if new.result = 'selected' then
    insert into notifications (student_id, kind, title, body)
    values (
      v_student,
      'round_cleared',
      'You cleared Round ' || v_sequence || ' of ' || v_company,
      'Well done — you advance from Round ' || v_sequence || ' of ' || v_company || '.'
    );
  else
    insert into notifications (student_id, kind, title, body)
    values (
      v_student,
      'round_not_selected',
      'Round ' || v_sequence || ' of ' || v_company || ': not selected',
      'You were not selected in Round ' || v_sequence || ' of ' || v_company || '.'
    );
  end if;

  return new;
end;
$$;

create trigger round_result_reaches_student
  after insert or update on round_results
  for each row execute function round_result_reaches_student();

-- --------------------------------------------------------- 5. offers notify

create or replace function offer_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_opted boolean;
begin
  if new.source <> 'on_campus' then
    return new;  -- a self-placed offer is the student's own news
  end if;

  select participation_status = 'opted_out' into v_opted
    from students where id = new.student_id;
  if v_opted then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (
    new.student_id,
    'offer',
    'Offer from ' || new.company_name,
    'Congratulations — ' || new.company_name || ' has made you an offer'
      || case when new.offer_category is not null
              then ' (' || replace(new.offer_category::text, '_', ' ') || ')' else '' end
      || '.'
  );

  return new;
end;
$$;

create trigger offer_reaches_student
  after insert on offers
  for each row execute function offer_reaches_student();

-- =============================================================================
-- Migration: 0044_campus_reads_drives.sql
-- =============================================================================

-- 0044 — campus staff read drives (D10, confirmed 2026-08-12).
--
-- "Campus Placement Coordinator: should retain visibility through the entire
-- cycle — not just till shortlist, but through to offer sent/offer made."
--
-- Their students' applications, rounds and offers were already campus-scoped
-- readable (0018, 0043). The DRIVE those rows belong to was not:
-- is_org_reader() excludes campus roles, so the drive-progress screen would
-- name every student and no company. Read-only: publishing and editing stay
-- exactly where they were (is_operator / the drive's owners).

create policy drives_campus_read on drives for select
  using (is_campus_reader());

-- =============================================================================
-- Migration: 0045_campus_reads_shortlist.sql
-- =============================================================================

-- 0045 — campus staff read their students' shortlist standing (D10).
--
-- Found while PROVING 0044 live, not by a test: the campus CPC read 6 drives
-- and 6 applications but 0 shortlist entries — shortlist_staff_only is
-- is_org_reader(), which excludes campus roles. /cpc/drives would have shown
-- every student as "not shortlisted", which is a wrong screen, not an empty
-- one. Same silent-RLS-filter class as the invisible-drives bug (0030).
--
-- PRD §13.1 is unaffected: it forbids showing rank, rationale or inclusion to
-- STUDENTS. A campus coordinator is staff, scoped to their own students.
-- Select-only: shortlisting stays the Central CPC's decision.

create policy shortlist_campus_read on shortlist_entries for select
  using (
    is_campus_reader()
    and application_id in (
      select id from applications where student_id in (select my_student_ids())
    )
  );

-- =============================================================================
-- Migration: 0046_offer_band_edges_move_up.sql
-- =============================================================================

-- 0046 — A band edge now belongs to the band ABOVE it.
--
-- SPEC CHANGE 2026-08-17 (Karthik, verbatim): "5.00 is dream and 10.00 is
-- super dream."
--
-- It surfaced from the campus overview: a placed student on exactly Rs 5.00
-- LPA was reported under "Regular", because every layer treated a band edge as
-- the CEILING of the band below it (`ctc <= 5 then regular`). The edge is now
-- the FLOOR of the band above it.
--
-- Three places carried the old rule and all three are corrected here, because
-- correcting only the TypeScript would leave the database quietly disagreeing
-- with the screen:
--   1. src/domain/offer-category.ts  (this commit, with tests)
--   2. settings.offer_category_bands (seeded by 0002)
--   3. the ad-hoc CASE in 0041's backfill  -> replaced by a real function
--
-- WHY THIS IS NOT COSMETIC. offer_category is a rung on the ladder (R1/D5):
-- it decides which further drives a student holding an offer may still apply
-- to. An offer banded one rung too low understates what they hold and lets
-- them apply to drives they should already be blocked from. Rows sitting
-- exactly on an edge are therefore re-banded below, not left alone.

-- ------------------------------------------------------- the rule, once
-- 0041 inlined the bands as a CASE expression and said "change both or
-- neither", which is a comment where a function should have been. Now there
-- is one definition, and `src/db/offer-category-bands.test.ts` asserts it
-- against the TypeScript for every boundary.
create or replace function classify_offer_category(ctc_lpa numeric)
  returns offer_category
  language sql
  immutable
  set search_path = public
as $$
  select case
           when ctc_lpa is null then null
           when ctc_lpa < 5  then 'regular'
           when ctc_lpa < 10 then 'dream'
           else 'super_dream'
         end::offer_category;
$$;

comment on function classify_offer_category(numeric) is
  'R1 band edges belong to the band above: <5 regular, 5..<10 dream, >=10 super_dream. '
  'Mirrors classifyOfferCategory in src/domain/offer-category.ts; change both or neither.';

-- --------------------------------------------------- the configured bands
-- Renamed, not just revalued. `regularMaxLpa` is now a false description of
-- the number it holds, and a key that lies is worse than a key that is absent.
update settings
   set value = '{"dreamMinLpa": 5, "superDreamMinLpa": 10}'::jsonb
 where key = 'offer_category_bands';

-- ------------------------------------------------ re-band what sat on an edge
-- Only rows EXACTLY on an edge can change band, so this touches the minimum
-- possible: Rs 5.00 regular -> dream, Rs 10.00 dream -> super_dream. Every
-- other row already agrees with the new rule.
--
-- Deliberately NOT a blanket reclassification. offer_category is the Delivery
-- Head's decision and a legitimate override away from the suggested band must
-- survive a change to the suggestion.
update offers
   set offer_category = classify_offer_category(ctc_lpa)
 where drive_type <> 'internship'
   and ctc_lpa in (5, 10)
   and offer_category is distinct from classify_offer_category(ctc_lpa);

-- drives.offer_category is guarded as immutable by 0009's
-- enforce_drive_transitions, which is correct and stays. This migration is the
-- one legitimate exception - the rule itself moved under the data - so the
-- trigger is lifted for exactly this statement and restored immediately.
-- Anything that reaches for this pattern again should be treated as a bug.
alter table drives disable trigger enforce_drive_transitions;

update drives
   set offer_category = classify_offer_category(coalesce(ctc_max_lpa, ctc_min_lpa))
 where offer_category is not null
   and coalesce(ctc_max_lpa, ctc_min_lpa) in (5, 10)
   and offer_category is distinct
       from classify_offer_category(coalesce(ctc_max_lpa, ctc_min_lpa));

alter table drives enable trigger enforce_drive_transitions;

-- =============================================================================
-- Migration: 0047_one_verb_one_role.sql
-- =============================================================================

-- 0047 — Raising a drive is the Account Executive's, and only theirs.
--
-- 2026-08-17 (Karthik): "To keep drives simple, AE can only raise drives (no
-- one else can raise a drive). Delivery head can only approve (delivery head
-- cannot raise a drive). ... Central PC cannot raise or approve a drive."
--
-- 0008 handed out `for all` twice:
--
--   drives_dh_write        current_app_role() = 'delivery_head'
--   drives_operator_write  is_operator()   -- admin + central_placement_coordinator
--
-- `for all` includes INSERT. So both of the people whose job is to CHECK the
-- Account Executive's work could raise a drive of their own and then approve
-- or publish it themselves. The screens never offered it; the database allowed
-- it, and the database is the part that decides.
--
-- The lifecycle is three verbs held by three roles, and the separation is the
-- control:
--
--     raise -> account_executive
--     approve -> delivery_head
--     publish -> central_placement_coordinator
--
-- Admin gets none of them. Being able to fix anything is not a reason to be
-- able to do everything, and an Admin who could raise and approve their own
-- drive is the whole separation defeated by one account.

-- ------------------------------------------------------- raising: AE only
-- Unchanged in spirit, restated so the INSERT rule lives in one obvious place.
-- `created_by = auth.uid()` matters as much as the role: raising a drive in
-- another AE's name would forge the ownership column that scopes every later
-- read of it.
drop policy if exists drives_ae_write on drives;

-- Status is constrained to the two an AE legitimately starts from: 'draft'
-- (save and come back) and 'submitted' (send it to the Delivery Head). 0008
-- checked no status at all on INSERT, and 0009's transition guard only fires
-- on UPDATE - so an AE could have inserted a drive already 'approved' or
-- 'live' and walked past both of the other two roles in one statement.
create policy drives_ae_insert on drives for insert
  with check (
    current_app_role() = 'account_executive'
    and created_by = auth.uid()
    and status in ('draft', 'submitted')
  );

-- An AE may still edit their own drive, but only while it is a draft. Once it
-- is submitted it belongs to the process, not to them.
create policy drives_ae_update on drives for update
  using (
    current_app_role() = 'account_executive'
    and created_by = auth.uid()
    and status = 'draft'
  )
  with check (
    current_app_role() = 'account_executive'
    and created_by = auth.uid()
  );

-- --------------------------------------------- approving and publishing
-- Both roles keep every power they actually use - they read, they update, they
-- delete. What they lose is INSERT, which neither has any business having.
-- Splitting `for all` into the three verbs is the entire change.
drop policy if exists drives_dh_write on drives;

create policy drives_dh_update on drives for update
  using (current_app_role() = 'delivery_head')
  with check (current_app_role() = 'delivery_head');

create policy drives_dh_delete on drives for delete
  using (current_app_role() = 'delivery_head');

drop policy if exists drives_operator_write on drives;

create policy drives_operator_update on drives for update
  using (is_operator()) with check (is_operator());

create policy drives_operator_delete on drives for delete
  using (is_operator());

-- Reads are untouched: drives_staff_read, drives_ae_read (own drives only),
-- drives_campus_read and drives_student_read all still apply. An AE seeing
-- only the drives they raised is 0008's rule and remains correct - Karthik,
-- same day: "An AE cannot see drives raised by other AEs."

-- =============================================================================
-- Migration: 0048_school_boards_and_rejection.sql
-- =============================================================================

-- 0048 — The board behind a school mark, who awarded a diploma, and telling a
-- student their form was sent back.
--
-- Three requests from 2026-08-18, in one migration because they touch one
-- function between them (`submit_srf`), and replacing that function twice in
-- two migrations is two chances to lose a field:
--
--   1. "in the student registration form, a field for board has to be added
--      for 10th and 12th standard marks, a field has to be added for capturing
--      the university while entering the diploma marks."
--   3. "the campus placement coordinator should be able to reject the form with
--      comments. The rejected form should come to the students as rejected
--      form. They should be able to edit it and resubmit it."
--
-- Item 3 needed almost nothing HERE: 0020 has permitted the student's
-- srf_rejected -> srf_submitted since long before this, 0042 restricts the
-- decision itself to the campus placement coordinator, and
-- srf_rejection_reason has existed since 0003. What was missing was a button on
-- a screen (shipped alongside) and the one thing a screen cannot do: tell the
-- student without them going to look. That is the notification below.

-- ---------------------------------------------------------------- vocabulary
-- Mirrored by SCHOOL_BOARDS in src/domain/boards.ts, and the pairing is proved
-- by src/db/types-drift.test.ts. Order matters there, so it matters here.
--
-- ONE value for CISCE, not two. It reads ICSE at class 10 and ISC at class 12,
-- and that is a LABEL (`boardLabel`), not a fact about the student: separate
-- enum values would let a student record "ISC" against their tenth and nothing
-- downstream could tell that apart from a real answer.
create type school_board as enum (
  'state_board',
  'cbse',
  'cisce',
  'nios',
  'ib',
  'cambridge',
  'other'
);

-- ------------------------------------------------------------------- columns
-- NULLABLE, and deliberately so. Five students are already registered and
-- three are approved; there is no board on file for any of them, and inventing
-- one would assert a fact nobody has checked against a marksheet. The FORM
-- demands all three (`validateBoardSelection`), so every future submission
-- carries them, and `describeBoard(null)` reads "Not recorded" rather than
-- leaving a blank cell that looks like a claim.
alter table students
  add column if not exists tenth_board          school_board,
  add column if not exists tenth_board_state    text,
  add column if not exists tenth_board_other    text,
  add column if not exists twelfth_board        school_board,
  add column if not exists twelfth_board_state  text,
  add column if not exists twelfth_board_other  text,
  -- Who AWARDED the diploma. "University / Board" on screen: many diplomas come
  -- from a state technical-education board rather than a university, and a
  -- field called "University" invites that student to leave it blank.
  add column if not exists diploma_university   text;

-- --------------------------------------------------------------- constraints
-- BOTH directions, for both boards. A state against CBSE is not harmless
-- noise: it would be stored, shown to a coordinator beside the marksheet, and
-- read as a fact. The same pairs are refused by `validateBoardSelection`, so
-- the form and the database refuse for the same reason and with the same words.
alter table students
  add constraint tenth_board_state_only_for_state_board check (
    tenth_board_state is null or tenth_board = 'state_board'
  ),
  add constraint tenth_board_other_only_for_other check (
    tenth_board_other is null or tenth_board = 'other'
  ),
  add constraint twelfth_board_state_only_for_state_board check (
    twelfth_board_state is null or twelfth_board = 'state_board'
  ),
  add constraint twelfth_board_other_only_for_other check (
    twelfth_board_other is null or twelfth_board = 'other'
  );

-- The other half of each rule - a State Board with no state names 36 boards,
-- and Other with nothing typed names none. NOT NULL cannot express it (the
-- columns are nullable for the students who predate them), so it is stated as a
-- pair: once the board is known, its second answer must be there too.
alter table students
  add constraint tenth_state_board_names_its_state check (
    tenth_board is distinct from 'state_board' or tenth_board_state is not null
  ),
  add constraint tenth_other_board_is_named check (
    tenth_board is distinct from 'other' or tenth_board_other is not null
  ),
  add constraint twelfth_state_board_names_its_state check (
    twelfth_board is distinct from 'state_board' or twelfth_board_state is not null
  ),
  add constraint twelfth_other_board_is_named check (
    twelfth_board is distinct from 'other' or twelfth_board_other is not null
  );

-- ------------------------------------------------------- submit_srf, replaced
-- 0038's body, with seven fields added. Reproduced in full rather than patched
-- because Postgres cannot amend a function in place, and the arity is unchanged
-- so no grant or client call site moves.
create or replace function submit_srf(
  p_student      jsonb,
  p_semesters    jsonb,
  p_documents    jsonb,
  p_certificates jsonb default '[]'::jsonb
)
returns table (student_id uuid, srf_status srf_status)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_student_id uuid;
  v_slots      jsonb;
begin
  v_student_id := current_student_id();

  if v_student_id is null then
    raise exception 'We could not find your student record. Contact your placement coordinator.'
      using errcode = 'no_data_found';
  end if;

  with inserted as (
    insert into student_documents (student_id, kind, storage_path, size_bytes)
    select v_student_id,
           (d->>'kind')::document_kind,
           d->>'storage_path',
           (d->>'size_bytes')::int
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    returning id, storage_path
  )
  select coalesce(jsonb_object_agg(d->>'slot', i.id), '{}'::jsonb)
    into v_slots
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    join inserted i on i.storage_path = d->>'storage_path';

  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = p_student->>'whatsapp',
    alternate_contact     = p_student->>'alternate_contact',
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = (p_student->>'tenth_percentage')::numeric,
    -- The board, and the one extra answer it needs. Nothing is coalesced to a
    -- default: an unanswered board must fail the check constraint, not quietly
    -- become a CBSE nobody chose.
    tenth_board           = (p_student->>'tenth_board')::school_board,
    tenth_board_state     = p_student->>'tenth_board_state',
    tenth_board_other     = p_student->>'tenth_board_other',
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = (p_student->>'twelfth_percentage')::numeric,
    twelfth_board         = (p_student->>'twelfth_board')::school_board,
    twelfth_board_state   = p_student->>'twelfth_board_state',
    twelfth_board_other   = p_student->>'twelfth_board_other',
    diploma_institution   = p_student->>'diploma_institution',
    diploma_university    = p_student->>'diploma_university',
    diploma_marks         = (p_student->>'diploma_marks')::numeric,
    diploma_marks_scale   = (p_student->>'diploma_marks_scale')::marks_scale,
    diploma_marksheet_id  = (v_slots->>(p_student->>'diploma_marksheet_slot'))::uuid,
    passing_year          = (p_student->>'passing_year')::int,
    programme_level       = (p_student->>'programme_level')::programme_level,
    ug_degree             = p_student->>'ug_degree',
    ug_college            = p_student->>'ug_college',
    ug_branch             = p_student->>'ug_branch',
    ug_aggregate_declared = (p_student->>'ug_aggregate_declared')::numeric,
    ug_aggregate_scale    = (p_student->>'ug_aggregate_scale')::marks_scale,
    ug_aggregate_cgpa     = (p_student->>'ug_aggregate_cgpa')::numeric,
    ug_marksheet_id       = (v_slots->>(p_student->>'ug_marksheet_slot'))::uuid,
    technical_skills      = p_student->>'technical_skills',
    areas_of_interest     = p_student->>'areas_of_interest',
    areas_of_expertise    = p_student->>'areas_of_expertise',
    projects              = p_student->>'projects',
    achievements          = p_student->>'achievements',
    linkedin_url          = p_student->>'linkedin_url',
    github_url            = p_student->>'github_url',
    leetcode_url          = p_student->>'leetcode_url',
    hackerrank_url        = p_student->>'hackerrank_url',
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    consent_given_at      = now(),
    srf_status            = 'srf_submitted',
    srf_submitted_at      = now(),
    srf_draft             = null,
    srf_draft_saved_at    = null
    -- srf_rejection_reason is deliberately LEFT ALONE. It is what lets the
    -- coordinator see, on the resubmitted form, what they asked for last time;
    -- approval clears it.
  where id = v_student_id;

  delete from student_semesters where student_semesters.student_id = v_student_id;

  insert into student_semesters (
    student_id, semester_number, cgpa, declared_marks, marks_scale,
    current_arrears, history_of_arrears, marksheet_id
  )
  select v_student_id,
         (s->>'semester_number')::int,
         (s->>'cgpa')::numeric,
         (s->>'declared_marks')::numeric,
         (s->>'marks_scale')::marks_scale,
         (s->>'current_arrears')::int,
         (s->>'history_of_arrears')::int,
         (v_slots->>(s->>'marksheet_slot'))::uuid
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s;

  -- Certificates. Only the undecided ones are the student's to replace.
  delete from student_certificates
   where student_certificates.student_id = v_student_id
     and student_certificates.status <> 'verified';

  insert into student_certificates (student_id, name, document_id)
  select v_student_id,
         c->>'name',
         (v_slots->>(c->>'document_slot'))::uuid
    from jsonb_array_elements(coalesce(p_certificates, '[]'::jsonb)) as c
   where lower(regexp_replace(btrim(c->>'name'), '\s+', ' ', 'g')) not in (
           select lower(regexp_replace(btrim(sc.name), '\s+', ' ', 'g'))
             from student_certificates sc
            where sc.student_id = v_student_id
         );

  return query
    select s.id, s.srf_status from students s where s.id = v_student_id;
end;
$$;

grant execute on function submit_srf(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ------------------------------------------- the student is told, not left to look
-- A screen can only tell somebody who visits it. A form sent back for changes
-- is the one thing in this flow that REQUIRES the student to act, so it is the
-- last thing that should wait to be noticed.
--
-- SECURITY DEFINER for the reason 0043's triggers are: the coordinator's own
-- UPDATE on `students` fires this, and `notifications` has no insert policy for
-- them - notifications are written by the system, on the student's behalf.
create or replace function notify_student_of_srf_rejection() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.srf_status = 'srf_rejected'
     and old.srf_status is distinct from 'srf_rejected' then

    -- D7's rule, applied here too: an opted-out student is not chased about a
    -- placement process they have left.
    if new.participation_status is distinct from 'opted_out' then
      insert into notifications (student_id, kind, title, body)
      values (
        new.id,
        'srf_rejected',
        'Your registration form was sent back for changes',
        coalesce(
          nullif(btrim(new.srf_rejection_reason), ''),
          'Your coordinator has asked for changes.'
        ) || ' Open your registration form to correct it and submit it again.'
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger notify_student_of_srf_rejection
  after update on students
  for each row execute function notify_student_of_srf_rejection();

-- =============================================================================
-- Migration: 0049_srf_stores_preferences_and_resumes.sql
-- =============================================================================

-- 0049 — P10. The SRF stores the preferences and resumes it collects.
--
-- 2026-08-18 (Karthik): "preferences and resumes SUBMITTED AT THE TIME of
-- submitting SRF has to be recorded and saved. This has to be used while
-- publishing a drive."
--
-- 🔴 What was actually happening. The form has always asked for up to five role
-- categories and demanded one resume per category, refusing to submit without
-- them — and `submit_srf` wrote NEITHER. `student_role_preferences` has been an
-- empty table since 0003, and the resume files never left the browser: the
-- `File` was read to decide whether the upload box was non-empty, then dropped.
--
-- So a student who had only ever filled in the SRF had **no resume on file and
-- no recorded preference**, while `rankApplicants` scores role-preference match
-- and R7 promises the recruiter one resume per category. Nobody reported it
-- because /student/profile quietly covers for it, and because the form's own
-- validation made it look as though the files were being taken seriously.
--
-- Arity changes (6 parameters, was 4), so the OLD FUNCTION IS DROPPED
-- EXPLICITLY. `create or replace` would leave a second overload behind, and
-- PostgREST would then have to guess which one a payload meant.

drop function if exists submit_srf(jsonb, jsonb, jsonb, jsonb);

create or replace function submit_srf(
  p_student         jsonb,
  p_semesters       jsonb,
  p_documents       jsonb,
  p_certificates    jsonb default '[]'::jsonb,
  p_role_categories jsonb default '[]'::jsonb,
  p_resumes         jsonb default '[]'::jsonb
)
returns table (student_id uuid, srf_status srf_status)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_student_id uuid;
  v_slots      jsonb;
begin
  v_student_id := current_student_id();

  if v_student_id is null then
    raise exception 'We could not find your student record. Contact your placement coordinator.'
      using errcode = 'no_data_found';
  end if;

  with inserted as (
    insert into student_documents (student_id, kind, storage_path, size_bytes)
    select v_student_id,
           (d->>'kind')::document_kind,
           d->>'storage_path',
           (d->>'size_bytes')::int
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    returning id, storage_path
  )
  select coalesce(jsonb_object_agg(d->>'slot', i.id), '{}'::jsonb)
    into v_slots
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    join inserted i on i.storage_path = d->>'storage_path';

  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = p_student->>'whatsapp',
    alternate_contact     = p_student->>'alternate_contact',
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = (p_student->>'tenth_percentage')::numeric,
    tenth_board           = (p_student->>'tenth_board')::school_board,
    tenth_board_state     = p_student->>'tenth_board_state',
    tenth_board_other     = p_student->>'tenth_board_other',
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = (p_student->>'twelfth_percentage')::numeric,
    twelfth_board         = (p_student->>'twelfth_board')::school_board,
    twelfth_board_state   = p_student->>'twelfth_board_state',
    twelfth_board_other   = p_student->>'twelfth_board_other',
    diploma_institution   = p_student->>'diploma_institution',
    diploma_university    = p_student->>'diploma_university',
    diploma_marks         = (p_student->>'diploma_marks')::numeric,
    diploma_marks_scale   = (p_student->>'diploma_marks_scale')::marks_scale,
    diploma_marksheet_id  = (v_slots->>(p_student->>'diploma_marksheet_slot'))::uuid,
    passing_year          = (p_student->>'passing_year')::int,
    programme_level       = (p_student->>'programme_level')::programme_level,
    ug_degree             = p_student->>'ug_degree',
    ug_college            = p_student->>'ug_college',
    ug_branch             = p_student->>'ug_branch',
    ug_aggregate_declared = (p_student->>'ug_aggregate_declared')::numeric,
    ug_aggregate_scale    = (p_student->>'ug_aggregate_scale')::marks_scale,
    ug_aggregate_cgpa     = (p_student->>'ug_aggregate_cgpa')::numeric,
    ug_marksheet_id       = (v_slots->>(p_student->>'ug_marksheet_slot'))::uuid,
    technical_skills      = p_student->>'technical_skills',
    areas_of_interest     = p_student->>'areas_of_interest',
    areas_of_expertise    = p_student->>'areas_of_expertise',
    projects              = p_student->>'projects',
    achievements          = p_student->>'achievements',
    linkedin_url          = p_student->>'linkedin_url',
    github_url            = p_student->>'github_url',
    leetcode_url          = p_student->>'leetcode_url',
    hackerrank_url        = p_student->>'hackerrank_url',
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    consent_given_at      = now(),
    srf_status            = 'srf_submitted',
    srf_submitted_at      = now(),
    srf_draft             = null,
    srf_draft_saved_at    = null
  where id = v_student_id;

  delete from student_semesters where student_semesters.student_id = v_student_id;

  insert into student_semesters (
    student_id, semester_number, cgpa, declared_marks, marks_scale,
    current_arrears, history_of_arrears, marksheet_id
  )
  select v_student_id,
         (s->>'semester_number')::int,
         (s->>'cgpa')::numeric,
         (s->>'declared_marks')::numeric,
         (s->>'marks_scale')::marks_scale,
         (s->>'current_arrears')::int,
         (s->>'history_of_arrears')::int,
         (v_slots->>(s->>'marksheet_slot'))::uuid
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s;

  -- ------------------------------------------------------------ preferences
  -- Replaced wholesale: this IS the student's current answer to "which areas
  -- do you want to be considered for", and a resubmission that drops one means
  -- they no longer want it. Nothing downstream keeps history of the question.
  delete from student_role_preferences
   where student_role_preferences.student_id = v_student_id;

  insert into student_role_preferences (student_id, category)
  select v_student_id, c::role_category
    from jsonb_array_elements_text(coalesce(p_role_categories, '[]'::jsonb)) as c
  on conflict do nothing;

  -- --------------------------------------------------------------- resumes
  -- The PROFILE resume for each area: `drive_id is null`, which is exactly
  -- what `one_resume_per_category` (narrowed by 0033) keys on. A resume
  -- uploaded for ONE application carries a drive_id and is untouched here -
  -- deleting those would remove the CV a recruiter was actually sent.
  delete from student_documents
   where student_documents.student_id = v_student_id
     and student_documents.kind = 'resume'
     and student_documents.drive_id is null
     and (
       -- Replaced only where a new one has been supplied for the same area, or
       -- where the student has stopped asking for that area altogether. A
       -- resubmission that re-uploads two of three resumes keeps the third.
       student_documents.role_category::text in (
         select r->>'role_category' from jsonb_array_elements(coalesce(p_resumes, '[]'::jsonb)) as r
       )
       or student_documents.role_category::text not in (
         select c from jsonb_array_elements_text(coalesce(p_role_categories, '[]'::jsonb)) as c
       )
     );

  insert into student_documents (student_id, kind, role_category, storage_path, size_bytes)
  select v_student_id,
         'resume'::document_kind,
         (r->>'role_category')::role_category,
         r->>'storage_path',
         (r->>'size_bytes')::int
    from jsonb_array_elements(coalesce(p_resumes, '[]'::jsonb)) as r;

  -- Certificates. Only the undecided ones are the student's to replace.
  delete from student_certificates
   where student_certificates.student_id = v_student_id
     and student_certificates.status <> 'verified';

  insert into student_certificates (student_id, name, document_id)
  select v_student_id,
         c->>'name',
         (v_slots->>(c->>'document_slot'))::uuid
    from jsonb_array_elements(coalesce(p_certificates, '[]'::jsonb)) as c
   where lower(regexp_replace(btrim(c->>'name'), '\s+', ' ', 'g')) not in (
           select lower(regexp_replace(btrim(sc.name), '\s+', ' ', 'g'))
             from student_certificates sc
            where sc.student_id = v_student_id
         );

  return query
    select s.id, s.srf_status from students s where s.id = v_student_id;
end;
$$;

grant execute on function submit_srf(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ------------------------------------------------ deleting a profile resume
-- Replacing a resume means deleting the row it replaces, and 0008 grants only
-- `select, insert, update` - no DELETE on anything. So the replace above needs
-- a grant, and a grant alone would be too wide: `documents_write_self` is a
-- `for all` policy, so DELETE would let a student remove their own MARKSHEETS
-- after a coordinator had verified them against a figure.
--
-- Narrowed to exactly what the student owns: their profile resume for an area.
-- Never a marksheet, never a certificate's document, and never the resume
-- attached to an application - that one is what a recruiter was sent.
grant delete on student_documents to authenticated;

drop policy if exists documents_write_self on student_documents;

create policy documents_insert_self on student_documents for insert
  with check (student_id = current_student_id());

create policy documents_update_self on student_documents for update
  using (student_id = current_student_id())
  with check (student_id = current_student_id());

create policy documents_delete_own_profile_resume on student_documents for delete
  using (
    student_id = current_student_id()
    and kind = 'resume'
    and drive_id is null
  );

-- The student owns their own preferences; staff read them (shortlisting ranks
-- on this, and publishing counts an audience with it). 0008 enabled RLS on
-- every table and this one has never had a policy, because nothing has ever
-- written to it.
-- The table has never had a grant either - nothing has ever written to it, so
-- nothing ever noticed. (A Supabase project also ships `grant all` on the
-- public schema, which is why this can look unnecessary against production and
-- is not: the local schema tests run without that drift.)
grant select, insert, update, delete on student_role_preferences to authenticated;

alter table student_role_preferences enable row level security;
alter table student_role_preferences force  row level security;

drop policy if exists role_preferences_read_self on student_role_preferences;
create policy role_preferences_read_self on student_role_preferences for select
  using (student_id = current_student_id());

drop policy if exists role_preferences_write_self on student_role_preferences;
create policy role_preferences_write_self on student_role_preferences for all
  using (student_id = current_student_id())
  with check (student_id = current_student_id());

drop policy if exists role_preferences_read_staff on student_role_preferences;
create policy role_preferences_read_staff on student_role_preferences for select
  using (
    is_org_reader()
    or (is_campus_staff() and student_id in (select my_student_ids()))
  );

-- =============================================================================
-- Migration: 0050_area_targeting_and_school_marks_gates.sql
-- =============================================================================

-- 0050 — a drive reaches the students who asked for that kind of work, and the
-- 10th/12th bars are enforced where it counts.
--
-- 2026-08-18 (Karthik):
--   "a drive has to be classified into one of these areas by the AE while
--    raising a PIF. This should go to the students only showing interest in
--    that area."
--   "we also need 10th and 12th marks based targetting. now only cgpa field is
--    there."
--
-- Both rules already exist in `src/domain/visibility.ts` and
-- `src/domain/eligibility.ts`, and the screens ask them. This migration makes
-- the DATABASE agree, because the screen is not what stops an application: the
-- publish screen counts an audience, and if the gate is looser than the count
-- then the number a coordinator was shown is a promise the database will break.
--
-- Two shapes, deliberately different, mirroring the domain exactly:
--
--   the AREA is a PREFERENCE  -> checked AFTER open_to_all_override, so R5a's
--                                prestige-drive escape hatch still bypasses it,
--                                exactly as it bypasses the ladder and the cap;
--   the SCHOOL MARKS are ELIGIBILITY -> checked BEFORE the override, with
--                                consent and participation, because an override
--                                is about placement history, never about
--                                whether the student meets the company's bar.
--
-- "No opinion" is not refusal, on both sides and for both rules:
--   * a drive with no `role_category` (every drive raised before today) is open
--     to everyone;
--   * a student with NO recorded preference (every form submitted before 0049)
--     matches every drive. Reading silence as refusal would empty the audience
--     for the entire existing roster overnight, with no message they could act
--     on and nothing on any screen to explain it.

create or replace function enforce_application_gates() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d drives%rowtype;
  s students%rowtype;
  highest_rank integer;
  drive_rank   integer;
begin
  if current_student_id() is null then
    return new;
  end if;

  select * into d from drives where id = new.drive_id;

  if d.status <> 'live' then
    raise exception 'This drive is not open.' using errcode = 'check_violation';
  end if;

  if d.application_start is null or d.application_end is null
     or now() < d.application_start or now() > d.application_end then
    raise exception 'The application window for this drive is closed.'
      using errcode = 'check_violation';
  end if;

  select * into s from students where id = new.student_id;

  if s.srf_status <> 'srf_approved' then
    raise exception 'Your registration form has not been approved yet.'
      using errcode = 'check_violation';
  end if;

  if s.participation_status <> 'active' then
    raise exception 'You have opted out of campus placements or are not currently eligible.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from drive_target_campuses where drive_id = d.id)
     and not exists (select 1 from drive_target_campuses
                      where drive_id = d.id and campus_id = s.campus_id) then
    raise exception 'This drive is not open to your campus.'
      using errcode = 'check_violation';
  end if;

  -- ------------------------------------------------- the school marks bars
  -- Verified figures: the coordinator checked them against the marksheet at
  -- approval, and 0009 stops the student changing them afterwards. A NULL
  -- percentage against a bar that is set is a refusal, not a pass - "we do not
  -- know" cannot clear a threshold.
  if d.min_tenth_percentage is not null
     and (s.tenth_percentage is null or s.tenth_percentage < d.min_tenth_percentage) then
    raise exception 'This drive requires at least % in your 10th.', d.min_tenth_percentage
      using errcode = 'check_violation';
  end if;

  if d.min_twelfth_percentage is not null
     and (s.twelfth_percentage is null or s.twelfth_percentage < d.min_twelfth_percentage) then
    raise exception 'This drive requires at least % in your 12th.', d.min_twelfth_percentage
      using errcode = 'check_violation';
  end if;

  -- R5a: the override bypasses the preference gates below — never the ones above.
  if d.open_to_all_override then
    return new;
  end if;

  -- ------------------------------------------------------------- the area
  if d.role_category is not null
     and exists (select 1 from student_role_preferences p where p.student_id = new.student_id)
     and not exists (
       select 1 from student_role_preferences p
        where p.student_id = new.student_id and p.category = d.role_category
     ) then
    raise exception
      'This drive is for an area you did not choose on your registration form.'
      using errcode = 'check_violation';
  end if;

  -- R4 — the internship cap, checked BEFORE the ladder (decision Q2).
  if d.drive_type in ('internship', 'internship_convertible') and exists (
       select 1 from offers o
        where o.student_id = new.student_id
          and o.drive_type in ('internship', 'internship_convertible')
     ) then
    raise exception 'You have already accepted an internship offer.'
      using errcode = 'check_violation';
  end if;

  -- R3/R5 — the ladder. Rank mirrors offerCategoryRank in
  -- src/domain/offer-category.ts; change both or neither.
  if d.drive_type in ('placement', 'internship_convertible')
     and d.offer_category is not null then
    select max(case o.offer_category
                 when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
               end)
      into highest_rank
      from offers o
     where o.student_id = new.student_id
       and o.drive_type in ('placement', 'internship_convertible')
       and o.offer_category is not null;

    drive_rank := case d.offer_category
                    when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
                  end;

    if highest_rank is not null and drive_rank <= highest_rank then
      raise exception
        'You are already placed at this category or higher, so this drive is not open to you.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- --------------------------------------------- and it is not listed to them
-- 0030 let a student read published drives targeted at their campus. A drive
-- for an area they did not choose is not theirs to read either: "This should go
-- to the students only showing interest in that area."
--
-- Deliberately coarser than the domain, like the rest of this policy: it says
-- what may be READ, while src/domain/visibility.ts says what may be APPLIED
-- for, with reasons. The read path must not reference `drives` from a table
-- whose own policy reads `drives` back - `student_role_preferences` does not,
-- so there is no recursion here (see 0030's note).
drop policy if exists drives_student_read on drives;

create policy drives_student_read on drives for select
  using (
    current_student_id() is not null
    and status in ('live', 'applications_closed', 'in_rounds', 'completed')
    and (
      not exists (select 1 from drive_target_campuses t where t.drive_id = drives.id)
      or exists (
        select 1
          from drive_target_campuses t
          join students me on me.id = current_student_id()
         where t.drive_id = drives.id and t.campus_id = me.campus_id
      )
    )
    and (
      drives.role_category is null
      or not exists (
        select 1 from student_role_preferences p where p.student_id = current_student_id()
      )
      or exists (
        select 1 from student_role_preferences p
         where p.student_id = current_student_id() and p.category = drives.role_category
      )
    )
  );

-- =============================================================================
-- Migration: 0051_pif_jd_shift_and_joining.sql
-- =============================================================================

-- 0051 — the recruiter's own JD, the shift as a value, and the joining timeline
-- as a decision rather than as prose.
--
-- 2026-08-18 (Karthik):
--   "in the PIF, add an option to ATTACH a JD (job description) as PDF FILE."
--   "Shift time, instead of a text box, change to radio button - Day and Night
--    as options with time to be filled as text for night box."
--   "in offer rollout and joining timeline, instead of a large text box, have
--    radio button for immediate joining and joining later. Have a comments box
--    also for both the options."
--
-- Approved answers 1-10 (docs/specs/2026-08-18-pif-jd-attachment-shift-and-joining.md):
-- the PDF sits BESIDE the typed description and neither is mandatory; every
-- staff role AND the students who can see the drive may download it; the shift
-- gains Rotational and Flexible; one comment box PER joining option; the
-- joining choice is required at submit and its comment is not; the four live
-- drives are left exactly as they are.
--
-- ⚠️ NOTHING IS BACKFILLED. The live drives hold `shift_type = 'General'`,
-- which is what an AE typed into a free-text box. Deciding that it means "day"
-- would invent a fact no recruiter ever stated, and it would be shown to a
-- student as if somebody had checked it. `describeShift` repeats an
-- unrecognised value verbatim instead.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'joining_timeline') then
    create type joining_timeline as enum ('immediate', 'later');
  end if;
end $$;

alter table drives
  -- J1. Three columns, not one: a storage path is not a file name and neither
  -- is a size, and the AE, the Delivery Head and the student are all shown the
  -- NAME the recruiter gave it, never the timestamped path.
  add column if not exists jd_storage_path text,
  add column if not exists jd_file_name    text,
  add column if not exists jd_size_bytes   bigint,
  -- J2. `shift_type` keeps its column; only its vocabulary is new.
  add column if not exists shift_night_timing text,
  -- J3. `timeline_notes` is untouched — it is where the live drives keep their
  -- whole joining story, and answer 9 leaves them alone.
  add column if not exists joining_timeline        joining_timeline,
  add column if not exists joining_immediate_notes text,
  add column if not exists joining_later_notes     text;

-- ---------------------------------------------------------------------------
-- 2. The rules
-- ---------------------------------------------------------------------------

do $$
begin
  -- A path with no name, or a name with no path, is a link that opens nothing.
  -- The size bound mirrors the bucket's own limit, so a row can never claim an
  -- object the bucket would have refused.
  if not exists (select 1 from pg_constraint where conname = 'jd_attachment_is_whole') then
    alter table drives add constraint jd_attachment_is_whole check (
      (jd_storage_path is null and jd_file_name is null and jd_size_bytes is null)
      or (
        jd_storage_path is not null
        and jd_file_name is not null
        and jd_size_bytes between 1 and 5242880
      )
    );
  end if;

  -- NOT VALID, deliberately, and for the same reason 0022's evidence
  -- constraints were: four live drives say 'General'. The rule governs every
  -- new and updated row from today; it does not refuse to deploy over history
  -- it was never asked to judge.
  if not exists (select 1 from pg_constraint where conname = 'shift_type_is_a_known_shift') then
    alter table drives add constraint shift_type_is_a_known_shift check (
      shift_type is null or shift_type in ('day', 'night', 'rotational', 'flexible')
    ) not valid;
  end if;

  -- The hours belong to a night shift and to nothing else. A timing left behind
  -- by a switch back to Day would be read beside "Day shift" as a fact.
  --
  -- One direction only: a night shift with NO hours is refused at submission by
  -- `pifSubmitSchema`, not here, because a DRAFT is allowed to be incomplete
  -- and a draft is a row like any other.
  --
  -- 🔴 `is not distinct from`, not `=`. A check constraint passes on NULL, so
  -- `shift_type = 'night'` is NULL when no shift was chosen at all, and the
  -- whole expression evaluates to NULL — which Postgres accepts. The test that
  -- caught it puts hours on a drive with no shift; the obvious spelling of
  -- this rule let that row straight through.
  if not exists (select 1 from pg_constraint where conname = 'night_timing_belongs_to_night') then
    alter table drives add constraint night_timing_belongs_to_night check (
      shift_night_timing is null or shift_type is not distinct from 'night'
    );
  end if;

  -- Same shape, both directions (0048's board/state rule): a comment about
  -- joining next July, surviving on a drive that now says immediate, is worse
  -- than no comment at all.
  -- `is not distinct from` for the same reason as above: a comment on a drive
  -- that has chosen NOTHING must not slip through on a NULL comparison.
  if not exists (select 1 from pg_constraint where conname = 'joining_notes_match_the_choice') then
    alter table drives add constraint joining_notes_match_the_choice check (
      (joining_immediate_notes is null or joining_timeline is not distinct from 'immediate')
      and (joining_later_notes is null or joining_timeline is not distinct from 'later')
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Storage — a bucket owned by drives, not by students
-- ---------------------------------------------------------------------------
--
-- Every bucket until now has been namespaced by STUDENT id, and every policy
-- says so. A JD belongs to a drive, so this one is namespaced by DRIVE id and
-- the read rule is delegated, deliberately:
--
--   you may read the JD if you may read the drive it belongs to.
--
-- The subquery runs as the caller, so `drives`' own RLS decides — 0030 for the
-- student (a live drive targeted at them), 0008/0044 for staff. That is one
-- rule rather than two, and it cannot drift away from who can see the drive.
--
-- Guarded exactly like 0010, so the PGlite harness (which has no storage
-- schema) can still run every other migration.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('job-descriptions', 'job-descriptions', false, 5242880, array['application/pdf'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  execute $p$ drop policy if exists "read a job description with its drive" on storage.objects $p$;
  execute $p$
    create policy "read a job description with its drive" on storage.objects for select
      using (
        bucket_id = 'job-descriptions'
        and exists (
          select 1 from public.drives d
          where d.id::text = (storage.foldername(name))[1]
        )
      )
  $p$;

  -- Only staff attach one. The AE raises the PIF; nobody else needs to write
  -- here, and a student must never be able to put a document in front of a
  -- recruiter under a drive's name.
  execute $p$ drop policy if exists "staff attach a job description" on storage.objects $p$;
  execute $p$
    create policy "staff attach a job description" on storage.objects for insert
      with check (
        bucket_id = 'job-descriptions'
        and public.current_app_role() is not null
      )
  $p$;
end $$;

-- =============================================================================
-- Migration: 0052_skill_scores_on_a_5_point_scale.sql
-- =============================================================================

-- 0052 — skill scores move to the 1–5 scale.
--
-- A35 ANSWERED (Karthik, 2026-08-19): "1-5 SCALE". The 0–100 scale was an
-- assumption from the day the repository shipped (0037); the client has now
-- named the real one. Whole numbers only — a 5-point scale with fractions is
-- a 50-point scale wearing a costume, and a coordinator's 3.5 silently
-- rounded is a number nobody typed.
--
-- Safe to swap outright: student_skill_scores holds 0 rows in production
-- (read live 2026-08-19, not remembered). No backfill, no conversion — there
-- is nothing to convert, which is exactly why this lands now rather than
-- after the first assessment is imported on the wrong scale.
--
-- A36 was answered the same day ("Students do not see their scores") and
-- needs NO migration: 0037's read policy already gives students nothing.

alter table student_skill_scores
  drop constraint score_within_scale;

alter table student_skill_scores
  add constraint score_within_scale
  check (score >= 1 and score <= 5 and score = round(score));

-- =============================================================================
-- Migration: 0053_uat_stipend_contacts_round_details.sql
-- =============================================================================

-- 0053 — UAT 2026-08-19: the stipend, the drive's contacts, the round's own
-- schedule, the per-student meeting slot, and the advance proof.
--
-- A2: an internship pays a monthly stipend, not an annual CTC. Two integer
--     columns (₹ per month), because "3.5" in a CTC box on an internship drive
--     is how a student plans a year around money that does not exist.
-- A4: contacts leave the four spoc_* columns for their own table — a drive can
--     carry several, and "no contact" is an honest state the UI explains (the
--     Central CPC becomes the point of contact, A5).
-- F4: a round carries its mode, its time and a shared interview link, editable
--     after creation.
-- F5: a participant can carry an INDIVIDUAL link and slot (online rounds with
--     per-student time slots).
-- F3: advancing can leave a proof of the company's instruction behind.

-- --------------------------------------------------------------- stipend (A2)

alter table drives
  add column if not exists stipend_min_monthly integer,
  add column if not exists stipend_max_monthly integer;

alter table drives
  add constraint stipend_is_positive check (
    (stipend_min_monthly is null or stipend_min_monthly > 0)
    and (stipend_max_monthly is null or stipend_max_monthly > 0)
  ),
  add constraint stipend_range_ascends check (
    stipend_min_monthly is null
    or stipend_max_monthly is null
    or stipend_max_monthly >= stipend_min_monthly
  );

-- --------------------------------------------------------- drive contacts (A4)

create table if not exists drive_contacts (
  drive_id    uuid not null references drives(id) on delete cascade,
  sequence    integer not null check (sequence > 0),
  name        text,
  designation text,
  email       text,
  phone       text,
  primary key (drive_id, sequence)
);

alter table drive_contacts enable row level security;

grant select, insert, update, delete on drive_contacts to authenticated;

-- Staff read them; a student never does. A recruiter's direct line handed to
-- six hundred students is a recruiter who stops answering the coordinator.
create policy drive_contacts_staff_read on drive_contacts for select
  using (current_app_role() is not null);

-- Writes follow the drive's own ownership: the AE while it is theirs, the
-- Delivery Head and the operators always — the same shape drive_rounds uses.
create policy drive_contacts_write on drive_contacts for all
  using (
    is_operator()
    or current_app_role() = 'delivery_head'
    or exists (
      select 1 from drives d
      where d.id = drive_contacts.drive_id
        and current_app_role() = 'account_executive'
        and d.created_by = auth.uid()
    )
  )
  with check (
    is_operator()
    or current_app_role() = 'delivery_head'
    or exists (
      select 1 from drives d
      where d.id = drive_contacts.drive_id
        and current_app_role() = 'account_executive'
        and d.created_by = auth.uid()
    )
  );

-- ------------------------------------------- the round's own details (F4, F3)

alter table drive_rounds
  add column if not exists round_mode text,
  add column if not exists round_scheduled_at timestamptz,
  add column if not exists round_interview_link text,
  add column if not exists advance_proof_path text;

alter table drive_rounds
  add constraint round_mode_is_known check (
    round_mode is null
    or round_mode in ('on_campus', 'virtual', 'physical_outside_campus')
  );

-- ------------------------------------------- the participant's own slot (F5)

alter table round_participants
  add column if not exists meeting_link text,
  add column if not exists participant_scheduled_at timestamptz;

-- ------------------------------------------------- the proof's bucket (F3)
--
-- Guarded exactly like 0051, so the PGlite harness (no storage schema) can
-- still run every other migration.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('advance-proofs', 'advance-proofs', false, 5242880,
          array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  -- Staff only, both ways: the proof is the company's instruction to move
  -- students, and no student has any business reading or writing it.
  execute $p$ drop policy if exists "staff read advance proofs" on storage.objects $p$;
  execute $p$
    create policy "staff read advance proofs" on storage.objects for select
      using (bucket_id = 'advance-proofs' and public.current_app_role() is not null)
  $p$;

  execute $p$ drop policy if exists "operators attach advance proofs" on storage.objects $p$;
  execute $p$
    create policy "operators attach advance proofs" on storage.objects for insert
      with check (bucket_id = 'advance-proofs' and public.is_operator())
  $p$;
end $$;

-- =============================================================================
-- Migration: 0054_drive_type_preference_and_round_notices.sql
-- =============================================================================

-- 0054 — UAT 2026-08-19:
--
-- D1: the student's DRIVE TYPE preference (placement / internship /
--     internship-convertible). A preference, not a sanction — it sits BELOW
--     R5a's override in the apply gate, exactly where the role-category area
--     sits, and an empty list means "no opinion", never "nothing".
--     Q6: no approval needed — the student changes it and new drives follow;
--     old applications carry their apply-time snapshot (R7) and never move.
--
-- F6: a round's schedule reaches its participants, and a per-student meeting
--     link reaches THAT student — in-app notifications, the 0043 pattern.

-- ------------------------------------------------------ D1: the preference

alter table students
  add column if not exists drive_type_preferences drive_type[] not null default '{}';

-- The gate, rebuilt from 0050 with ONE new preference block. The full
-- function is restated because CREATE OR REPLACE cannot patch a body.
create or replace function enforce_application_gates() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d drives%rowtype;
  s students%rowtype;
  highest_rank integer;
  drive_rank   integer;
begin
  if current_student_id() is null then
    return new;
  end if;

  select * into d from drives where id = new.drive_id;

  if d.status <> 'live' then
    raise exception 'This drive is not open.' using errcode = 'check_violation';
  end if;

  if d.application_start is null or d.application_end is null
     or now() < d.application_start or now() > d.application_end then
    raise exception 'The application window for this drive is closed.'
      using errcode = 'check_violation';
  end if;

  select * into s from students where id = new.student_id;

  if s.srf_status <> 'srf_approved' then
    raise exception 'Your registration form has not been approved yet.'
      using errcode = 'check_violation';
  end if;

  if s.participation_status <> 'active' then
    raise exception 'You have opted out of campus placements or are not currently eligible.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from drive_target_campuses tc where tc.drive_id = d.id)
     and not exists (
       select 1 from drive_target_campuses tc
        where tc.drive_id = d.id and tc.campus_id = s.campus_id
     ) then
    raise exception 'This drive is not open to your campus.'
      using errcode = 'check_violation';
  end if;

  -- ------------------------------------------------- the school marks bars
  if d.min_tenth_percentage is not null
     and (s.tenth_percentage is null or s.tenth_percentage < d.min_tenth_percentage) then
    raise exception 'This drive requires at least % in your 10th.', d.min_tenth_percentage
      using errcode = 'check_violation';
  end if;

  if d.min_twelfth_percentage is not null
     and (s.twelfth_percentage is null or s.twelfth_percentage < d.min_twelfth_percentage) then
    raise exception 'This drive requires at least % in your 12th.', d.min_twelfth_percentage
      using errcode = 'check_violation';
  end if;

  -- R5a: the override bypasses the preference gates below — never the ones above.
  if d.open_to_all_override then
    return new;
  end if;

  -- ------------------------------------------------------------- the area
  if d.role_category is not null
     and exists (select 1 from student_role_preferences p where p.student_id = new.student_id)
     and not exists (
       select 1 from student_role_preferences p
        where p.student_id = new.student_id and p.category = d.role_category
     ) then
    raise exception
      'This drive is for an area you did not choose on your registration form.'
      using errcode = 'check_violation';
  end if;

  -- ----------------------------------------- D1: the drive-type preference
  -- Same semantics as the area: an empty list is silence, and silence is not
  -- refusal. A student who asked only for internships is not shown — and here,
  -- not admitted to — a placement drive.
  if d.drive_type is not null
     and cardinality(s.drive_type_preferences) > 0
     and not (d.drive_type = any (s.drive_type_preferences)) then
    raise exception
      'This drive''s drive type is not among the ones you asked for in your preferences.'
      using errcode = 'check_violation';
  end if;

  -- R4 — the internship cap, checked BEFORE the ladder (decision Q2).
  if d.drive_type in ('internship', 'internship_convertible') and exists (
       select 1 from offers o
        where o.student_id = new.student_id
          and o.drive_type in ('internship', 'internship_convertible')
     ) then
    raise exception 'You have already accepted an internship offer.'
      using errcode = 'check_violation';
  end if;

  -- R3/R5 — the ladder. Rank mirrors offerCategoryRank in
  -- src/domain/offer-category.ts; change both or neither.
  if d.drive_type in ('placement', 'internship_convertible')
     and d.offer_category is not null then
    select max(case o.offer_category
                 when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
               end)
      into highest_rank
      from offers o
     where o.student_id = new.student_id
       and o.drive_type in ('placement', 'internship_convertible')
       and o.offer_category is not null;

    drive_rank := case d.offer_category
                    when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
                  end;

    if highest_rank is not null and drive_rank <= highest_rank then
      raise exception
        'You are already placed at this category or higher, so this drive is not open to you.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- --------------------------------------------- F6: the schedule notifies

-- The round's own details changed: every participating student hears, with
-- the mode, the time (IST) and the shared link when one exists. Security
-- definer, like every notifying trigger since 0043.
create or replace function round_details_reach_students() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company text;
  v_body    text;
begin
  if new.round_mode is not distinct from old.round_mode
     and new.round_scheduled_at is not distinct from old.round_scheduled_at
     and new.round_interview_link is not distinct from old.round_interview_link then
    return new;  -- renames and proofs are not schedule news
  end if;

  select company_name into v_company from drives where id = new.drive_id;

  v_body := 'Round ' || new.sequence || ' (' || new.name || ') of ' || v_company
    || case when new.round_scheduled_at is not null
            then ' is scheduled for '
              || to_char(new.round_scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
              || ' IST'
            else ' has updated details' end
    || case when new.round_mode is not null
            then '. Mode: ' || replace(new.round_mode, '_', ' ') else '' end
    || case when new.round_interview_link is not null
            then '. Join at: ' || new.round_interview_link else '' end
    || '.';

  insert into notifications (student_id, kind, title, body)
  select a.student_id, 'round_scheduled',
         v_company || ' — Round ' || new.sequence || ' schedule', v_body
    from round_participants rp
    join applications a on a.id = rp.application_id
    join students s on s.id = a.student_id
   where rp.round_id = new.id
     and s.participation_status <> 'opted_out';

  return new;
end;
$$;

drop trigger if exists round_details_reach_students on drive_rounds;
create trigger round_details_reach_students
  after update on drive_rounds
  for each row execute function round_details_reach_students();

-- A per-student slot: that student alone hears, with THEIR link.
create or replace function meeting_slot_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student  uuid;
  v_company  text;
  v_sequence integer;
  v_opted    boolean;
begin
  if new.meeting_link is not distinct from old.meeting_link
     and new.participant_scheduled_at is not distinct from old.participant_scheduled_at then
    return new;
  end if;
  if new.meeting_link is null and new.participant_scheduled_at is null then
    return new;  -- clearing a slot is housekeeping, not news
  end if;

  select a.student_id, d.company_name, r.sequence,
         s.participation_status = 'opted_out'
    into v_student, v_company, v_sequence, v_opted
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
    join drive_rounds r on r.id = new.round_id
   where a.id = new.application_id;

  if v_opted then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (
    v_student,
    'meeting_link',
    v_company || ' — your Round ' || v_sequence || ' slot',
    'Your Round ' || v_sequence || ' of ' || v_company
      || case when new.participant_scheduled_at is not null
              then ' is at '
                || to_char(new.participant_scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
                || ' IST'
              else '' end
      || case when new.meeting_link is not null
              then '. Your meeting link: ' || new.meeting_link else '' end
      || '.'
  );

  return new;
end;
$$;

drop trigger if exists meeting_slot_reaches_student on round_participants;
create trigger meeting_slot_reaches_student
  after update on round_participants
  for each row execute function meeting_slot_reaches_student();

-- =============================================================================
-- Migration: 0055_round_details_freeze.sql
-- =============================================================================

-- 0055 — UAT 2026-08-20, G6c (Q5 answer a): a round's details freeze once
-- students begin participating.
--
-- "Round details remain editable even after a drive is completed and a
-- student has been selected. Round details should freeze once students begin
-- participating in interview rounds, to prevent retroactive changes to a
-- closed process."
--
-- The boundary is the first RECORDED fact — attendance marked present or
-- absent, or a result declared. A provisional QR self check-in does not
-- freeze: nobody has confirmed it, and a student's own tap must not lock the
-- coordinator out of correcting a wrong link before the round runs.
--
-- The UI refuses first (src/domain/rounds.ts, roundDetailsFrozen). This
-- trigger is the far side of that pair: a rule enforced only in the browser
-- is a suggestion.
--
-- `advance_proof_path` is deliberately NOT frozen — the advance happens
-- exactly when results exist, and its proof arrives with it.

create or replace function round_details_freeze_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the four detail columns are guarded. Anything else (name, proof,
  -- sequence) keeps its existing rules.
  if new.round_mode is not distinct from old.round_mode
     and new.round_scheduled_at is not distinct from old.round_scheduled_at
     and new.round_interview_link is not distinct from old.round_interview_link
     and new.venue is not distinct from old.venue then
    return new;
  end if;

  if exists (select 1 from round_results r where r.round_id = old.id)
     or exists (
       select 1 from attendance a
       where a.round_id = old.id and a.status in ('present', 'absent')
     ) then
    raise exception
      'Round details are locked - students have begun participating in this round.';
  end if;

  return new;
end;
$$;

drop trigger if exists round_details_freeze on drive_rounds;
create trigger round_details_freeze
  before update on drive_rounds
  for each row
  execute function round_details_freeze_guard();

-- =============================================================================
-- Migration: 0056_off_campus_venue_and_cap_only_internships.sql
-- =============================================================================

-- 0056 — UAT 2026-08-21:
--
-- Item 1 (Q1, answer b): the internship cap (R4) refuses PLAIN internship
--   drives only. An internship-convertible drive is primarily a placement,
--   so the category LADDER decides it — a student placed Regular via a
--   convertible offer keeps Dream convertibles open, exactly as the
--   placed-banner promises. Consuming the cap is unchanged: any internship
--   or convertible OFFER still uses the one allowance. Supersedes decision
--   Q2 (2026-08-12). Mirrors src/domain/visibility.ts; change both or
--   neither.
--
-- Item 2 (Q4/Q5): an off-campus (physical-outside or pooled) drive happens
--   at a venue the college does not own, and the PIF had nowhere to record
--   it. Nullable by design: NULL is "venue not yet confirmed" — the AE is
--   never blocked on a fact the company has not given them, and the Central
--   CPC records it post-submission once confirmed (drives_operator_update
--   already admits them; the audit trigger already remembers every change).

-- ---------------------------------------------------- item 2: the venue

alter table drives add column if not exists venue text;

comment on column drives.venue is
  'Where an off-campus (physical_outside_campus / pooled) drive happens. '
  'NULL means "venue not yet confirmed" — recorded late by the Central CPC.';

-- ------------------------------- item 1: the cap, narrowed to internships

-- The gate, rebuilt from 0054 with ONE changed block (R4). The full function
-- is restated because CREATE OR REPLACE cannot patch a body.
create or replace function enforce_application_gates() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d drives%rowtype;
  s students%rowtype;
  highest_rank integer;
  drive_rank   integer;
begin
  if current_student_id() is null then
    return new;
  end if;

  select * into d from drives where id = new.drive_id;

  if d.status <> 'live' then
    raise exception 'This drive is not open.' using errcode = 'check_violation';
  end if;

  if d.application_start is null or d.application_end is null
     or now() < d.application_start or now() > d.application_end then
    raise exception 'The application window for this drive is closed.'
      using errcode = 'check_violation';
  end if;

  select * into s from students where id = new.student_id;

  if s.srf_status <> 'srf_approved' then
    raise exception 'Your registration form has not been approved yet.'
      using errcode = 'check_violation';
  end if;

  if s.participation_status <> 'active' then
    raise exception 'You have opted out of campus placements or are not currently eligible.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from drive_target_campuses tc where tc.drive_id = d.id)
     and not exists (
       select 1 from drive_target_campuses tc
        where tc.drive_id = d.id and tc.campus_id = s.campus_id
     ) then
    raise exception 'This drive is not open to your campus.'
      using errcode = 'check_violation';
  end if;

  -- ------------------------------------------------- the school marks bars
  if d.min_tenth_percentage is not null
     and (s.tenth_percentage is null or s.tenth_percentage < d.min_tenth_percentage) then
    raise exception 'This drive requires at least % in your 10th.', d.min_tenth_percentage
      using errcode = 'check_violation';
  end if;

  if d.min_twelfth_percentage is not null
     and (s.twelfth_percentage is null or s.twelfth_percentage < d.min_twelfth_percentage) then
    raise exception 'This drive requires at least % in your 12th.', d.min_twelfth_percentage
      using errcode = 'check_violation';
  end if;

  -- R5a: the override bypasses the preference gates below — never the ones above.
  if d.open_to_all_override then
    return new;
  end if;

  -- ------------------------------------------------------------- the area
  if d.role_category is not null
     and exists (select 1 from student_role_preferences p where p.student_id = new.student_id)
     and not exists (
       select 1 from student_role_preferences p
        where p.student_id = new.student_id and p.category = d.role_category
     ) then
    raise exception
      'This drive is for an area you did not choose on your registration form.'
      using errcode = 'check_violation';
  end if;

  -- ----------------------------------------- D1: the drive-type preference
  -- Same semantics as the area: an empty list is silence, and silence is not
  -- refusal. A student who asked only for internships is not shown — and here,
  -- not admitted to — a placement drive.
  if d.drive_type is not null
     and cardinality(s.drive_type_preferences) > 0
     and not (d.drive_type = any (s.drive_type_preferences)) then
    raise exception
      'This drive''s drive type is not among the ones you asked for in your preferences.'
      using errcode = 'check_violation';
  end if;

  -- R4 — the internship cap, PLAIN internship drives only (Q1b, 2026-08-21,
  -- superseding decision Q2). A convertible drive falls through to the
  -- ladder below, which is what decides a placement.
  if d.drive_type = 'internship' and exists (
       select 1 from offers o
        where o.student_id = new.student_id
          and o.drive_type in ('internship', 'internship_convertible')
     ) then
    raise exception 'You have already accepted an internship offer.'
      using errcode = 'check_violation';
  end if;

  -- R3/R5 — the ladder. Rank mirrors offerCategoryRank in
  -- src/domain/offer-category.ts; change both or neither.
  if d.drive_type in ('placement', 'internship_convertible')
     and d.offer_category is not null then
    select max(case o.offer_category
                 when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
               end)
      into highest_rank
      from offers o
     where o.student_id = new.student_id
       and o.drive_type in ('placement', 'internship_convertible')
       and o.offer_category is not null;

    drive_rank := case d.offer_category
                    when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
                  end;

    if highest_rank is not null and drive_rank <= highest_rank then
      raise exception
        'You are already placed at this category or higher, so this drive is not open to you.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- =============================================================================
-- Migration: 0057_round_editing_absent_alerts_completion.sql
-- =============================================================================

-- 0057 — 21/08 batches B & C (mockups M1–M3 approved):
--
-- B2: the Central CPC may rename or REMOVE a drive's rounds — companies
--     eliminate rounds mid-drive. But a round with any recorded fact
--     (scheduled students, attendance, results) is history, and history
--     does not get edited: the 0055 freeze principle, extended to a
--     round's name and existence. Mirrors src/domain/round-editing.ts;
--     change both or neither.
--
-- C6: a student marked ABSENT hears about it the moment it is recorded —
--     the 0043 in-app notification pattern. Opted-out students get nothing
--     (D7), same as every other notification.
--
-- C3 (answer 3b): completing a drive early demands a typed reason; it
--     lives on the row so the audit log and the drive record both carry it.

-- ------------------------------------------ C3: the early-completion reason

alter table drives add column if not exists completed_reason text;

comment on column drives.completed_reason is
  'Why the Central CPC completed the drive before every applicant had a '
  'final outcome. NULL on a drive that completed in the ordinary way.';

-- --------------------------------------- B2: rename/remove freeze trigger

create or replace function enforce_round_editing() returns trigger
language plpgsql set search_path = public as $$
declare
  v_round_id uuid;
  v_freeze   text;
begin
  v_round_id := coalesce(old.id, new.id);

  -- Only a NAME change or a DELETE is judged here. 0055 already freezes the
  -- logistics (venue/link/schedule) at the first recorded fact; sequence
  -- renumbering after a removal must stay possible, and 0055's rule already
  -- governs everything else worth protecting.
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then
    return new;
  end if;

  select case
           when exists (select 1 from round_results r where r.round_id = v_round_id)
             then 'results are recorded in this round'
           when exists (select 1 from attendance a
                         where a.round_id = v_round_id and a.status <> 'scheduled')
             then 'attendance is recorded in this round'
           when exists (select 1 from round_participants p where p.round_id = v_round_id)
             then 'students are scheduled into this round'
         end
    into v_freeze;

  if v_freeze is not null then
    if tg_op = 'DELETE' then
      raise exception 'This round cannot be removed — %.', v_freeze
        using errcode = 'check_violation';
    end if;
    raise exception 'This round cannot be renamed — %.', v_freeze
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger enforce_round_editing_update
  before update on drive_rounds
  for each row execute function enforce_round_editing();

create trigger enforce_round_editing_delete
  before delete on drive_rounds
  for each row execute function enforce_round_editing();

-- ------------------------------------------------- C6: the absent alert

create or replace function notify_absent_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student   uuid;
  v_company   text;
  v_round     text;
  v_opted_out boolean;
begin
  -- Fire only when a row BECOMES absent — re-saving an absent row is not
  -- a second absence, and neither is confirming a different status.
  if new.status <> 'absent' or (tg_op = 'UPDATE' and old.status = 'absent') then
    return new;
  end if;

  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted_out
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select coalesce(dr.name, 'Round ' || dr.sequence)
    into v_round
    from drive_rounds dr
   where dr.id = new.round_id;

  -- The application row is gone or unreadable: nothing to say, nobody to say
  -- it to. Never fail the attendance write over its own side effect.
  if v_student is null or v_opted_out then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (
    v_student,
    'absent',
    'Marked absent — ' || coalesce(v_company, 'a drive'),
    'You were marked absent for ' || coalesce(v_round, 'a round') || ' of the ' ||
    coalesce(v_company, 'drive') || ' drive. Absences across drives are counted ' ||
    'and repeated absence is reviewed. Contact your placement coordinator if ' ||
    'this is a mistake.'
  );

  return new;
end;
$$;

create trigger notify_absent_student
  after insert or update on attendance
  for each row execute function notify_absent_student();

-- =============================================================================
-- Migration: 0058_skill_catalogue_ae_read.sql
-- =============================================================================

-- The AE reads the assessed-skills catalogue.
--
-- Spec 2026-08-21 part A, approved 2026-08-24 (Karthik: "Only these skills
-- should be selectable by the account executive when raising the PIF.
-- Anything outside this list he has to call it out as other skills.").
--
-- The PIF's free-text mandatory skills produced a live drive that said
-- "Coding, Testing" while the repository's areas have other names — so every
-- applicant read "Scored on 0 of 2 required skills" no matter how strong they
-- were. The picker needs the catalogue NAMES; nothing more.
--
-- Deliberately narrow: SELECT on `skill_areas` alone. The AE still reads no
-- row of `student_skill_scores` (0037's policy untouched) — the scores are
-- the institution's private evaluation, and the AE is the person talking to
-- recruiters.

create policy skill_areas_ae_read on skill_areas for select
  using (current_app_role() = 'account_executive');

-- =============================================================================
-- Migration: 0059_skill_removal_keeps_scores.sql
-- =============================================================================

-- Skills assessed (2026-08-24, answer 1a): remove only while no scores exist.
--
-- 0037 made student_skill_scores.skill_area_id ON DELETE CASCADE — right for
-- an admin-corrective delete that happened over SQL with eyes open, wrong the
-- moment a Remove button exists: one click would silently destroy every
-- evaluation recorded under that skill. RESTRICT makes the database refuse
-- what canRemoveSkillArea refuses, so the rule holds even against direct SQL.
--
-- Renaming stays free — scores reference the id, so they follow the name.

alter table student_skill_scores
  drop constraint student_skill_scores_skill_area_id_fkey,
  add constraint student_skill_scores_skill_area_id_fkey
    foreign key (skill_area_id) references skill_areas(id) on delete restrict;

-- =============================================================================
-- Migration: 0060_live_accepts_attached_jd.sql
-- =============================================================================

-- A drive whose JD is the recruiter's attached PDF may go live.
--
-- J1 (2026-08-18, answer 2) made the typed job description optional — the
-- attached PDF is the document of record. The 2026-08-24 morning fix taught
-- `missingBeforeGoLive` exactly that, and missed this constraint: 0004's
-- `live_requires_complete_record` still said `job_description is not null`.
-- So the live Infosys drive passed every checklist tick and the publish
-- PATCH died on a refusal the screen then swallowed ("Could not publish the
-- drive. Please try again.").
--
-- The rule, stated once more: a domain rule and its database twin change
-- together or not at all.
--
-- Restated VERBATIM from 0004 (the 0054 lesson: copy, diff, then change the
-- one clause) with a single edit: the JD requirement is satisfied by EITHER
-- the typed text OR the attached PDF — mirroring DriveReadiness.
--
-- Re-adding the constraint validates every existing row; all current live
-- rows carry typed text (they predate J1's optionality), so nothing fails.

alter table drives
  drop constraint live_requires_complete_record,
  add constraint live_requires_complete_record check (
    status in ('draft', 'submitted', 'approved', 'rejected')
    or (
      not on_hold
      and role_title is not null
      and (job_description is not null or jd_storage_path is not null)
      and work_locations is not null and ctc_min_lpa is not null
      and role_category is not null and drive_type is not null
      and (drive_type = 'internship' or offer_category is not null)
      and application_start is not null and application_end is not null
    )
  );

-- =============================================================================
-- Migration: 0061_semester_verification_queue.sql
-- =============================================================================

-- The semester (CGPA) verification queue — database half.
--
-- 2026-08-24 UAT (Karthik): "add request by students for cgpa which has to be
-- approved by campus placement coordinator is not showing up for approval.
-- similar request for certifications is showing up. but cgpa is not."
--
-- He was right twice over. Certificates got a dedicated queue (0038/0039);
-- semesters only ever verify as a side effect of SRF approval (0031). A
-- semester added AFTER approval — F13's whole point — sat `pending` forever,
-- which is why a student with three declared semesters was still judged at
-- CGPA 0 wherever no verified line existed.
--
-- Modelled on 0038, clause for clause:
--
-- 1. A rejection names its reason ON the row, where the student reads it.
-- 2. A REJECTED line becomes the student's to remove — the unique
--    (student_id, semester_number) key would otherwise block the corrected
--    re-declaration for good. Verified lines stay untouchable (Q4), and
--    pending ones were already removable (they are the student's own claim).
--
-- No new UPDATE policy: `semesters_write_staff` (0018) already lets the
-- campus CPC decide their own students' rows, which is exactly who the queue
-- belongs to (D3).

alter table student_semesters
  add column rejection_reason text;

alter table student_semesters
  add constraint semester_rejected_has_reason
    check (status <> 'rejected' or btrim(coalesce(rejection_reason, '')) <> '');

drop policy if exists semesters_delete_self on student_semesters;
create policy semesters_delete_self on student_semesters for delete
  using (
    student_id = current_student_id()
    and status in ('pending', 'rejected')
  );

-- =============================================================================
-- Migration: 0062_offer_letters.sql
-- =============================================================================

-- Offer letters attached to a final selection.
--
-- Spec 2026-08-21 part B, approved 2026-08-24 (answers: 1a yes · 1b PDF +
-- JPG/PNG ≤ 5 MB · 1c staff-who-can-read-the-offer + the student · 1d
-- attach-later allowed).
--
-- The letter is the recruiter's document; the offer row is our claim. Both
-- halves of the attachment travel together (the 0051 rule): a path with no
-- name, or a name with no path, is a link that opens nothing.

alter table offers
  add column attachment_path text,
  add column attachment_name text;

alter table offers
  add constraint offer_attachment_is_whole check (
    (attachment_path is null and attachment_name is null)
    or (attachment_path is not null and attachment_name is not null)
  );

-- The bucket, namespaced `<student_uuid>/<drive_uuid>/<file>`.
--
-- READ is delegated to the offers table's own RLS (the 0051 pattern): you may
-- open a letter if you may read an offer for that student and drive. The
-- subquery runs as the caller, so `offers_read_self` admits the student the
-- letter belongs to, `offers_read_staff` admits org readers and campus
-- readers for their own students — exactly answer 1c, and it cannot drift
-- from who can see the offer.
--
-- WRITE is the operator's (Central CPC declares final selections; admin is
-- the operator pair). Guarded like 0051 so the PGlite harness, which has no
-- storage schema, still runs every other statement.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('offer-letters', 'offer-letters', false, 5242880,
          array['application/pdf', 'image/jpeg', 'image/png'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types,
        public = false;

  execute $p$ drop policy if exists "read an offer letter with its offer" on storage.objects $p$;
  execute $p$
    create policy "read an offer letter with its offer" on storage.objects for select
      using (
        bucket_id = 'offer-letters'
        and exists (
          select 1 from public.offers o
          where o.student_id::text = (storage.foldername(name))[1]
            and o.drive_id::text = (storage.foldername(name))[2]
        )
      )
  $p$;

  execute $p$ drop policy if exists "operator attaches an offer letter" on storage.objects $p$;
  execute $p$
    create policy "operator attaches an offer letter" on storage.objects for insert
      with check (
        bucket_id = 'offer-letters'
        and public.is_operator()
      )
  $p$;
end $$;

-- =============================================================================
-- Migration: 0063_resume_paths_are_object_keys.sql
-- =============================================================================

-- A resume's storage_path is the OBJECT KEY, not the bucket-qualified path.
--
-- 2026-08-26. Karthik: "Export shortlist (CSV)" answered with
--   "A resume could not be downloaded (…-images (6).pdf). Try the export again."
--
-- `apply-repository` uploaded the object to `<student>/<file>` inside the
-- `resumes` bucket and then recorded `resumes/<student>/<file>` in this
-- column. The recruiter export downloads with
-- `storage.from('resumes').download(storage_path)`, so it asked for
-- `resumes/resumes/<student>/<file>` — an object that has never existed.
--
-- Confirmed against production before writing this: all 14 resume rows failed
-- to join `storage.objects`, so the pack had never once been built. Every
-- other uploader on this table (marksheets, certificates, offer letters, the
-- SRF's profile resumes) writes the bare key, and every other reader expects
-- it.
--
-- Participation evidence is deliberately NOT touched: `opt_out_declaration`
-- and `off_campus_offer` carry their bucket because one column there serves
-- two buckets, and `signedUrlFor` splits the bucket back off. Repairing those
-- would break the screens that read them.
--
-- Idempotent, and narrow on purpose:
--   * only `kind = 'resume'`;
--   * only a LEADING `resumes/`, so `<student>/resumes/cv.pdf` is untouched —
--     a folder may legitimately be named for its bucket, and rewriting it
--     would swap one file for another;
--   * never to the empty string: a row holding only `resumes/` names no
--     object, and blanking it would hide a malformed row instead of leaving
--     it visible.

update student_documents
   set storage_path = substring(storage_path from length('resumes/') + 1)
 where kind = 'resume'
   and storage_path like 'resumes/%'
   and length(storage_path) > length('resumes/');

-- =============================================================================
-- Migration: 0064_placement_totals.sql
-- =============================================================================

-- The organisation's placement figures, as AGGREGATES.
--
-- 2026-08-26, option A, approved by Karthik: "AE gets a landing page … give
-- them wider access of all placement overall numbers".
--
-- An Account Executive is neither is_org_reader() nor is_campus_reader(), so
-- `select from students` returns them nothing — deliberately, since 2026-08-17:
-- "the AE should only be able to view the students shortlisted or selected on
-- their drives". They asked for the NUMBERS, so they get exactly the numbers:
-- one row of counts from a security definer function, and never a student
-- record. Making them an org reader instead would have been one line and would
-- also have handed them every student's CGPA, email and phone.
--
-- ⚠️ This is a second statement of rules that live in src/domain/statistics.ts
-- and src/domain/ctc-statistics.ts. That is the Layer 2 bargain (CLAUDE.md:
-- the database enforces the same rules independently) and it is the same
-- bargain RLS already makes. src/db/placement-totals.test.ts pins the SQL to
-- both domain functions on a shared cohort, so the two cannot drift in silence.
--
-- The rules, restated:
--   * an OPTED-OUT student leaves the denominator entirely (PRD §16.2);
--   * a DISBARRED student stays in — a sanction is not a withdrawal;
--   * a SELF-PLACED offer is its own line and never an on-campus placement,
--     and it is counted across the whole roster, opt-outs included, exactly as
--     computePlacementStats counts it;
--   * ONE package figure per placed student (R9). The reported record is the
--     highest-CTC on-campus offer, ties to the earliest declared — for a CTC
--     the tie-break cannot change the value, so `max(ctc_lpa)` per student is
--     R9's figure.
--
-- The rate itself is NOT computed here. It is published by
-- src/domain/placement-totals.ts, so one rounding rule serves every screen.

create or replace function placement_totals()
returns table (
  eligible bigint,
  placed bigint,
  self_placed bigint,
  opted_out bigint,
  completed_drives bigint,
  highest_lpa numeric,
  lowest_lpa numeric,
  average_lpa numeric,
  median_lpa numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Aggregates are not public. Any member of staff may quote the
  -- organisation's placement figures; a student may not, and neither may a
  -- caller with no session at all.
  --
  -- `coalesce(..., false)` is not decoration. `current_app_role()` is NULL for
  -- anyone with no profile row - every student, and any caller with no session
  -- - so the expression is NULL, `not NULL` is NULL, and `if NULL then` does
  -- not fire. The guard would have let exactly the people it names through.
  -- Caught by src/db/placement-totals.test.ts before this ever ran anywhere.
  if not coalesce(
    is_org_reader()
    or is_campus_reader()
    or current_app_role() = 'account_executive',
    false
  ) then
    raise exception 'not permitted';
  end if;

  return query
  with counted as (
    select s.id, s.participation_status
      from students s
  ),
  on_campus as (
    select distinct o.student_id
      from offers o
     where o.source = 'on_campus'
       and o.drive_type in ('placement', 'internship_convertible')
  ),
  self_placed_students as (
    select distinct o.student_id
      from offers o
     where o.source = 'self_placed'
  ),
  -- R9: one figure per placed student, and only for students who count.
  records as (
    select o.student_id, max(o.ctc_lpa) as ctc_lpa
      from offers o
      join counted c on c.id = o.student_id
     where o.source = 'on_campus'
       and o.drive_type in ('placement', 'internship_convertible')
       and c.participation_status <> 'opted_out'
     group by o.student_id
  )
  select
    (select count(*) from counted where participation_status <> 'opted_out'),
    (select count(*) from counted c
      where c.participation_status <> 'opted_out'
        and c.id in (select student_id from on_campus)),
    (select count(*) from counted c
      where c.id in (select student_id from self_placed_students)),
    (select count(*) from counted where participation_status = 'opted_out'),
    (select count(*) from drives where status = 'completed'),
    -- Null rather than 0 when nobody is placed: zero is a real CTC.
    (select round(max(ctc_lpa), 2) from records),
    (select round(min(ctc_lpa), 2) from records),
    (select round(avg(ctc_lpa), 2) from records),
    -- percentile_cont is summariseCtc's median exactly: the midpoint of the
    -- two middle figures when the count is even.
    (select round(percentile_cont(0.5) within group (order by ctc_lpa)::numeric, 2) from records);
end;
$$;

revoke all on function placement_totals() from public;
grant execute on function placement_totals() to authenticated;

-- =============================================================================
-- Migration: 0065_placement_totals_not_for_anon.sql
-- =============================================================================

-- `placement_totals()` is not for signed-out visitors.
--
-- 0064 revoked EXECUTE from PUBLIC and granted it to `authenticated`. That is
-- enough in PGlite, where the test suite runs — and it was NOT enough on the
-- live project, which was checked immediately after the push:
--
--   proname            | security_definer | authenticated_may_call | anon_may_call
--   placement_totals   | t                | t                      | t
--
-- Supabase ships `alter default privileges ... grant execute on functions to
-- anon, authenticated, service_role`, so `anon` holds its own explicit grant
-- and revoking from PUBLIC never touched it. The suite would have gone on
-- saying this was closed.
--
-- The function's own guard already refuses a caller with no session
-- (`current_app_role()` is null → `not permitted`), so this was never an open
-- door. But a signed-out visitor should not be able to reach the
-- organisation's placement figures at all, not even to be told no — an
-- authorisation check is a second line, never the first.

revoke all on function placement_totals() from anon;

-- =============================================================================
-- Migration: 0066_offer_category_internship.sql
-- =============================================================================

-- 0066 — Karthik, 2026-08-27: "when he approves, he has three categories only
-- for placement (Regular, dream and super dream). add one more there, as
-- Internship."
--
-- This migration adds the enum value AND NOTHING ELSE. Postgres refuses to
-- USE a value added by ALTER TYPE inside the same transaction, so every
-- constraint that mentions it lives in 0067.
--
-- ---------------------------------------------------------------------------
-- WHY `before 'regular'` AND NOT AT THE END
--
-- An enum orders by declaration order. Appended (the default), 'internship'
-- would sort ABOVE 'super_dream', and the first person to write
-- `max(offer_category)` or `order by offer_category` in a report would make an
-- internship outrank every real offer — silently blocking that student from
-- every drive on the ladder (R5).
--
-- No code does that today: all four ladder computations (0041, 0050, 0054,
-- 0056) rank with an explicit CASE and are restricted to
-- `drive_type in ('placement','internship_convertible')` before they ever look
-- at a category. This is insurance against the ladder being written a fifth
-- time by someone who does not know that.
--
-- Placed first, an accidental ordering treats an internship as the LOWEST
-- value, which fails safe: a student is shown too much rather than too little,
-- and being shown a drive is reversible in a way that being hidden from one is
-- not.
--
-- The true rule remains: 'internship' is not on the ladder at all.
-- Note: 'internship' is already declared in the initial CREATE TYPE offer_category in 0001_enums.sql.
-- Commented out below to avoid PostgreSQL ERROR 55P04 in single-transaction execution:
-- alter type offer_category add value if not exists 'internship' before 'regular';

-- =============================================================================
-- Migration: 0067_internship_category_and_stipend_go_live.sql
-- =============================================================================

-- 0067 — the three consequences of 0066's new enum value.
--
-- Karthik, 2026-08-27, answering the pushback:
--   PB2 "Change all these to just Internship. all data is test so far."
--       → the internship category is MANDATORY, not merely allowed. One fact,
--         one spelling, for ever. Verified before writing: 13 offers exist and
--         none is an internship, so nothing has to be migrated.
--   Q8  "yes, relax it" → a drive must record a CTC **or** a stipend.
--   PB4 → the offer notification names an internship offer as one.

-- ============================================================ 1. drives
--
-- REPLACES `internship_has_no_category` from 0004, whose rule was:
--
--     check (drive_type is distinct from 'internship' or offer_category is null)
--     -- "Plain internships are not on the category ladder (PRD 11)."
--
-- That statement is still TRUE and is what `offerCategoryRank` enforces by
-- throwing. What changed is how the absence is written down: a null that had
-- to be interpreted becomes a value that says what it means.

alter table drives drop constraint if exists internship_has_no_category;

alter table drives
  add constraint internship_carries_internship_category check (
    case drive_type
      when 'internship' then offer_category is null or offer_category = 'internship'
      else offer_category is distinct from 'internship'
    end
  );

comment on constraint internship_carries_internship_category on drives is
  'The type and the category are a pair. An internship drive is classified '
  '''internship'' and nothing else; no other drive type may borrow that value. '
  'NULL is still admitted here because a drive is raised before it is '
  'classified — the Delivery Head sets the category at approval, and '
  'live_requires_complete_record is what refuses to publish an unclassified one. '
  'Mirrored by offerCategoryAllowedFor in src/domain/offer-category.ts.';

-- ============================================================ 2. offers
--
-- The same pairing, but MANDATORY: an offer is only ever written once the
-- drive is classified, so there is no "not yet" state to allow for. Without
-- the NOT NULL half, an internship offer could be written either way and
-- every future query would have to know both spellings.

-- Named differently from the drives one (0006 called it
-- `internship_offer_has_no_category`), which is exactly why both names are
-- dropped explicitly rather than by guesswork.
alter table offers drop constraint if exists internship_offer_has_no_category;
alter table offers drop constraint if exists internship_has_no_category;

alter table offers
  add constraint internship_carries_internship_category check (
    case drive_type
      when 'internship' then offer_category = 'internship'
      else offer_category is distinct from 'internship'
    end
  );

comment on constraint internship_carries_internship_category on offers is
  'An internship offer carries the internship category — required, not '
  'optional, so that "is this an internship?" has exactly one answer in the '
  'data. It remains off the R3/R5 ladder: every ladder query filters on '
  'drive_type in (''placement'',''internship_convertible'') before it looks at '
  'a category, so this value is never ranked.';

-- ============================================== 3. the go-live gate (P10)
--
-- Rebuilt from 0060 with ONE changed line. A plain internship pays a monthly
-- stipend and has no CTC, so demanding ctc_min_lpa meant both internship
-- drives in production could be approved and then never published.
--
-- Only an internship may lean on the stipend. A full-time role advertised
-- with a monthly figure and no salary is a mistake worth catching.
--
-- Mirrors missingBeforeGoLive in src/domain/drive-lifecycle.ts; change both
-- or neither.

alter table drives
  drop constraint live_requires_complete_record,
  add constraint live_requires_complete_record check (
    status in ('draft', 'submitted', 'approved', 'rejected')
    or (
      not on_hold
      and role_title is not null
      and (job_description is not null or jd_storage_path is not null)
      and work_locations is not null
      and (
        ctc_min_lpa is not null
        or (
          drive_type = 'internship'
          and (coalesce(stipend_min_monthly, 0) > 0 or coalesce(stipend_max_monthly, 0) > 0)
        )
      )
      and role_category is not null and drive_type is not null
      and offer_category is not null
      and application_start is not null and application_end is not null
    )
  );

comment on constraint live_requires_complete_record on drives is
  'PRD 6.2 — everything a drive needs before it may go live, plus the '
  'invariant that an on-hold drive can never be published. 2026-08-27: a drive '
  'must record what it PAYS — a CTC, or a monthly stipend when it is an '
  'internship. Every live drive now carries a category, because an internship '
  'has one of its own.';

-- ================================================ 4. the offer notification
--
-- Rebuilt from 0043. Internship offers used to skip the category clause
-- entirely (they had no category); with one, the generic wording would read
-- "has made you an offer (internship)". Named properly instead.

create or replace function offer_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_opted boolean;
begin
  if new.source <> 'on_campus' then
    return new;  -- a self-placed offer is the student's own news
  end if;

  -- 0043's guard, restated in full: an opted-out student is not notified.
  -- CREATE OR REPLACE cannot patch a body, so every line of the original has
  -- to be carried across, and dropping this one would have written to people
  -- who asked not to be written to.
  select participation_status = 'opted_out' into v_opted
    from students where id = new.student_id;
  if v_opted then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (
    new.student_id,
    'offer',
    'Offer from ' || new.company_name,
    case
      when new.offer_category = 'internship'
        then 'Congratulations — ' || new.company_name || ' has made you an internship offer.'
      when new.offer_category is not null
        then 'Congratulations — ' || new.company_name || ' has made you an offer ('
             || replace(new.offer_category::text, '_', ' ') || ').'
      else 'Congratulations — ' || new.company_name || ' has made you an offer.'
    end
  );

  return new;
end;
$$;

-- =============================================================================
-- Migration: 0068_notifications_say_the_category_and_name_their_drive.sql
-- =============================================================================

-- UAT 2026-08-27 — what a notification says, and what it points at.
--
-- `docs/inbox/WhatsApp Image 2026-08-27 at 17.54.15.jpeg` and
-- `docs/inbox/WhatsApp Image 2026-08-27 at 18.18.49 (1).jpeg`.
--
-- 1. THE DATABASE WAS SPELLING A DOMAIN VALUE. The offer notification read
--    "has made you an offer (super dream)" because 0043 — and 0067 after it —
--    built the words with `replace(offer_category::text, '_', ' ')`. Commits
--    12befe2 and 3531b0c gave every screen one spelling through
--    `offerCategoryLabel`; the triggers kept a second one. A student read
--    "super dream" in their notifications and "Super Dream" everywhere else.
--    The label now lives in one SQL function, mirroring `CATEGORY_LABEL` in
--    `src/domain/offer-category.ts`. Change both or neither.
--
-- 2. A NOTIFICATION COULD NOT BE LINKED BACK TO ITS DRIVE. "XYZ has made you
--    an internship offer." and nowhere to open the offer letter the CPC had
--    attached — because the row held no reference to anything. `drive_id` is
--    that reference: nullable (most notifications have no drive), and
--    `on delete set null` because a notification is a RECORD of what a
--    student was told and must outlive the drive it mentions.

-- ============================================ 1. one spelling, in Postgres too

comment on table notifications is
  'What the process has told a student. Append-in-practice: rows are never '
  'rewritten to change what was said. `drive_id` is a pointer for the UI, not '
  'part of the message.';

-- Mirrors CATEGORY_LABEL in src/domain/offer-category.ts. Immutable and
-- strict: an unrecognised value comes back as itself rather than as nothing,
-- because a category nobody knows is a data problem and an empty bracket is
-- how a data problem goes unnoticed.
create or replace function offer_category_label(category text)
  returns text language sql immutable set search_path = public as $$
  select case category
           when 'regular'     then 'Regular'
           when 'dream'       then 'Dream'
           when 'super_dream' then 'Super Dream'
           when 'internship'  then 'Internship'
           else category
         end;
$$;

-- ============================================ 2. the drive a notification names

alter table notifications
  add column if not exists drive_id uuid references drives(id) on delete set null;

comment on column notifications.drive_id is
  'The drive this notification is about, when there is one. Nullable, and '
  'cleared rather than cascaded: the notification is the record, the drive is '
  'only what it referred to.';

-- The student''s notification list is read whole and small; the index that
-- earns its keep is the unread one from 0006. No index added here on purpose.

-- ============================================ 3. the offer notification, rebuilt
--
-- Rebuilt from 0067 in full. CREATE OR REPLACE cannot patch a body, so every
-- line of the original is carried across deliberately:
--   * the self-placed early return (a self-placed offer is the student's own
--     news, not ours to announce),
--   * the opted-out guard from 0043 — dropping it would write to people who
--     asked not to be written to,
--   * PB4's internship wording, which names the offer instead of bracketing
--     a category that only restates the drive type.
-- What is new: `offer_category_label` instead of `replace()`, and `drive_id`.

create or replace function offer_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_opted boolean;
begin
  if new.source <> 'on_campus' then
    return new;  -- a self-placed offer is the student's own news
  end if;

  select participation_status = 'opted_out' into v_opted
    from students where id = new.student_id;
  if v_opted then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body, drive_id)
  values (
    new.student_id,
    'offer',
    'Offer from ' || new.company_name,
    case
      when new.offer_category = 'internship'
        then 'Congratulations — ' || new.company_name || ' has made you an internship offer.'
      when new.offer_category is not null
        then 'Congratulations — ' || new.company_name || ' has made you an offer ('
             || offer_category_label(new.offer_category::text) || ').'
      else 'Congratulations — ' || new.company_name || ' has made you an offer.'
    end,
    new.drive_id
  );

  return new;
end;
$$;

-- =============================================================================
-- Migration: 0069_backfill_offer_notification_drives.sql
-- =============================================================================

-- The notifications that were written before 0068 existed.
--
-- 0068 gave `notifications` a `drive_id` and taught `offer_reaches_student` to
-- set it. Production, checked immediately after the push: **14 offer
-- notifications, every one of them with a null drive** — and 4 offers already
-- carrying a letter the CPC had attached. Without this, exactly the students
-- Karthik was looking at would go on seeing nothing under the message that
-- told them they had an offer.
--
-- Written as a FUNCTION rather than a bare UPDATE so that it can be tested at
-- all: a statement that runs once inside a migration runs before any test
-- data exists, and can only ever be proved by reading it.
-- `src/db/uat-0069-backfill-offer-notification-drives.test.ts` calls it
-- against data it sets up itself.

create or replace function link_offer_notifications_to_drives()
  returns integer language plpgsql security definer set search_path = public as $$
declare
  v_linked integer;
begin
  -- Matched on the title the trigger itself writes ('Offer from ' || company)
  -- together with the student, and ONLY where that pair identifies exactly
  -- one drive. A student can be offered by the same company twice; guessing
  -- between them would put the wrong letter under the right words, and a
  -- wrong offer letter is worse than none.
  with candidate as (
    select n.id as notification_id,
           min(o.drive_id::text)::uuid as drive_id,
           count(distinct o.drive_id) as drives
      from notifications n
      join offers o
        on o.student_id = n.student_id
       and o.drive_id is not null
       and n.title = 'Offer from ' || o.company_name
     where n.kind = 'offer'
       and n.drive_id is null
     group by n.id
  )
  update notifications n
     set drive_id = c.drive_id
    from candidate c
   where n.id = c.notification_id
     and c.drives = 1;

  get diagnostics v_linked = row_count;
  return v_linked;
end;
$$;

comment on function link_offer_notifications_to_drives() is
  'Backfills notifications.drive_id for offer notifications written before '
  '0068. Idempotent: it only ever touches rows whose drive_id is null, and '
  'only when the student + company pair names exactly one drive.';

select link_offer_notifications_to_drives();

-- =============================================================================
-- Migration: 0070_an_internship_offer_records_a_stipend.sql
-- =============================================================================

-- An internship offer records a stipend, not a CTC.
--
-- Karthik, 2026-08-27: "go with option 1".
--
-- P10, resolved earlier the same day, let a DRIVE go live on a stipend alone
-- (0067's `live_requires_complete_record`). The OFFER at the end of that drive
-- was never changed to match: `offers.ctc_lpa` is NOT NULL and the declare
-- screen refuses anything ≤ 0. So the two offers already declared on the XYZ
-- internship — a drive paying **₹15,000 a month** — are recorded at
-- **₹10.00 and ₹12.00 LPA**. Nobody mistyped them. The box would not accept
-- anything else, and a coordinator with a student in front of them types
-- something.
--
-- This is P10's other half. The rule is the same shape and deliberately so:
-- an offer records what it PAYS, and only a plain internship may lean on the
-- stipend. `internship_convertible` becomes a salary and is quoted as one,
-- exactly as 0067 drew the line for drives.
--
-- Mirrors `offerPayProblem` in `src/domain/offer-pay.ts`. Change both or
-- neither.
--
-- ⚠️ The order below is load-bearing and was got wrong on the first attempt:
-- the repair sets `ctc_lpa` to NULL, so the NOT NULL must go FIRST. The push
-- failed on the real database with 23502 and rolled back whole — and the
-- PGlite suite had not caught it, because a fresh test database has no legacy
-- rows for the UPDATE to touch. Hence the repair is a FUNCTION: something a
-- test can call against data it creates itself.

-- ========================================================== 1. the column

alter table offers
  add column if not exists stipend_monthly integer check (stipend_monthly > 0);

comment on column offers.stipend_monthly is
  'What a plain internship offer pays, per month in rupees. Mutually '
  'exclusive with ctc_lpa: one fact, one spelling.';

-- ================================ 2. a CTC is no longer required of everyone

alter table offers alter column ctc_lpa drop not null;

-- ========================================================== 3. the repair
--
-- The stipend is read from the DRIVE rather than assumed, so this repairs
-- whatever the drive actually records rather than the ₹15,000 that happens to
-- be true today. Only rows that are demonstrably the defect are touched: a
-- plain internship offer, whose drive records a stipend, that has not already
-- been repaired. An internship offer whose drive records no stipend either
-- cannot be repaired from the data and is deliberately left alone for a
-- person to look at.

create or replace function repair_internship_offer_pay()
  returns integer language plpgsql security definer set search_path = public as $$
declare
  v_repaired integer;
begin
  update offers o
     set stipend_monthly = d.stipend_min_monthly,
         ctc_lpa         = null
    from drives d
   where d.id = o.drive_id
     and o.drive_type = 'internship'
     and d.stipend_min_monthly is not null
     and o.stipend_monthly is null;

  get diagnostics v_repaired = row_count;
  return v_repaired;
end;
$$;

comment on function repair_internship_offer_pay() is
  'Moves a plain internship offer''s invented CTC onto the stipend its drive '
  'records. Idempotent: an offer already carrying a stipend is not touched.';

select repair_internship_offer_pay();

-- ======================================================= 4. the rule itself
--
-- Checked against production before choosing the constraint's strength:
--   internship offers whose drive records no stipend .... 0
--   salaried offers with no CTC .......................... 0
-- Every existing row is therefore repairable, so this is VALIDATED rather
-- than NOT VALID. If the repair above ever fails to do its job, this
-- migration refuses to apply — the loud failure worth having, and strictly
-- better than a rule that quietly does not police the rows that provoked it.

alter table offers
  add constraint offer_records_what_it_pays check (
    case
      when drive_type = 'internship'
        then stipend_monthly is not null and ctc_lpa is null
      else ctc_lpa is not null and stipend_monthly is null
    end
  );

comment on constraint offer_records_what_it_pays on offers is
  'An offer records what it pays: a plain internship a monthly stipend, '
  'everything else an annual CTC — and never both. P10''s other half '
  '(2026-08-27). Mirrors offerPayProblem in src/domain/offer-pay.ts.';

-- =============================================================================
-- Migration: 0071_email_outbox_queue.sql
-- =============================================================================

-- Migration 0071: Outbox trigger enqueuing notifications into email_deliveries
-- PRD §21.2: Every student notification creates a queued delivery record.
-- The dispatcher reads queued deliveries and sends them via Resend.

create or replace function enqueue_notification_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_opted boolean;
begin
  select email, (participation_status = 'opted_out')
    into v_email, v_opted
    from students
   where id = new.student_id;

  -- Opted-out students or missing emails do not receive email
  if v_opted or v_email is null or trim(v_email) = '' then
    return new;
  end if;

  insert into email_deliveries (notification_id, recipient_email, status)
  values (new.id, lower(trim(v_email)), 'queued');

  return new;
end;
$$;

drop trigger if exists notification_enqueues_email on notifications;
create trigger notification_enqueues_email
  after insert on notifications
  for each row execute function enqueue_notification_email();

create index if not exists email_deliveries_queued_idx
  on email_deliveries (status, updated_at) where status = 'queued';

comment on trigger notification_enqueues_email on notifications is
  'Automatically stages an email_deliveries row for each student notification.';

-- =============================================================================
-- Migration: 0072_opt_out_requests_rls.sql
-- =============================================================================

-- Migration 0072: Row Level Security for opt_out_requests
--
-- PRD §16.1: An opt-out request is student-initiated, approved by a placement
-- coordinator, and irreversible once granted.
--
-- Like self_placement_requests (0014, 0018), students may read and insert only
-- their own requests. Coordinators read requests within their campus or org,
-- and only staff may decide (update) them.

alter table opt_out_requests enable row level security;
alter table opt_out_requests force  row level security;

-- A student reads their own requests; coordinators read their campus or org.
drop policy if exists student_reads_own_opt_out on opt_out_requests;
create policy student_reads_own_opt_out on opt_out_requests for select
  using (
    student_id = current_student_id()
    or is_org_reader()
    or (is_campus_reader() and student_id in (select my_student_ids()))
  );

-- A student may raise only their own opt-out request.
drop policy if exists student_raises_own_opt_out on opt_out_requests;
create policy student_raises_own_opt_out on opt_out_requests for insert
  with check (student_id = current_student_id());

-- Approval and decline are the coordinator's. A student has no update policy,
-- so they cannot approve or alter their own request.
drop policy if exists staff_decides_opt_out on opt_out_requests;
create policy staff_decides_opt_out on opt_out_requests for all
  using (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())))
  with check (is_operator() or (is_campus_staff() and student_id in (select my_student_ids())));

grant select, insert, update on opt_out_requests to authenticated;

-- =============================================================================
-- Migration: 0073_school_grades_and_arrears_sync.sql
-- =============================================================================

-- 0073 — School grades for Cambridge/Other boards, and syncing declared arrears on SRF submission.
--
-- 1. Cambridge International (IGCSE/O-Level/A-Level) and Other boards evaluate on
--    letter/scale grades rather than percentages. The SRF collects tenth_grade and
--    twelfth_grade, which must be stored on `students` so campus coordinators can
--    verify them against the uploaded Statement of Results.
-- 2. When a student declares semesters on the SRF, their current and history of arrears
--    are entered per semester. Syncing the latest semester's arrears to `students`
--    ensures the verification queue and reporting accurately display declared standing arrears.

alter table students
  add column if not exists tenth_grade   text,
  add column if not exists twelfth_grade text;

-- Replace submit_srf to store tenth_grade and twelfth_grade, and sync declared arrears.
create or replace function submit_srf(
  p_student          jsonb,
  p_semesters        jsonb,
  p_documents        jsonb,
  p_certificates     jsonb default '[]'::jsonb,
  p_role_categories  jsonb default '[]'::jsonb,
  p_resumes          jsonb default '[]'::jsonb
)
returns table (student_id uuid, srf_status srf_status)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_student_id uuid;
  v_slots      jsonb;
begin
  v_student_id := current_student_id();

  if v_student_id is null then
    raise exception 'We could not find your student record. Contact your placement coordinator.'
      using errcode = 'no_data_found';
  end if;

  with inserted as (
    insert into student_documents (student_id, kind, storage_path, size_bytes)
    select v_student_id,
           (d->>'kind')::document_kind,
           d->>'storage_path',
           (d->>'size_bytes')::int
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    returning id, storage_path
  )
  select coalesce(jsonb_object_agg(d->>'slot', i.id), '{}'::jsonb)
    into v_slots
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    join inserted i on i.storage_path = d->>'storage_path';

  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = p_student->>'whatsapp',
    alternate_contact     = p_student->>'alternate_contact',
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = (p_student->>'tenth_percentage')::numeric,
    tenth_board           = (p_student->>'tenth_board')::school_board,
    tenth_board_state     = p_student->>'tenth_board_state',
    tenth_board_other     = p_student->>'tenth_board_other',
    tenth_grade           = p_student->>'tenth_grade',
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = (p_student->>'twelfth_percentage')::numeric,
    twelfth_board         = (p_student->>'twelfth_board')::school_board,
    twelfth_board_state   = p_student->>'twelfth_board_state',
    twelfth_board_other   = p_student->>'twelfth_board_other',
    twelfth_grade         = p_student->>'twelfth_grade',
    diploma_institution   = p_student->>'diploma_institution',
    diploma_university    = p_student->>'diploma_university',
    diploma_marks         = (p_student->>'diploma_marks')::numeric,
    diploma_marks_scale   = (p_student->>'diploma_marks_scale')::marks_scale,
    diploma_marksheet_id  = (v_slots->>(p_student->>'diploma_marksheet_slot'))::uuid,
    passing_year          = (p_student->>'passing_year')::int,
    programme_level       = (p_student->>'programme_level')::programme_level,
    ug_degree             = p_student->>'ug_degree',
    ug_college            = p_student->>'ug_college',
    ug_branch             = p_student->>'ug_branch',
    ug_aggregate_declared = (p_student->>'ug_aggregate_declared')::numeric,
    ug_aggregate_scale    = (p_student->>'ug_aggregate_scale')::marks_scale,
    ug_aggregate_cgpa     = (p_student->>'ug_aggregate_cgpa')::numeric,
    ug_marksheet_id       = (v_slots->>(p_student->>'ug_marksheet_slot'))::uuid,
    technical_skills      = p_student->>'technical_skills',
    areas_of_interest     = p_student->>'areas_of_interest',
    areas_of_expertise    = p_student->>'areas_of_expertise',
    projects              = p_student->>'projects',
    achievements          = p_student->>'achievements',
    linkedin_url          = p_student->>'linkedin_url',
    github_url            = p_student->>'github_url',
    leetcode_url          = p_student->>'leetcode_url',
    hackerrank_url        = p_student->>'hackerrank_url',
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    consent_given_at      = now(),
    srf_status            = 'srf_submitted',
    srf_submitted_at      = now(),
    srf_draft             = null,
    srf_draft_saved_at    = null
  where id = v_student_id;

  delete from student_semesters where student_semesters.student_id = v_student_id;

  insert into student_semesters (
    student_id, semester_number, cgpa, declared_marks, marks_scale,
    current_arrears, history_of_arrears, marksheet_id
  )
  select v_student_id,
         (s->>'semester_number')::int,
         (s->>'cgpa')::numeric,
         (s->>'declared_marks')::numeric,
         (s->>'marks_scale')::marks_scale,
         (s->>'current_arrears')::int,
         (s->>'history_of_arrears')::int,
         (v_slots->>(s->>'marksheet_slot'))::uuid
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s;

  -- Sync declared arrears onto the student record from the latest declared semester
  update students
     set current_arrears    = latest.current_arrears,
         history_of_arrears = latest.history_of_arrears
    from (
      select current_arrears, history_of_arrears
        from student_semesters
       where student_id = v_student_id
       order by semester_number desc
       limit 1
    ) as latest
   where id = v_student_id;

  -- ------------------------------------------------------------ preferences
  delete from student_role_preferences
   where student_role_preferences.student_id = v_student_id;

  insert into student_role_preferences (student_id, category)
  select v_student_id, c::role_category
    from jsonb_array_elements_text(coalesce(p_role_categories, '[]'::jsonb)) as c
  on conflict do nothing;

  -- --------------------------------------------------------------- resumes
  delete from student_documents
   where student_documents.student_id = v_student_id
     and student_documents.kind = 'resume'
     and student_documents.drive_id is null
     and (
       student_documents.role_category::text in (
         select r->>'role_category' from jsonb_array_elements(coalesce(p_resumes, '[]'::jsonb)) as r
       )
       or student_documents.role_category::text not in (
         select c from jsonb_array_elements_text(coalesce(p_role_categories, '[]'::jsonb)) as c
       )
     );

  insert into student_documents (student_id, kind, role_category, storage_path, size_bytes)
  select v_student_id,
         'resume'::document_kind,
         (r->>'role_category')::role_category,
         r->>'storage_path',
         (r->>'size_bytes')::int
    from jsonb_array_elements(coalesce(p_resumes, '[]'::jsonb)) as r;

  -- Certificates. Only the undecided ones are the student's to replace.
  delete from student_certificates
   where student_certificates.student_id = v_student_id
     and student_certificates.status <> 'verified';

  insert into student_certificates (student_id, name, document_id)
  select v_student_id,
         c->>'name',
         (v_slots->>(c->>'document_slot'))::uuid
    from jsonb_array_elements(coalesce(p_certificates, '[]'::jsonb)) as c
   where lower(regexp_replace(btrim(c->>'name'), '\s+', ' ', 'g')) not in (
           select lower(regexp_replace(btrim(sc.name), '\s+', ' ', 'g'))
             from student_certificates sc
            where sc.student_id = v_student_id
         );

  return query
    select s.id, s.srf_status from students s where s.id = v_student_id;
end;
$$;

grant execute on function submit_srf(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- Backfill existing students so their current_arrears and history_of_arrears
-- match the declared values from their latest semester.
update students
   set current_arrears    = latest.current_arrears,
       history_of_arrears = latest.history_of_arrears
  from (
    select distinct on (student_id) student_id, current_arrears, history_of_arrears
      from student_semesters
     order by student_id, semester_number desc
  ) as latest
 where students.id = latest.student_id;

-- =============================================================================
-- Migration: 0074_fix_arrears_sync_trigger_conflict.sql
-- =============================================================================

-- 0074: Fix submit_srf returning 400 due to protect_verified_academics conflict.
--
-- 0073 added auto-sync of declared arrears from the latest submitted semester
-- to `students.current_arrears` / `students.history_of_arrears` inside
-- `submit_srf` (security invoker). This fired the `protect_verified_academics`
-- trigger (0020) which unconditionally blocks students from writing those two
-- columns at any time — treating them as coordinator-only figures.
--
-- The original intent of that block was sound for `overall_cgpa` (set by
-- verification), but arrears declared per-semester by the student on the SRF
-- MUST be able to land on the student row for the verification queue and drive
-- eligibility to read them. Locking them only after `srf_approved` is the same
-- rule that already applies to tenth/twelfth percentage and grades.
--
-- Changes:
-- 1. `protect_verified_academics` — move `current_arrears` / `history_of_arrears`
--    from the unconditional "never the student's" check to the "locked after
--    approval" block (mirrors the treatment of school percentages and grades).
-- 2. `submit_srf` — compute arrears from `p_semesters` JSONB directly into variables
--    and update `students` in one shot with safe null handling, preventing check
--    constraint violations or multiple trigger invocations.

create or replace function protect_verified_academics() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_student boolean;
begin
  -- Trusted server context (migrations, service role, admin tooling).
  -- Student requests always carry a JWT; RLS already blocks anonymous writes.
  if auth.uid() is null then
    return new;
  end if;

  is_student := exists (select 1 from students where auth_user_id = auth.uid());

  -- Staff: not linked to any student record.
  if not is_student then
    return new;
  end if;

  -- ---------------------------------------------------------------- status
  -- The one transition a student owns: sending their own form for checking.
  -- Everything else about srf_status remains the coordinator's.
  if new.srf_status is distinct from old.srf_status then
    if not (
      new.srf_status = 'srf_submitted'
      and old.srf_status in ('invited', 'registered', 'srf_rejected')
    ) then
      raise exception 'Verified academic data can only be changed by a placement coordinator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- -------------------------------------------------------------- marks
  -- Their own declaration until approved, locked afterwards.
  -- current_arrears / history_of_arrears are synced from the student's own
  -- semester declarations during SRF submission, so they are treated the same
  -- as tenth/twelfth percentage/grades: the student may write them before approval,
  -- and the coordinator owns them after.
  if old.srf_status = 'srf_approved' then
    if new.tenth_percentage   is distinct from old.tenth_percentage
    or new.twelfth_percentage is distinct from old.twelfth_percentage
    or new.tenth_grade        is distinct from old.tenth_grade
    or new.twelfth_grade      is distinct from old.twelfth_grade
    or new.current_arrears    is distinct from old.current_arrears
    or new.history_of_arrears is distinct from old.history_of_arrears then
      raise exception 'Verified academic data can only be changed by a placement coordinator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- --------------------------------------------------- never the student's
  -- Identity and standing come from the roster and from verification, never
  -- from the form. overall_cgpa is set by the coordinator after checking each
  -- semester; degree_id / branch_id / roll_number come from the roster;
  -- participation_status is an administrative decision.
  if new.overall_cgpa         is distinct from old.overall_cgpa
  or new.degree_id            is distinct from old.degree_id
  or new.branch_id            is distinct from old.branch_id
  or new.roll_number          is distinct from old.roll_number
  or new.participation_status is distinct from old.participation_status then
    raise exception 'Verified academic data can only be changed by a placement coordinator'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;


-- Replace submit_srf to compute arrears directly from p_semesters JSONB safely,
-- updating in the single primary statement with safe null/scale handling.
create or replace function submit_srf(
  p_student          jsonb,
  p_semesters        jsonb,
  p_documents        jsonb,
  p_certificates     jsonb default '[]'::jsonb,
  p_role_categories  jsonb default '[]'::jsonb,
  p_resumes          jsonb default '[]'::jsonb
)
returns table (student_id uuid, srf_status srf_status)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_student_id   uuid;
  v_slots        jsonb;
  v_latest_curr  integer;
  v_latest_hist  integer;
begin
  v_student_id := current_student_id();

  if v_student_id is null then
    raise exception 'We could not find your student record. Contact your placement coordinator.'
      using errcode = 'no_data_found';
  end if;

  with inserted as (
    insert into student_documents (student_id, kind, storage_path, size_bytes)
    select v_student_id,
           (d->>'kind')::document_kind,
           d->>'storage_path',
           (d->>'size_bytes')::int
      from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    returning id, storage_path
  )
  select coalesce(jsonb_object_agg(d->>'slot', i.id), '{}'::jsonb)
    into v_slots
    from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) as d
    join inserted i on i.storage_path = d->>'storage_path';

  -- Pre-extract latest semester arrears with safe defaults
  select
    coalesce((s->>'current_arrears')::int, 0),
    coalesce((s->>'history_of_arrears')::int, 0)
    into v_latest_curr, v_latest_hist
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s
   order by (s->>'semester_number')::int desc
   limit 1;

  if v_latest_curr is null then
    select current_arrears, history_of_arrears
      into v_latest_curr, v_latest_hist
      from students where id = v_student_id;
  end if;

  v_latest_curr := greatest(coalesce(v_latest_curr, 0), 0);
  v_latest_hist := greatest(coalesce(v_latest_hist, 0), v_latest_curr);

  -- Single UPDATE: carries profile, grades, and arrears atomically
  update students set
    full_name             = p_student->>'full_name',
    mobile                = p_student->>'mobile',
    whatsapp              = nullif(p_student->>'whatsapp', ''),
    alternate_contact     = nullif(p_student->>'alternate_contact', ''),
    tenth_institution     = p_student->>'tenth_institution',
    tenth_percentage      = nullif(p_student->>'tenth_percentage', '')::numeric,
    tenth_board           = nullif(p_student->>'tenth_board', '')::school_board,
    tenth_board_state     = nullif(p_student->>'tenth_board_state', ''),
    tenth_board_other     = nullif(p_student->>'tenth_board_other', ''),
    tenth_grade           = nullif(p_student->>'tenth_grade', ''),
    twelfth_institution   = p_student->>'twelfth_institution',
    twelfth_percentage    = nullif(p_student->>'twelfth_percentage', '')::numeric,
    twelfth_board         = nullif(p_student->>'twelfth_board', '')::school_board,
    twelfth_board_state   = nullif(p_student->>'twelfth_board_state', ''),
    twelfth_board_other   = nullif(p_student->>'twelfth_board_other', ''),
    twelfth_grade         = nullif(p_student->>'twelfth_grade', ''),
    diploma_institution   = nullif(p_student->>'diploma_institution', ''),
    diploma_university    = nullif(p_student->>'diploma_university', ''),
    diploma_marks         = nullif(p_student->>'diploma_marks', '')::numeric,
    diploma_marks_scale   = nullif(p_student->>'diploma_marks_scale', '')::marks_scale,
    diploma_marksheet_id  = nullif(v_slots->>(p_student->>'diploma_marksheet_slot'), '')::uuid,
    passing_year          = nullif(p_student->>'passing_year', '')::int,
    programme_level       = nullif(p_student->>'programme_level', '')::programme_level,
    ug_degree             = nullif(p_student->>'ug_degree', ''),
    ug_college            = nullif(p_student->>'ug_college', ''),
    ug_branch             = nullif(p_student->>'ug_branch', ''),
    ug_aggregate_declared = nullif(p_student->>'ug_aggregate_declared', '')::numeric,
    ug_aggregate_scale    = nullif(p_student->>'ug_aggregate_scale', '')::marks_scale,
    ug_aggregate_cgpa     = nullif(p_student->>'ug_aggregate_cgpa', '')::numeric,
    ug_marksheet_id       = nullif(v_slots->>(p_student->>'ug_marksheet_slot'), '')::uuid,
    technical_skills      = p_student->>'technical_skills',
    areas_of_interest     = p_student->>'areas_of_interest',
    areas_of_expertise    = p_student->>'areas_of_expertise',
    projects              = p_student->>'projects',
    achievements          = p_student->>'achievements',
    linkedin_url          = nullif(p_student->>'linkedin_url', ''),
    github_url            = nullif(p_student->>'github_url', ''),
    leetcode_url          = nullif(p_student->>'leetcode_url', ''),
    hackerrank_url        = nullif(p_student->>'hackerrank_url', ''),
    other_profiles        = coalesce(p_student->'other_profiles', '[]'::jsonb),
    current_arrears       = v_latest_curr,
    history_of_arrears    = v_latest_hist,
    consent_given_at      = now(),
    srf_status            = 'srf_submitted',
    srf_submitted_at      = now(),
    srf_draft             = null,
    srf_draft_saved_at    = null
  where id = v_student_id;

  delete from student_semesters where student_semesters.student_id = v_student_id;

  insert into student_semesters (
    student_id, semester_number, cgpa, declared_marks, marks_scale,
    current_arrears, history_of_arrears, marksheet_id
  )
  select v_student_id,
         (s->>'semester_number')::int,
         (s->>'cgpa')::numeric,
         (s->>'declared_marks')::numeric,
         (s->>'marks_scale')::marks_scale,
         coalesce((s->>'current_arrears')::int, 0),
         greatest(coalesce((s->>'history_of_arrears')::int, 0), coalesce((s->>'current_arrears')::int, 0)),
         nullif(v_slots->>(s->>'marksheet_slot'), '')::uuid
    from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) as s;

  -- ------------------------------------------------------------ preferences
  delete from student_role_preferences
   where student_role_preferences.student_id = v_student_id;

  insert into student_role_preferences (student_id, category)
  select v_student_id, c::role_category
    from jsonb_array_elements_text(coalesce(p_role_categories, '[]'::jsonb)) as c
  on conflict do nothing;

  -- --------------------------------------------------------------- resumes
  delete from student_documents
   where student_documents.student_id = v_student_id
     and student_documents.kind = 'resume'
     and student_documents.drive_id is null
     and (
       student_documents.role_category::text in (
         select r->>'role_category' from jsonb_array_elements(coalesce(p_resumes, '[]'::jsonb)) as r
       )
       or student_documents.role_category::text not in (
         select c from jsonb_array_elements_text(coalesce(p_role_categories, '[]'::jsonb)) as c
       )
     );

  insert into student_documents (student_id, kind, role_category, storage_path, size_bytes)
  select v_student_id,
         'resume'::document_kind,
         (r->>'role_category')::role_category,
         r->>'storage_path',
         (r->>'size_bytes')::int
    from jsonb_array_elements(coalesce(p_resumes, '[]'::jsonb)) as r;

  -- Certificates. Only the undecided ones are the student's to replace.
  delete from student_certificates
   where student_certificates.student_id = v_student_id
     and student_certificates.status <> 'verified';

  insert into student_certificates (student_id, name, document_id)
  select v_student_id,
         c->>'name',
         nullif(v_slots->>(c->>'document_slot'), '')::uuid
    from jsonb_array_elements(coalesce(p_certificates, '[]'::jsonb)) as c
   where lower(regexp_replace(btrim(c->>'name'), '\s+', ' ', 'g')) not in (
           select lower(regexp_replace(btrim(sc.name), '\s+', ' ', 'g'))
             from student_certificates sc
            where sc.student_id = v_student_id
         );

  return query
    select s.id, s.srf_status from students s where s.id = v_student_id;
end;
$$;

grant execute on function submit_srf(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

comment on function protect_verified_academics is
  '0074: arrears moved from the unconditional block to the post-approval block '
  'so students can declare their own arrears during SRF submission. '
  'overall_cgpa, degree, branch, roll_number, participation_status remain '
  'always coordinator-owned.';


-- 3. Automatic trigger to keep students.current_arrears and history_of_arrears
-- in sync whenever student_semesters is inserted, updated, or deleted.
create or replace function sync_student_arrears_from_semesters() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student_id uuid;
  v_current_arrears integer;
  v_history_of_arrears integer;
begin
  v_student_id := coalesce(new.student_id, old.student_id);

  select
    coalesce(current_arrears, 0),
    coalesce(history_of_arrears, 0)
    into v_current_arrears, v_history_of_arrears
    from student_semesters
   where student_id = v_student_id
   order by semester_number desc
   limit 1;

  if v_current_arrears is not null then
    update students
       set current_arrears    = greatest(v_current_arrears, 0),
           history_of_arrears = greatest(coalesce(v_history_of_arrears, 0), greatest(v_current_arrears, 0))
     where id = v_student_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_student_arrears_on_semesters_change on student_semesters;
create trigger sync_student_arrears_on_semesters_change
  after insert or update or delete on student_semesters
  for each row execute function sync_student_arrears_from_semesters();

-- 4. Backfill all existing students to match their latest declared semester
update students
   set current_arrears    = latest.current_arrears,
       history_of_arrears = greatest(coalesce(latest.history_of_arrears, 0), coalesce(latest.current_arrears, 0))
  from (
    select distinct on (student_id) student_id, current_arrears, history_of_arrears
      from student_semesters
     order by student_id, semester_number desc
  ) as latest
 where students.id = latest.student_id;

-- =============================================================================
-- Migration: 0075_mode_aware_round_notices.sql
-- =============================================================================

-- 0075_mode_aware_round_notices.sql
--
-- 1. Mode-aware round notifications:
--    - When mode is virtual, include interview link (if provided).
--    - When mode is physical (on_campus or physical_outside_campus), include venue (if provided).
--    - Never show interview links on physical rounds.
--    - Notify when venue changes.
--    - Append standardized "Please report on time."
--
-- 2. Shortlist & Round Cleared notifications:
--    - Clarify round data and next steps: "Soon you will get notified for round details. Please report on time."
--
-- 3. Individual meeting slots:
--    - Append "Please report on time."

-- 1. round_details_reach_students
create or replace function round_details_reach_students() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company text;
  v_body    text;
begin
  if new.round_mode is not distinct from old.round_mode
     and new.round_scheduled_at is not distinct from old.round_scheduled_at
     and new.round_interview_link is not distinct from old.round_interview_link
     and new.venue is not distinct from old.venue then
    return new;  -- renames and proofs are not schedule news
  end if;

  select company_name into v_company from drives where id = new.drive_id;

  v_body := 'Round ' || new.sequence || ' (' || new.name || ') of ' || v_company
    || case when new.round_scheduled_at is not null
            then ' is scheduled for '
              || to_char(new.round_scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
              || ' IST'
            else ' has updated details' end
    || case when new.round_mode is not null
            then '. Mode: ' || replace(new.round_mode, '_', ' ') else '' end
    || case when new.round_mode = 'virtual' and new.round_interview_link is not null and length(trim(new.round_interview_link)) > 0
            then '. Join at: ' || trim(new.round_interview_link)
            when new.round_mode in ('on_campus', 'physical_outside_campus') and new.venue is not null and length(trim(new.venue)) > 0
            then '. Venue: ' || trim(new.venue)
            else '' end
    || '. Please report on time.';

  insert into notifications (student_id, kind, title, body)
  select a.student_id, 'round_scheduled',
         v_company || ' — Round ' || new.sequence || ' schedule', v_body
    from round_participants rp
    join applications a on a.id = rp.application_id
    join students s on s.id = a.student_id
   where rp.round_id = new.id
     and s.participation_status <> 'opted_out';

  return new;
end;
$$;

drop trigger if exists round_details_reach_students on drive_rounds;
create trigger round_details_reach_students
  after update on drive_rounds
  for each row execute function round_details_reach_students();

-- 2. shortlist_reaches_student
create or replace function shortlist_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first_round uuid;
  v_company     text;
  v_student     uuid;
  v_opted_out   boolean;
begin
  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted_out
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select dr.id into v_first_round
    from drive_rounds dr
    join applications a on a.drive_id = dr.drive_id
   where a.id = new.application_id
   order by dr.sequence
   limit 1;

  if new.included and (tg_op = 'INSERT' or not old.included) then
    -- Schedule Round 1. A drive published before rounds existed has none;
    -- the notification still goes, and scheduling happens on the attendance
    -- screen as before.
    if v_first_round is not null then
      insert into round_participants (round_id, application_id, added_by)
      values (v_first_round, new.application_id, new.decided_by)
      on conflict (round_id, application_id) do nothing;

      insert into attendance (round_id, application_id, status)
      values (v_first_round, new.application_id, 'scheduled')
      on conflict (round_id, application_id) do nothing;
    end if;

    -- D7: an opted-out student gets NO notification, overridden or not.
    if not v_opted_out then
      insert into notifications (student_id, kind, title, body)
      values (
        v_student,
        'shortlisted',
        'You are shortlisted for ' || v_company,
        'You are on the shortlist for ' || v_company ||
        '. Soon you will get notified for round details. Please report on time.'
      );
    end if;
  end if;

  -- Un-including takes back an untouched Round 1 slot. Anything already
  -- marked or decided stays: history is not rewritten by a checkbox.
  if not new.included and tg_op = 'UPDATE' and old.included and v_first_round is not null then
    delete from attendance
     where round_id = v_first_round
       and application_id = new.application_id
       and status = 'scheduled'
       and marked_by is null
       and not exists (select 1 from round_results r
                        where r.round_id = v_first_round
                          and r.application_id = new.application_id);
    delete from round_participants rp
     where rp.round_id = v_first_round
       and rp.application_id = new.application_id
       and not exists (select 1 from attendance att
                        where att.round_id = v_first_round
                          and att.application_id = new.application_id);
  end if;

  return new;
end;
$$;

drop trigger if exists shortlist_reaches_student on shortlist_entries;
create trigger shortlist_reaches_student
  after insert or update on shortlist_entries
  for each row execute function shortlist_reaches_student();

-- 3. round_result_reaches_student
create or replace function round_result_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student  uuid;
  v_company  text;
  v_sequence integer;
  v_opted    boolean;
begin
  if new.result not in ('selected', 'rejected') then
    return new;  -- waitlisted / on_hold are interim states, not outcomes
  end if;
  if tg_op = 'UPDATE' and old.result = new.result then
    return new;  -- re-saving the same result is not news
  end if;

  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select sequence into v_sequence from drive_rounds where id = new.round_id;

  if v_opted then
    return new;
  end if;

  if new.result = 'selected' then
    insert into notifications (student_id, kind, title, body)
    values (
      v_student,
      'round_cleared',
      'You cleared Round ' || v_sequence || ' of ' || v_company,
      'Well done — you advance from Round ' || v_sequence || ' of ' || v_company ||
      '. Soon you will get notified for round details. Please report on time.'
    );
  else
    insert into notifications (student_id, kind, title, body)
    values (
      v_student,
      'round_not_selected',
      'Round ' || v_sequence || ' of ' || v_company || ': not selected',
      'You were not selected in Round ' || v_sequence || ' of ' || v_company || '.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists round_result_reaches_student on round_results;
create trigger round_result_reaches_student
  after insert or update on round_results
  for each row execute function round_result_reaches_student();

-- 4. meeting_slot_reaches_student
create or replace function meeting_slot_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student  uuid;
  v_company  text;
  v_sequence integer;
  v_opted    boolean;
begin
  if new.meeting_link is not distinct from old.meeting_link
     and new.participant_scheduled_at is not distinct from old.participant_scheduled_at then
    return new;
  end if;
  if new.meeting_link is null and new.participant_scheduled_at is null then
    return new;  -- clearing a slot is housekeeping, not news
  end if;

  select a.student_id, d.company_name, r.sequence,
         s.participation_status = 'opted_out'
    into v_student, v_company, v_sequence, v_opted
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
    join drive_rounds r on r.id = new.round_id
   where a.id = new.application_id;

  if v_opted then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (
    v_student,
    'meeting_link',
    v_company || ' — your Round ' || v_sequence || ' slot',
    'Your Round ' || v_sequence || ' of ' || v_company
      || case when new.participant_scheduled_at is not null
              then ' is at '
                || to_char(new.participant_scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
                || ' IST'
              else '' end
      || case when new.meeting_link is not null
              then '. Your meeting link: ' || new.meeting_link else '' end
      || '. Please report on time.'
  );

  return new;
end;
$$;

drop trigger if exists meeting_slot_reaches_student on round_participants;
create trigger meeting_slot_reaches_student
  after update on round_participants
  for each row execute function meeting_slot_reaches_student();

-- =============================================================================
-- Migration: 0076_student_lifecycle_email_triggers.sql
-- =============================================================================

-- 0076_student_lifecycle_email_triggers.sql
--
-- Student lifecycle notification triggers and email outbox guarantee.
-- Ensures student communications adhere strictly to the email template standard:
--   - S1: Student Welcome & Registration invitation on roster import (srf_status = 'invited')
--   - S14: Student Profile Verified & Approved (srf_status = 'srf_approved')
--   - Outbox Trigger: Every student notification stages a queued row in email_deliveries
--     for dispatch via the canonical HTML template.

-- 1. Ensure email outbox trigger is active on notifications
create or replace function enqueue_notification_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_opted boolean;
begin
  select email, (participation_status = 'opted_out')
    into v_email, v_opted
    from students
   where id = new.student_id;

  -- Opted-out students or missing emails do not receive email
  if v_opted or v_email is null or trim(v_email) = '' then
    return new;
  end if;

  insert into email_deliveries (notification_id, recipient_email, status)
  values (new.id, lower(trim(v_email)), 'queued');

  return new;
end;
$$;

drop trigger if exists notification_enqueues_email on notifications;
create trigger notification_enqueues_email
  after insert on notifications
  for each row execute function enqueue_notification_email();

-- 2. S1: Student Roster Welcome & Registration Form (SRF) Invitation
create or replace function notify_student_of_roster_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_campus text;
  v_degree text;
  v_branch text;
  v_degree_branch text;
begin
  if new.srf_status = 'invited' and (tg_op = 'INSERT' or old.srf_status is distinct from 'invited') then
    if new.participation_status = 'opted_out' then
      return new;
    end if;

    select c.name into v_campus from campuses c where c.id = new.campus_id;
    select d.name into v_degree from degrees d where d.id = new.degree_id;
    select b.name into v_branch from branches b where b.id = new.branch_id;

    v_degree_branch := coalesce(v_degree, 'Not specified');
    if v_branch is not null and length(trim(v_branch)) > 0 then
      v_degree_branch := v_degree_branch || ' — ' || trim(v_branch);
    end if;

    insert into notifications (student_id, kind, title, body)
    values (
      new.id,
      'welcome',
      'Welcome to FACE Prep Campus Placements — Complete Your Profile',
      'Your placement account for **' || coalesce(v_campus, 'your campus') || '** is now active on the FACE Prep Campus Placement Management System.' || E'\n\n' ||
      'To participate in upcoming placement and internship drives, please complete your Student Registration Form (SRF) and upload your verified academic records.' || E'\n\n' ||
      '**Your Record**' || E'\n' ||
      '• **Roll Number:** ' || coalesce(new.roll_number, 'N/A') || E'\n' ||
      '• **Degree & Branch:** ' || v_degree_branch || E'\n' ||
      '• **Passing Year:** ' || coalesce(new.passing_year::text, 'N/A') || E'\n\n' ||
      'Please sign in with your registered Google account to complete your profile.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_student_of_roster_invitation on students;
create trigger notify_student_of_roster_invitation
  after insert or update of srf_status on students
  for each row execute function notify_student_of_roster_invitation();

-- 3. S14: Student Profile Verified & Approved
create or replace function notify_student_of_srf_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.srf_status = 'srf_approved' and (tg_op = 'INSERT' or old.srf_status is distinct from 'srf_approved') then
    if new.participation_status = 'opted_out' then
      return new;
    end if;

    insert into notifications (student_id, kind, title, body)
    values (
      new.id,
      'srf_approved',
      'Profile Verified: You Are Now Eligible for Placement Drives',
      'Great news! Your Student Registration Form (SRF) and uploaded marksheets have been verified and approved by your Campus Placement Coordinator.' || E'\n\n' ||
      '**Verified Academic Record**' || E'\n' ||
      '• **Status:** Active & Eligible' || E'\n\n' ||
      'You are now eligible to participate in upcoming campus placement and internship drives matching your profile.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_student_of_srf_approval on students;
create trigger notify_student_of_srf_approval
  after insert or update of srf_status on students
  for each row execute function notify_student_of_srf_approval();

-- =============================================================================
-- Migration: 0077_scope_student_certificates_to_campus.sql
-- =============================================================================

-- 0077: Scope student_certificates SELECT policy to campus coordinator's assigned students.
--
-- Previously in 0034, student_reads_own_certificates allowed any campus staff to SELECT:
--   using (student_id = current_student_id() or is_org_reader() or is_campus_staff())
--
-- Because is_campus_staff() had no campus scoping, campus coordinators fetched certificates
-- from ALL colleges. However, the students table RLS policy (0018) strictly forbade reading
-- student records from other campuses. As a result, PostgREST returned `students: null` for
-- cross-campus rows, showing up on the coordinator's queue as "Unknown student".
--
-- Align the SELECT policy with 0018 and 0042 so campus coordinators only fetch certificates
-- for students on their assigned campuses.

drop policy if exists student_reads_own_certificates on student_certificates;

create policy student_reads_own_certificates
  on student_certificates for select
  using (
    student_id = current_student_id()
    or is_org_reader()
    or (is_campus_reader() and student_id in (select my_student_ids()))
  );

-- =============================================================================
-- Migration: 0078_cron_email_dispatcher.sql
-- =============================================================================

-- 0078_cron_email_dispatcher.sql
--
-- Direct PostgreSQL Email Dispatcher via pg_net and pg_cron.
-- Dispatches queued emails directly from email_deliveries to Resend API.
-- Completely self-contained in PostgreSQL (no Edge Function deployment or CLI permissions required).

do $$ begin
  create extension if not exists pg_cron;
exception when others then null; end $$;

do $$ begin
  create extension if not exists pg_net;
exception when others then null; end $$;

-- 1. Helper to render canonical FACE Prep Campus branded HTML email
create or replace function build_notification_email_html(
  p_subject text,
  p_title text,
  p_subtitle text,
  p_recipient text,
  p_body text,
  p_button_label text,
  p_url text
) returns text language plpgsql as $$
declare
  v_escaped_subject text;
  v_escaped_title text;
  v_escaped_subtitle text;
  v_escaped_recipient text;
  v_escaped_url text;
  v_escaped_button text;
  v_body_html text;
  v_subtitle_html text := '';
  v_button_html text := '';
begin
  v_escaped_subject := replace(replace(replace(coalesce(p_subject, 'Notification'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_escaped_title := replace(replace(replace(coalesce(p_title, 'Notification'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_escaped_recipient := replace(replace(replace(coalesce(p_recipient, 'Candidate'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_escaped_url := coalesce(p_url, 'https://pms.faceprepcampus.com/student');
  v_escaped_button := coalesce(p_button_label, 'View on PMS Portal');
  
  -- Format markdown-like bold (**text**) and newlines in body
  v_body_html := replace(replace(replace(coalesce(p_body, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_body_html := regexp_replace(v_body_html, '\*\*(.*?)\*\*', '<strong style="color: #151228;">\1</strong>', 'g');
  v_body_html := replace(v_body_html, E'\n', '<br>');

  if p_subtitle is not null and trim(p_subtitle) <> '' then
    v_escaped_subtitle := replace(replace(replace(p_subtitle, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_subtitle_html := '<p style="margin:0 0 18px;color:#64748b;font-size:14.5px;line-height:1.5;">' || v_escaped_subtitle || '</p>';
  end if;

  if v_escaped_url is not null and trim(v_escaped_url) <> '' then
    v_button_html := '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;"><tr><td bgcolor="#3d3777" style="border-radius:6px;"><a href="' || v_escaped_url || '" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 22px;color:#fff;font-size:15px;font-weight:bold;line-height:1;text-decoration:none;">' || v_escaped_button || ' &rarr;</a></td></tr></table>';
  end if;

  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>' || v_escaped_subject || '</title><style>@media screen and (max-width:620px){.email-shell{width:100%!important}.email-padding{padding-left:22px!important;padding-right:22px!important}}</style></head><body style="margin:0;padding:0;background:#f7f6fb;color:#151228;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f6fb;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:100%;background:#fff;border:1px solid #e2e0ea;border-radius:10px;overflow:hidden;"><tr><td style="height:4px;background:#ffb800;font-size:4px;line-height:4px;">&nbsp;</td></tr><tr><td class="email-padding" style="padding:24px 32px;background:#3d3777;"><div style="width:170px;max-width:100%;"><img src="https://pms.faceprepcampus.com/brand/faceprep-campus-light.png" width="170" alt="FACE Prep Campus" style="display:block;width:170px;max-width:100%;height:auto;border:0;"><p style="margin:8px 0 0;color:#ddd8f0;font-size:11px;font-weight:600;width:170px;letter-spacing:0.2px;line-height:1.2;text-transform:none;">Placement Management System</p></div></td></tr><tr><td class="email-padding" style="padding:34px 32px 28px;"><h1 style="margin:0 0 6px;color:#151228;font-size:22px;font-weight:700;line-height:1.3;">' || v_escaped_title || '</h1>' || v_subtitle_html || '<p style="margin:0 0 18px;color:#3f3d56;font-size:16px;line-height:1.55;">Dear <strong style="color:#151228;">' || v_escaped_recipient || '</strong>,</p><p style="margin:0;color:#3f3d56;font-size:15px;line-height:1.65;">' || v_body_html || '</p>' || v_button_html || '<p style="margin:28px 0 0;color:#3f3d56;font-size:15px;line-height:1.55;">Warm regards,<br><strong style="color:#151228;">Placement Cell,</strong><br><strong style="color:#151228;">FACE Prep Campus</strong></p></td></tr><tr><td class="email-padding" style="padding:22px 32px;background:#f8fafc;border-top:1px solid #e2e0ea;font-size:12px;color:#64748b;line-height:1.6;"><p style="margin:0 0 4px 0;font-weight:600;color:#334155;">FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd</p><p style="margin:0;">For questions, contact your coordinator or write to <a href="mailto:hello@faceprep.in" style="color:#3d3777;font-weight:600;text-decoration:underline;">hello@faceprep.in</a></p></td></tr></table></td></tr></table></body></html>';
end;
$$;

-- 2. Dispatch processor that queries queued deliveries and posts to Resend directly
create or replace function process_email_deliveries(p_batch_limit int default 50)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_rec record;
  v_count int := 0;
  v_title text;
  v_subtitle text;
  v_button text;
  v_url text;
  v_recipient_name text;
  v_html text;
  v_payload jsonb;
  v_api_key text := 're_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp';
  v_from text := 'FACE Prep Campus <pms@faceprepcampus.com>';
begin
  for v_rec in
    select d.id as delivery_id,
           d.recipient_email,
           n.kind,
           n.title as notif_title,
           n.body as notif_body,
           s.full_name as student_name,
           p.full_name as profile_name
      from email_deliveries d
      join notifications n on n.id = d.notification_id
      left join students s on s.id = n.student_id
      left join profiles p on lower(p.email) = lower(d.recipient_email)
     where d.status = 'queued'
     order by d.updated_at asc
     limit p_batch_limit
     for update of d skip locked
  loop
    -- Determine recipient display name
    v_recipient_name := coalesce(nullif(trim(v_rec.student_name), ''), nullif(trim(v_rec.profile_name), ''), 'Candidate');
    
    -- Map notification kind to title, subtitle, button, URL
    v_title := coalesce(v_rec.notif_title, 'Placement Notification');
    v_subtitle := null;
    v_button := 'View on PMS Portal';
    v_url := 'https://pms.faceprepcampus.com/student';

    case lower(coalesce(v_rec.kind, ''))
      when 'welcome' then
        v_title := 'Complete Your Placement Profile';
        v_subtitle := 'Please fill in all the required details to complete your placement profile.';
        v_button := 'Complete Registration';
        v_url := 'https://pms.faceprepcampus.com/srf';
      when 'drive_published' then
        v_title := 'New Placement Drive Announced';
        v_button := 'View Drive & Apply';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'shortlisted' then
        v_title := 'You Are Shortlisted';
        v_button := 'View Application Status';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'round_scheduled' then
        v_title := 'Round Schedule Released';
        v_button := 'View Drive Dashboard';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'round_cleared' then
        v_title := 'Round Cleared';
        v_button := 'View Drive Progress';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'round_not_selected' then
        v_title := 'Application Status Update';
        v_button := 'Explore Open Drives';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'offer' then
        v_title := 'Placement Offer Extended';
        v_button := 'View Offer & Letter';
        v_url := 'https://pms.faceprepcampus.com/student/notifications';
      when 'srf_rejected' then
        v_title := 'Registration Form Requires Changes';
        v_button := 'Open Registration Form';
        v_url := 'https://pms.faceprepcampus.com/srf';
      when 'srf_approved' then
        v_title := 'Placement Profile Approved';
        v_button := 'Explore Open Drives';
        v_url := 'https://pms.faceprepcampus.com/student/drives';
      when 'campus_drive_alert', 'cpc_drive_alert' then
        v_title := 'New Campus Placement Drive Active';
        v_button := 'View Drive Cohort';
        v_url := 'https://pms.faceprepcampus.com/cpc/drives';
      when 'verification_queue_digest', 'cpc_verification' then
        v_title := 'Student Profiles Pending Verification';
        v_button := 'Open Verification Queue';
        v_url := 'https://pms.faceprepcampus.com/cpc/verification';
      when 'pif_approved', 'ae_pif_approved' then
        v_title := 'Placement Initiation Form Approved';
        v_button := 'View Sourced Drives';
        v_url := 'https://pms.faceprepcampus.com/my-drives';
      else
        null;
    end case;

    -- Build canonical HTML
    v_html := build_notification_email_html(
      coalesce(v_rec.notif_title, v_title),
      v_title,
      v_subtitle,
      v_recipient_name,
      v_rec.notif_body,
      v_button,
      v_url
    );

    -- Build Resend JSON payload
    v_payload := jsonb_build_object(
      'from', v_from,
      'to', jsonb_build_array(v_rec.recipient_email),
      'reply_to', 'placements@faceprep.in',
      'subject', coalesce(v_rec.notif_title, v_title),
      'html', v_html
    );

    -- Send directly via pg_net async HTTP POST to Resend
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    );

    -- Mark delivery as sent
    update email_deliveries
       set status = 'sent',
           updated_at = now()
     where id = v_rec.delivery_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- 3. Reset and schedule cron job to call process_email_deliveries() every minute
do $$
begin
  perform cron.unschedule('dispatch-pending-emails-every-minute');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'dispatch-pending-emails-every-minute',
  '* * * * *',
  'select process_email_deliveries(50);'
);

-- =============================================================================
-- Migration: 0079_staff_invitation_email_dispatcher.sql
-- =============================================================================

-- 0079_staff_invitation_email_dispatcher.sql
--
-- Automatic Email Dispatch for Staff Onboarding Invitations (Template AD1).
-- Ensures that when an admin invites a staff member or sets their role,
-- an official AD1 onboarding email is staged and sent via Resend automatically.

-- 1. Make notification_id nullable so email_deliveries can also carry staff/system emails
alter table email_deliveries alter column notification_id drop not null;
alter table email_deliveries add column if not exists subject text;
alter table email_deliveries add column if not exists html_body text;

-- 2. Helper to render canonical AD1 Staff Onboarding HTML email
create or replace function build_staff_invite_email_html(
  p_full_name   text,
  p_role_name   text,
  p_campuses    text,
  p_email       text,
  p_login_url   text default 'https://pms.faceprepcampus.com/login'
) returns text language plpgsql as $$
declare
  v_name text := replace(replace(replace(coalesce(p_full_name, 'Team Member'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_role text := replace(replace(replace(coalesce(p_role_name, 'Staff Member'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_campuses text := replace(replace(replace(coalesce(nullif(trim(p_campuses), ''), 'All Campuses (Organisation-wide)'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_email text := replace(replace(replace(coalesce(p_email, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_url text := coalesce(p_login_url, 'https://pms.faceprepcampus.com/login');
begin
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Invitation to FACE Prep Campus PMS as ' || v_role || '</title></head><body style="margin:0;padding:0;background-color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F1F5F9;padding:32px 12px;"><tr><td align="center"><table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);max-width:100%;"><tr><td height="4" style="background:linear-gradient(90deg,#3D3777 0%,#A46AFC 50%,#FFB800 100%);line-height:4px;font-size:4px;">&nbsp;</td></tr><tr><td style="background-color:#3D3777;padding:24px 32px;"><table border="0" cellpadding="0" cellspacing="0" style="width:170px;max-width:100%;"><tr><td align="left" valign="middle"><img src="https://pms.faceprepcampus.com/brand/faceprep-campus-light.png" alt="FACE Prep Campus" width="170" height="34" style="width:170px;height:34px;max-width:100%;display:block;border:0;"/><div style="font-size:11px;font-weight:600;color:#E0E7FF;letter-spacing:0.2px;width:170px;margin-top:6px;line-height:1.2;">Staff Onboarding</div></td></tr></table></td></tr><tr><td style="padding:36px 32px;"><h1 style="margin:0 0 16px 0;font-size:20px;color:#1E1B4B;font-weight:700;line-height:1.3;">Welcome to the Team, ' || v_name || '</h1><p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 20px 0;">You have been invited to join the FACE Prep Campus Placement Management System (PMS). Your role-based permissions have been provisioned as follows:</p><table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;margin-bottom:24px;"><tr><td style="padding:12px 16px;font-size:13.5px;font-weight:600;color:#3D3777;width:140px;border-bottom:1px solid #E2E8F0;">Assigned Role:</td><td style="padding:12px 16px;font-size:14px;font-weight:600;color:#0F172A;border-bottom:1px solid #E2E8F0;">' || v_role || '</td></tr><tr><td style="padding:12px 16px;font-size:13.5px;font-weight:600;color:#3D3777;border-bottom:1px solid #E2E8F0;">Campus Scope:</td><td style="padding:12px 16px;font-size:14px;color:#334155;border-bottom:1px solid #E2E8F0;">' || v_campuses || '</td></tr><tr><td style="padding:12px 16px;font-size:13.5px;font-weight:600;color:#3D3777;">Authorized Email:</td><td style="padding:12px 16px;font-size:14px;color:#334155;">' || v_email || '</td></tr></table><table border="0" cellpadding="0" cellspacing="0" style="margin-top:8px;margin-bottom:8px;"><tr><td align="center" bgcolor="#3D3777" style="border-radius:6px;"><a href="' || v_url || '" target="_blank" style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;display:inline-block;padding:13px 28px;letter-spacing:0.2px;">Sign In to PMS &rarr;</a></td></tr></table><p style="font-size:13.5px;line-height:1.6;color:#64748B;margin:20px 0 0 0;">Use your <strong style="color:#0F172A;">Google account registered to ' || v_email || '</strong> to sign in. If you encounter any issues, contact your administrator.</p><p style="font-size:14px;line-height:1.6;color:#334155;margin:24px 0 0 0;">Warm regards,<br><strong style="color:#1E1B4B;">Placement Cell,</strong><br><strong style="color:#1E1B4B;">FACE Prep Campus</strong></p></td></tr><tr><td style="background-color:#F8FAFC;padding:22px 32px;border-top:1px solid #E2E8F0;font-size:12px;color:#64748b;line-height:1.6;"><p style="margin:0 0 4px 0;font-weight:600;color:#334155;">FACE Prep Campus &bull; Focus 4D Career Education Pvt Ltd</p><p style="margin:0;">For questions, write to <a href="mailto:pms@faceprepcampus.com" style="color:#3D3777;font-weight:600;text-decoration:underline;">pms@faceprepcampus.com</a></p></td></tr></table></td></tr></table></body></html>';
end;
$$;

-- 3. Trigger function to enqueue staff invitation email upon insert
create or replace function enqueue_staff_invitation_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role_name text;
  v_campuses  text;
  v_html      text;
  v_subject   text;
begin
  case new.role
    when 'admin' then v_role_name := 'Administrator';
    when 'campus_manager' then v_role_name := 'Campus Manager';
    when 'central_placement_coordinator' then v_role_name := 'Central Placement Coordinator';
    when 'key_account_manager' then v_role_name := 'Key Account Manager';
    when 'campus_placement_coordinator' then v_role_name := 'Campus Placement Coordinator';
    when 'account_executive' then v_role_name := 'Account Executive';
    when 'delivery_head' then v_role_name := 'Delivery Head';
    when 'er_head' then v_role_name := 'Enterprise Relations Head';
    when 'enterprise_relations' then v_role_name := 'Enterprise Relations';
    when 'ceo' then v_role_name := 'Chief Executive Officer';
    else v_role_name := replace(new.role::text, '_', ' ');
  end case;

  -- Aggregate campuses if assigned
  select string_agg(c.name, ', ' order by c.name)
    into v_campuses
    from (
      select campus_id from staff_campus_invitations where lower(email) = lower(new.email)
      union
      select a.campus_id from staff_campus_assignments a
        join profiles p on p.id = a.profile_id
       where lower(p.email) = lower(new.email)
    ) map
    join campuses c on c.id = map.campus_id;

  v_subject := 'Invitation to FACE Prep Campus PMS as ' || v_role_name;
  v_html := build_staff_invite_email_html(new.full_name, v_role_name, v_campuses, new.email);

  insert into email_deliveries (recipient_email, status, subject, html_body)
  values (lower(trim(new.email)), 'queued', v_subject, v_html);

  return new;
end;
$$;

drop trigger if exists staff_invitation_enqueues_email on staff_invitations;
create trigger staff_invitation_enqueues_email
  after insert on staff_invitations
  for each row execute function enqueue_staff_invitation_email();

-- 4. Update process_email_deliveries to support both student notifications and direct/staff deliveries
create or replace function process_email_deliveries(p_batch_limit int default 50)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_rec record;
  v_count int := 0;
  v_title text;
  v_subtitle text;
  v_button text;
  v_url text;
  v_recipient_name text;
  v_html text;
  v_subject text;
  v_payload jsonb;
  v_api_key text := 're_MnXJzytd_CnW2TvKLk5Dbv6FYPnDtMLfp';
  v_from text := 'FACE Prep Campus <pms@faceprepcampus.com>';
begin
  for v_rec in
    select d.id as delivery_id,
           d.recipient_email,
           d.subject as custom_subject,
           d.html_body as custom_html,
           n.kind,
           n.title as notif_title,
           n.body as notif_body,
           s.full_name as student_name,
           p.full_name as profile_name
      from email_deliveries d
      left join notifications n on n.id = d.notification_id
      left join students s on s.id = n.student_id
      left join profiles p on lower(p.email) = lower(d.recipient_email)
     where d.status = 'queued'
     order by d.updated_at asc
     limit p_batch_limit
     for update of d skip locked
  loop
    -- Check if custom HTML and subject are directly provided (e.g. staff invitation)
    if v_rec.custom_html is not null and trim(v_rec.custom_html) <> '' then
      v_subject := coalesce(v_rec.custom_subject, 'Invitation to FACE Prep Campus PMS');
      v_html := v_rec.custom_html;
    else
      -- Determine recipient display name for student notification
      v_recipient_name := coalesce(nullif(trim(v_rec.student_name), ''), nullif(trim(v_rec.profile_name), ''), 'Candidate');
      
      -- Map notification kind to title, subtitle, button, URL
      v_title := coalesce(v_rec.notif_title, 'Placement Notification');
      v_subtitle := null;
      v_button := 'View on PMS Portal';
      v_url := 'https://pms.faceprepcampus.com/student';

      case lower(coalesce(v_rec.kind, ''))
        when 'welcome' then
          v_title := 'Complete Your Placement Profile';
          v_subtitle := 'Please fill in all the required details to complete your placement profile.';
          v_button := 'Complete Registration';
          v_url := 'https://pms.faceprepcampus.com/srf';
        when 'drive_published' then
          v_title := 'New Placement Drive Announced';
          v_button := 'View Drive & Apply';
          v_url := 'https://pms.faceprepcampus.com/student/drives';
        when 'shortlisted' then
          v_title := 'You Are Shortlisted';
          v_button := 'View Application Status';
          v_url := 'https://pms.faceprepcampus.com/student/drives';
        when 'round_scheduled' then
          v_title := 'Round Schedule Released';
          v_button := 'View Drive Dashboard';
          v_url := 'https://pms.faceprepcampus.com/student/drives';
        when 'round_cleared' then
          v_title := 'Round Cleared';
          v_button := 'View Drive Progress';
          v_url := 'https://pms.faceprepcampus.com/student/drives';
        when 'round_not_selected' then
          v_title := 'Application Status Update';
          v_button := 'Explore Open Drives';
          v_url := 'https://pms.faceprepcampus.com/student/drives';
        when 'offer' then
          v_title := 'Placement Offer Extended';
          v_button := 'View Offer & Letter';
          v_url := 'https://pms.faceprepcampus.com/student/notifications';
        when 'srf_rejected' then
          v_title := 'Registration Form Requires Changes';
          v_button := 'Open Registration Form';
          v_url := 'https://pms.faceprepcampus.com/srf';
        when 'srf_approved' then
          v_title := 'Placement Profile Approved';
          v_button := 'Explore Open Drives';
          v_url := 'https://pms.faceprepcampus.com/student/drives';
        when 'campus_drive_alert', 'cpc_drive_alert' then
          v_title := 'New Campus Placement Drive Active';
          v_button := 'View Drive Cohort';
          v_url := 'https://pms.faceprepcampus.com/cpc/drives';
        when 'verification_queue_digest', 'cpc_verification' then
          v_title := 'Student Profiles Pending Verification';
          v_button := 'Open Verification Queue';
          v_url := 'https://pms.faceprepcampus.com/cpc/verification';
        when 'pif_approved', 'ae_pif_approved' then
          v_title := 'Placement Initiation Form Approved';
          v_button := 'View Sourced Drives';
          v_url := 'https://pms.faceprepcampus.com/my-drives';
        else
          null;
      end case;

      v_subject := coalesce(v_rec.notif_title, v_title);

      -- Build canonical HTML
      v_html := build_notification_email_html(
        v_subject,
        v_title,
        v_subtitle,
        v_recipient_name,
        v_rec.notif_body,
        v_button,
        v_url
      );
    end if;

    -- Build Resend JSON payload
    v_payload := jsonb_build_object(
      'from', v_from,
      'to', jsonb_build_array(v_rec.recipient_email),
      'reply_to', 'pms@faceprepcampus.com',
      'subject', v_subject,
      'html', v_html
    );

    -- Send directly via pg_net async HTTP POST to Resend
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    );

    -- Mark delivery as sent
    update email_deliveries
       set status = 'sent',
           updated_at = now()
     where id = v_rec.delivery_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- =============================================================================
-- Migration: 0080_drive_lifecycle_staff_email_triggers.sql
-- =============================================================================

-- 0080_drive_lifecycle_staff_email_triggers.sql
--
-- Automatic Email Dispatch for Drive Lifecycle Events and Staff Role Notifications:
--   - DH1: Delivery Head notified on PIF Submission (status -> 'submitted')
--   - A1:  Account Executive notified on PIF Approval (status -> 'approved')
--   - CP1: Central CPC notified on PIF Approval for campus targeting & schedule setup (status -> 'approved')
--   - A2:  Account Executive notified on PIF Revision Request (status -> 'rejected')
--   - A3:  Account Executive notified when Drive goes Live to Students (status -> 'live')
--   - C1:  Campus Placement Coordinators notified when Drive goes Live for their campus (status -> 'live')
--   - C6:  Campus Placement Coordinator notified when Student receives an Offer (insert on offers)

-- 1. Helper function to enqueue direct custom branded notification emails
create or replace function enqueue_direct_email(
  p_recipient_email text,
  p_subject         text,
  p_title           text,
  p_subtitle        text,
  p_recipient_name  text,
  p_body            text,
  p_button_label    text,
  p_url             text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p_recipient_email, '')));
  v_html  text;
begin
  if v_email = '' or v_email is null then
    return;
  end if;

  v_html := build_notification_email_html(
    p_subject,
    p_title,
    p_subtitle,
    p_recipient_name,
    p_body,
    p_button_label,
    p_url
  );

  insert into email_deliveries (recipient_email, status, subject, html_body)
  values (v_email, 'queued', p_subject, v_html);
end;
$$;

-- 2. Trigger function for Drive Lifecycle State Transitions
create or replace function notify_drive_lifecycle_roles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ae_name       text;
  v_ae_email      text;
  v_staff_rec     record;
  v_cpc_rec       record;
  v_subject       text;
  v_title         text;
  v_subtitle      text;
  v_body          text;
  v_ctc_display   text;
begin
  -- Format CTC display
  if new.ctc_min_lpa is not null and new.ctc_max_lpa is not null then
    if new.ctc_min_lpa = new.ctc_max_lpa then
      v_ctc_display := new.ctc_min_lpa::text || ' LPA';
    else
      v_ctc_display := new.ctc_min_lpa::text || ' - ' || new.ctc_max_lpa::text || ' LPA';
    end if;
  else
    v_ctc_display := 'As per policy';
  end if;

  -- Lookup Sourcing AE details
  if new.created_by is not null then
    select full_name, email into v_ae_name, v_ae_email
      from profiles
     where id = new.created_by;
  end if;

  -- A. PIF SUBMITTED -> Notify Delivery Head (DH1)
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    v_subject := 'Action Required: PIF Submitted for Review — ' || new.company_name;
    v_title := 'Placement Initiation Form Under Review';
    v_subtitle := 'A new placement drive has been submitted for classification and review.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role Title:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n' ||
              '**Sourced By (AE):** ' || coalesce(v_ae_name, 'Account Executive') || E'\n\n' ||
              'Please review the compensation structure, eligibility criteria, and approve or request revisions.';

    for v_staff_rec in
      select email, full_name from profiles where role = 'delivery_head' and is_active = true
      union
      select email, full_name from staff_invitations where role = 'delivery_head' and accepted_at is null
    loop
      perform enqueue_direct_email(
        v_staff_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_staff_rec.full_name, 'Delivery Head'),
        v_body,
        'Open PIF Approvals',
        'https://pms.faceprepcampus.com/delivery-head/pif-approvals'
      );
    end loop;
  end if;

  -- B. PIF APPROVED -> Notify AE (A1) and Central CPC (CP1)
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    -- 1. Notify Sourcing AE (A1)
    if v_ae_email is not null then
      v_subject := 'Good News: PIF Approved — ' || new.company_name;
      v_title := 'Placement Initiation Form Approved';
      v_subtitle := 'Your sourced drive has been approved and moved to the publishing queue.';
      v_body := '**Company:** ' || new.company_name || E'\n' ||
                '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
                '**Category:** ' || coalesce(new.offer_category::text, 'Standard') || E'\n' ||
                '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
                'Your PIF has been approved by the Delivery Head and assigned to Central Placement Coordinators for drive scheduling and campus publishing.';

      perform enqueue_direct_email(
        v_ae_email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_ae_name, 'Account Executive'),
        v_body,
        'View Sourced Drives',
        'https://pms.faceprepcampus.com/my-drives'
      );
    end if;

    -- 2. Notify Central CPC (CP1)
    v_subject := 'Drive Approved: Ready for Round Setup & Publishing — ' || new.company_name;
    v_title := 'Placement Drive Approved';
    v_subtitle := 'New approved drive ready for campus targeting and schedule setup.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**Category:** ' || coalesce(new.offer_category::text, 'Standard') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
              'Delivery Head has approved the Placement Initiation Form. Please configure the round schedule, target campuses, and publish the drive live.';

    for v_staff_rec in
      select email, full_name from profiles where role = 'central_placement_coordinator' and is_active = true
      union
      select email, full_name from staff_invitations where role = 'central_placement_coordinator' and accepted_at is null
    loop
      perform enqueue_direct_email(
        v_staff_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_staff_rec.full_name, 'Central Placement Coordinator'),
        v_body,
        'Configure & Publish',
        'https://pms.faceprepcampus.com/central/drives/yet-to-publish'
      );
    end loop;
  end if;

  -- C. PIF REJECTED / REVISION REQUESTED -> Notify AE (A2)
  if new.status = 'rejected' and (tg_op = 'INSERT' or old.status is distinct from 'rejected') then
    if v_ae_email is not null then
      v_subject := 'Action Required: PIF Revision Requested — ' || new.company_name;
      v_title := 'PIF Requires Changes';
      v_subtitle := 'Feedback has been provided on your submitted Placement Initiation Form.';
      v_body := '**Company:** ' || new.company_name || E'\n' ||
                '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
                '**Review Feedback:** ' || coalesce(new.rejection_reason, 'Please review the submitted parameters and consult with Delivery Head.') || E'\n\n' ||
                'Please update the PIF with the requested changes and resubmit for approval.';

      perform enqueue_direct_email(
        v_ae_email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_ae_name, 'Account Executive'),
        v_body,
        'Revise PIF Details',
        'https://pms.faceprepcampus.com/ae/pif'
      );
    end if;
  end if;

  -- D. DRIVE LIVE -> Notify AE (A3) and Target Campus CPCs (C1)
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    -- 1. Notify Sourcing AE (A3)
    if v_ae_email is not null then
      v_subject := 'Your Account is Live: Placement Drive Published — ' || new.company_name;
      v_title := 'Placement Drive Published';
      v_subtitle := 'Your sourced drive is now actively accepting applications.';
      v_body := '**Company:** ' || new.company_name || E'\n' ||
                '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
                '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
                'Central CPC has published your drive live across targeted partner campuses. Eligible students can now submit their applications.';

      perform enqueue_direct_email(
        v_ae_email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_ae_name, 'Account Executive'),
        v_body,
        'View Account Overview',
        'https://pms.faceprepcampus.com/ae/overview'
      );
    end if;

    -- 2. Notify Campus CPCs assigned to targeted campuses (C1)
    v_subject := 'New Campus Placement Drive Active — ' || new.company_name;
    v_title := 'New Campus Placement Drive Active';
    v_subtitle := 'A new placement drive has been published for eligible students at your campus.';
    v_body := '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n\n' ||
              'The drive is now active on the student portal. Please ensure eligible candidates complete their applications before the deadline.';

    for v_cpc_rec in
      select distinct u.email, u.full_name
        from (
          select p.email, p.full_name
            from staff_campus_assignments a
            join profiles p on p.id = a.profile_id
            join drive_target_campuses dtc on dtc.campus_id = a.campus_id
           where dtc.drive_id = new.id
             and p.role = 'campus_placement_coordinator'
             and p.is_active = true
          union
          select sci.email, coalesce(si.full_name, 'Campus Placement Coordinator') as full_name
            from staff_campus_invitations sci
            join staff_invitations si on lower(si.email) = lower(sci.email)
            join drive_target_campuses dtc on dtc.campus_id = sci.campus_id
           where dtc.drive_id = new.id
             and si.role = 'campus_placement_coordinator'
        ) u
    loop
      perform enqueue_direct_email(
        v_cpc_rec.email,
        v_subject,
        v_title,
        v_subtitle,
        coalesce(v_cpc_rec.full_name, 'Campus Placement Coordinator'),
        v_body,
        'View Drive Cohort',
        'https://pms.faceprepcampus.com/cpc/drives'
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_drive_lifecycle_roles on drives;
create trigger notify_drive_lifecycle_roles
  after insert or update of status on drives
  for each row execute function notify_drive_lifecycle_roles();

-- 3. Trigger on Offers: Notify Campus CPC when student gets placed (C6)
create or replace function notify_cpc_on_student_offer()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_student_name  text;
  v_roll_number   text;
  v_campus_id     uuid;
  v_company_name  text;
  v_cpc_rec       record;
  v_subject       text;
  v_title         text;
  v_subtitle      text;
  v_body          text;
begin
  select s.full_name, s.roll_number, s.campus_id, coalesce(new.company_name, d.company_name)
    into v_student_name, v_roll_number, v_campus_id, v_company_name
    from students s
    left join drives d on d.id = new.drive_id
   where s.id = new.student_id;

  if v_campus_id is null then
    return new;
  end if;

  v_subject := 'Placement Success: Candidate Placed — ' || coalesce(v_student_name, 'Candidate');
  v_title := 'Campus Student Placement';
  v_subtitle := 'A student from your campus has received a verified placement offer.';
  v_body := '**Student:** ' || coalesce(v_student_name, 'Candidate') || ' (' || coalesce(v_roll_number, 'N/A') || ')' || E'\n' ||
            '**Company:** ' || coalesce(v_company_name, 'Recruiting Partner') || E'\n' ||
            '**CTC / Package:** ' || coalesce(new.ctc_lpa::text, 'N/A') || ' LPA' || E'\n\n' ||
            'Congratulations! The candidate outcome has been recorded in the central placement database.';

  for v_cpc_rec in
    select distinct u.email, u.full_name
      from (
        select p.email, p.full_name
          from staff_campus_assignments a
          join profiles p on p.id = a.profile_id
         where a.campus_id = v_campus_id
           and p.role = 'campus_placement_coordinator'
           and p.is_active = true
        union
        select sci.email, coalesce(si.full_name, 'Campus Placement Coordinator') as full_name
          from staff_campus_invitations sci
          join staff_invitations si on lower(si.email) = lower(sci.email)
         where sci.campus_id = v_campus_id
           and si.role = 'campus_placement_coordinator'
      ) u
  loop
    perform enqueue_direct_email(
      v_cpc_rec.email,
      v_subject,
      v_title,
      v_subtitle,
      coalesce(v_cpc_rec.full_name, 'Campus Placement Coordinator'),
      v_body,
      'View Drive Progress',
      'https://pms.faceprepcampus.com/cpc/drives'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_cpc_on_student_offer on offers;
create trigger notify_cpc_on_student_offer
  after insert on offers
  for each row execute function notify_cpc_on_student_offer();



-- =============================================================================
-- Master Reference Data & Seed Setup
-- =============================================================================

-- =============================================================================
-- FACE Prep Campus — Placement Management System (PMS)
-- Complete Reference Data & Master Seed Script
-- Idempotent: Safe to run on fresh or existing databases.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Master Cities
-- -----------------------------------------------------------------------------
insert into public.cities (name, state) values
  ('Bengaluru', 'Karnataka'),
  ('Chennai', 'Tamil Nadu'),
  ('Coimbatore', 'Tamil Nadu'),
  ('Erode', 'Tamil Nadu'),
  ('Thoothukudi', 'Tamil Nadu'),
  ('Madurai', 'Tamil Nadu'),
  ('Pollachi', 'Tamil Nadu'),
  ('Karur', 'Tamil Nadu'),
  ('Tindivanam', 'Tamil Nadu'),
  ('Tiruppur', 'Tamil Nadu'),
  ('Thiruvallur', 'Tamil Nadu')
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Master Degrees (Full-Form & PIF Standards)
-- -----------------------------------------------------------------------------
insert into public.degrees (name) values
  ('B.E / B.Tech (CSE / IT / allied)'),
  ('BCA'),
  ('BCA (Hons.)'),
  ('B.Sc CS / CT'),
  ('B.Sc Computer Science with Artificial Intelligence'),
  ('B.Sc Artificial Intelligence and Machine Learning'),
  ('B.Sc Artificial Intelligence'),
  ('B.Sc Information Technology'),
  ('B.Sc Computer Technology'),
  ('MCA'),
  ('M.Sc CS')
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Master Partner Campuses (12 Active Campuses)
-- -----------------------------------------------------------------------------
insert into public.campuses (
  name, city_id, code, address, primary_contact_name, primary_contact_email, primary_contact_phone, is_active
)
values
  (
    'Alliance University',
    (select id from public.cities where name = 'Bengaluru' limit 1),
    'AU',
    'Chandapura-Anekal Main Road, Anekal, Bengaluru, Karnataka 562106',
    'Praveen Ramesh',
    'praveen@faceprep.in',
    '9840000001',
    true
  ),
  (
    'AMET University',
    (select id from public.cities where name = 'Chennai' limit 1),
    'AMET',
    '135, East Coast Road, Kanathur, Chennai, Tamil Nadu 603112',
    'Shyam Kumar A K',
    'shyam.kumar@faceprep.in',
    '9840000002',
    true
  ),
  (
    'Bharathidasan College Of Arts & Science',
    (select id from public.cities where name = 'Erode' limit 1),
    'BCAS',
    'Ellispettai, Pallapalayam, Erode, Tamil Nadu 638116',
    'Guna Karthick',
    'karthick@faceprep.in',
    '9840000003',
    true
  ),
  (
    'Kamaraj College',
    (select id from public.cities where name = 'Thoothukudi' limit 1),
    'KMJ',
    '492C+93W, Tiruchendur Road, Thoothukudi, Tamil Nadu 628003',
    'Guna Karthick',
    'karthick@faceprep.in',
    '9840000004',
    true
  ),
  (
    'Nagarathinam Angalammal Arts and Science college',
    (select id from public.cities where name = 'Madurai' limit 1),
    'NAAS',
    'Pottapalayam, Sivagangai / Madurai, Tamil Nadu 630612',
    'Guna Karthick',
    'karthick@faceprep.in',
    '9840000005',
    true
  ),
  (
    'S-VYASA University',
    (select id from public.cities where name = 'Bengaluru' limit 1),
    'SVU',
    'Prashanti Kutiram, Gundanahalli, Kalluballu Post, Anekal, Bengaluru 560105',
    'Praveen Ramesh',
    'praveen@faceprep.in',
    '9840000006',
    true
  ),
  (
    'SDNB Vaishnav College for Women',
    (select id from public.cities where name = 'Chennai' limit 1),
    'SDNB',
    'Vaishnava College Road, Shanthi Nagar, Chromepet, Chennai, Tamil Nadu 600044',
    'Shyam Kumar A K',
    'shyam.kumar@faceprep.in',
    '9840000007',
    true
  ),
  (
    'Sree Saraswathi Thyagaraja College',
    (select id from public.cities where name = 'Pollachi' limit 1),
    'STC',
    'Palani Road, Thippampatti, Pollachi, Tamil Nadu 642107',
    'Guna Karthick',
    'karthick@faceprep.in',
    '9840000008',
    true
  ),
  (
    'Sri Amaraavathi College of Arts & Science',
    (select id from public.cities where name = 'Karur' limit 1),
    'SACAS',
    'Thiruvalluvar Nagar, Karur - Trichy Main Road, Karur, Tamil Nadu 639005',
    'Guna Karthick',
    'karthick@faceprep.in',
    '9840000009',
    true
  ),
  (
    'Takshashila University',
    (select id from public.cities where name = 'Tindivanam' limit 1),
    'TU',
    'Ongur, Tindivanam Taluk, Villupuram Dist, Tamil Nadu 604305',
    'Shyam Kumar A K',
    'shyam.kumar@faceprep.in',
    '9840000010',
    true
  ),
  (
    'TERF''s College of Arts and Science',
    (select id from public.cities where name = 'Tiruppur' limit 1),
    'TERF',
    'Kovilpalayam Pudur, Avinashipalayam, Tiruppur, Tamil Nadu 641666',
    'Guna Karthick',
    'karthick@faceprep.in',
    '9840000011',
    true
  ),
  (
    'TJS College of Arts and Science',
    (select id from public.cities where name = 'Thiruvallur' limit 1),
    'TJS',
    'T.J.S. Nagar, Peruvoyal, Near Kavaraipettai, Gummidipoondi, Thiruvallur 601206',
    'Shyam Kumar A K',
    'shyam.kumar@faceprep.in',
    '9840000012',
    true
  )
on conflict (code) do update
  set name = excluded.name,
      city_id = excluded.city_id,
      address = excluded.address,
      primary_contact_name = excluded.primary_contact_name,
      primary_contact_email = excluded.primary_contact_email,
      primary_contact_phone = excluded.primary_contact_phone,
      is_active = true;

-- -----------------------------------------------------------------------------
-- 4. Campus-Degree Associations (campus_degrees)
-- -----------------------------------------------------------------------------
insert into public.campus_degrees (campus_id, degree_id)
select c.id, d.id
from public.campuses c
cross join public.degrees d
where (
  (c.code = 'AU'   and d.name in ('MCA', 'BCA (Hons.)')) or
  (c.code = 'AMET' and d.name = 'B.Sc Artificial Intelligence and Machine Learning') or
  (c.code = 'BCAS' and d.name = 'B.Sc Computer Technology') or
  (c.code = 'KMJ'  and d.name = 'BCA') or
  (c.code = 'NAAS' and d.name = 'B.Sc Artificial Intelligence') or
  (c.code = 'SVU'  and d.name = 'BCA') or
  (c.code = 'SDNB' and d.name = 'B.Sc Computer Science with Artificial Intelligence') or
  (c.code = 'STC'  and d.name = 'MCA') or
  (c.code = 'SACAS' and d.name = 'BCA') or
  (c.code = 'TU'   and d.name = 'B.Sc Artificial Intelligence and Machine Learning') or
  (c.code = 'TERF' and d.name = 'B.Sc Information Technology') or
  (c.code = 'TJS'  and d.name = 'B.Sc Computer Science with Artificial Intelligence')
)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 5. Master Campus Programmes (Active Cohorts 2026 / 2027)
-- -----------------------------------------------------------------------------
insert into public.campus_programmes (campus_id, degree_id, branch_id, passing_year)
select c.id, d.id, null, y.year
from (values
  ('AU',   'MCA', 2027),
  ('AU',   'BCA (Hons.)', 2027),
  ('AU',   'BCA', 2026),
  ('AMET', 'B.Sc Artificial Intelligence and Machine Learning', 2027),
  ('BCAS', 'B.Sc Computer Technology', 2027),
  ('KMJ',  'BCA', 2027),
  ('NAAS', 'B.Sc Artificial Intelligence', 2027),
  ('SVU',  'BCA', 2027),
  ('SDNB', 'B.Sc Computer Science with Artificial Intelligence', 2027),
  ('STC',  'MCA', 2027),
  ('SACAS','BCA', 2027),
  ('TU',   'B.Sc Artificial Intelligence and Machine Learning', 2027),
  ('TERF', 'B.Sc Information Technology', 2027),
  ('TJS',  'B.Sc Computer Science with Artificial Intelligence', 2027)
) as y(code, deg_name, year)
join public.campuses c on c.code = y.code
join public.degrees d on d.name = y.deg_name
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 6. Institutional Skill Repository (PRD §5)
-- -----------------------------------------------------------------------------
insert into public.skill_areas (name) values
  ('Aptitude'),
  ('Communication skills'),
  ('Fundamentals of Programming'),
  ('Data Structures and Algorithms'),
  ('GitHub strength'),
  ('Programming skills'),
  ('AI skills'),
  ('AI-assisted Full Stack Development')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 7. System Settings & Policies
-- -----------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('offer_category_bands', '{"regularMaxLpa": 5, "dreamMaxLpa": 10}'::jsonb),
  ('absence_limit', '3'::jsonb),
  ('max_upload_bytes', '5242880'::jsonb),
  ('email_dispatcher_enabled', 'true'::jsonb),
  ('email_batch_size', '50'::jsonb)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

-- -----------------------------------------------------------------------------
-- 8. Seed Founding Admins & Operations Staff
-- -----------------------------------------------------------------------------
insert into public.staff_invitations (email, full_name, role) values
  ('thanush@faceprep.in', 'Thanush Krishna', 'admin'),
  ('karthikraja@faceprep.in', 'Karthik Raja', 'admin'),
  ('admin@faceprep.in', 'System Admin', 'admin'),
  ('radhika@faceprep.in', 'Radhika C M', 'central_placement_coordinator'),
  ('radhikacmsai@gmail.com', 'Radhika AE', 'account_executive'),
  ('karthick@faceprep.in', 'Guna Karthick', 'key_account_manager'),
  ('shyam.kumar@faceprep.in', 'Shyam Kumar A K', 'key_account_manager'),
  ('praveen@faceprep.in', 'Praveen Ramesh', 'campus_manager'),
  ('abhishek@faceprep.in', 'Abhishek', 'er_head'),
  ('armaan@faceprep.in', 'Armaan', 'account_executive')
on conflict (email) do update
  set role = excluded.role,
      full_name = excluded.full_name;

-- Seed Campus Placement Coordinators and Campus Managers
insert into public.staff_invitations (email, full_name, role) values
  ('janerhinu@gmail.com', 'Jhane Rhinu', 'campus_placement_coordinator'),
  ('dunominejeyaraj@gmail.com', 'Dunomine Jeyaraj', 'campus_manager'),
  ('geethaaa701@gmail.com', 'Geetha D', 'campus_placement_coordinator'),
  ('tamilarasand2400@gmail.com', 'Tamilarasan D', 'campus_placement_coordinator'),
  ('syedfaceprep@gmail.com', 'Syed Asrar Ahmed U', 'campus_manager'),
  ('ldharmaprakash2002@gmail.com', 'Dharmaprakash L', 'campus_placement_coordinator'),
  ('priyadharshini07082002@gmail.com', 'Priyadharshini P', 'campus_manager'),
  ('nivethapoopathi@gmail.com', 'Nivetha R P', 'campus_placement_coordinator'),
  ('mohanasree2101@gmail.com', 'Mohana Sree', 'campus_placement_coordinator'),
  ('ajithk455@gmail.com', 'Ajith Kumar', 'campus_manager'),
  ('ramalakshmi.b.faceprep@gmail.com', 'Ramalakshmi B', 'campus_placement_coordinator'),
  ('snegha2019@gmail.com', 'Sneha G', 'campus_placement_coordinator'),
  ('gayat1206@gmail.com', 'Gayathri K', 'campus_manager'),
  ('shabeebshab96@gmail.com', 'Shabeeb', 'campus_placement_coordinator'),
  ('vrrpathi@gmail.com', 'Kapila L', 'campus_placement_coordinator'),
  ('aarthiravichandranr@gmail.com', 'Aarthi R', 'campus_placement_coordinator'),
  ('ajiithpandian8799@gmail.com', 'AjiithPandian', 'campus_placement_coordinator')
on conflict (email) do update
  set role = excluded.role,
      full_name = excluded.full_name;

-- -----------------------------------------------------------------------------
-- 9. Staff Campus Stage Invitations (staff_campus_invitations)
-- -----------------------------------------------------------------------------
insert into public.staff_campus_invitations (email, campus_id)
select inv.email, c.id
from (values
  ('janerhinu@gmail.com', 'KMJ'),
  ('dunominejeyaraj@gmail.com', 'KMJ'),
  ('geethaaa701@gmail.com', 'SDNB'),
  ('tamilarasand2400@gmail.com', 'AMET'),
  ('syedfaceprep@gmail.com', 'AMET'),
  ('ldharmaprakash2002@gmail.com', 'BCAS'),
  ('priyadharshini07082002@gmail.com', 'BCAS'),
  ('nivethapoopathi@gmail.com', 'SACAS'),
  ('mohanasree2101@gmail.com', 'NAAS'),
  ('ajithk455@gmail.com', 'NAAS'),
  ('ramalakshmi.b.faceprep@gmail.com', 'SVU'),
  ('snegha2019@gmail.com', 'STC'),
  ('gayat1206@gmail.com', 'STC'),
  ('shabeebshab96@gmail.com', 'TU'),
  ('vrrpathi@gmail.com', 'TERF'),
  ('aarthiravichandranr@gmail.com', 'TJS'),
  ('ajiithpandian8799@gmail.com', 'AU')
) as inv(email, code)
join public.campuses c on c.code = inv.code
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 10. Automatically sync profiles for existing auth.users
-- -----------------------------------------------------------------------------
insert into public.profiles (id, email, full_name, role, is_active)
select 
  u.id,
  lower(u.email),
  coalesce(inv.full_name, 'Staff Member'),
  coalesce(inv.role, 'campus_placement_coordinator'::public.app_role),
  true
from auth.users u
join public.staff_invitations inv on lower(inv.email) = lower(u.email)
on conflict (id) do update
  set role = excluded.role,
      full_name = excluded.full_name,
      is_active = true;

-- Sync staff campus assignments for existing active profiles
insert into public.staff_campus_assignments (profile_id, campus_id)
select p.id, sci.campus_id
from public.profiles p
join public.staff_campus_invitations sci on lower(sci.email) = lower(p.email)
on conflict do nothing;

-- =============================================================================
-- Founding Admin Bootstrap: thanush@faceprep.in
-- =============================================================================

delete from public.students 
where lower(btrim(email)) = 'thanush@faceprep.in';

insert into public.staff_invitations (email, full_name, role)
values ('thanush@faceprep.in', 'Thanush Krishna', 'admin')
on conflict (email) do update
  set role = 'admin',
      full_name = 'Thanush Krishna';

insert into public.profiles (id, email, full_name, role, is_active)
select 
  u.id,
  'thanush@faceprep.in',
  'Thanush Krishna',
  'admin'::public.app_role,
  true
from auth.users u
where lower(btrim(u.email)) = 'thanush@faceprep.in'
on conflict (id) do update
  set role = 'admin'::public.app_role,
      full_name = 'Thanush Krishna',
      is_active = true;

update public.staff_invitations
   set accepted_at = coalesce(accepted_at, now())
 where lower(btrim(email)) = 'thanush@faceprep.in'
   and exists (
     select 1 from public.profiles 
     where lower(btrim(email)) = 'thanush@faceprep.in'
   );

