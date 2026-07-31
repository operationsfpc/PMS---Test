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
