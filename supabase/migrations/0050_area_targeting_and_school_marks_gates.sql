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
