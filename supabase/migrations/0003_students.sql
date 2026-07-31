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
