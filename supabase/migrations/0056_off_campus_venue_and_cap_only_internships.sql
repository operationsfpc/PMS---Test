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
