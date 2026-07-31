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
