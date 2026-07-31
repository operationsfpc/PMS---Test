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
