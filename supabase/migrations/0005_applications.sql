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
