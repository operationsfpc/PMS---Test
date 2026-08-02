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
