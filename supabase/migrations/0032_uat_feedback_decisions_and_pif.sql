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
