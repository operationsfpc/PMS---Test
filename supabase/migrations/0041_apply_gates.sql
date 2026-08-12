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
