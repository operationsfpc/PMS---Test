-- Migration 0147: Prevent a student from applying to multiple roles in the same drive / recruitment event.
--
-- A candidate is not permitted to apply for more than one role under the same drive
-- (identified by matching company_drive_id, or same company visit on the same tentative date).

create or replace function enforce_application_gates() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d drives%rowtype;
  s students%rowtype;
  highest_rank integer;
  drive_rank   integer;
  -- The standing eligibility is measured on (§7.2).
  verified_cgpa      numeric;
  verified_arrears   integer;
  verified_history   integer;
  cgpa_value         numeric;
  standing_arrears   integer;
  arrear_history     integer;
  -- RAISE's first argument has to be a string literal, so the sentence is
  -- chosen into a variable and substituted with % rather than written inline.
  v_refusal          text;
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

  -- 0147: The same candidate should not be allowed to apply for multiple roles in the same drive.
  if exists (
    select 1
      from applications a
      join drives sibling on sibling.id = a.drive_id
     where a.student_id = new.student_id
       and a.drive_id <> new.drive_id
       and (
         (d.company_drive_id is not null and sibling.company_drive_id = d.company_drive_id)
         or (
           d.company_name is not null
           and d.tentative_date is not null
           and sibling.tentative_date = d.tentative_date
           and lower(trim(regexp_replace(sibling.company_name, '\s+', ' ', 'g'))) = lower(trim(regexp_replace(d.company_name, '\s+', ' ', 'g')))
         )
       )
  ) then
    raise exception 'You have already applied for another role in this drive.'
      using errcode = 'check_violation';
  end if;

  select * into s from students where id = new.student_id;

  if s.srf_status <> 'srf_approved' then
    raise exception 'Your registration form has not been approved yet.'
      using errcode = 'check_violation';
  end if;

  if s.participation_status <> 'active' then
    v_refusal := case s.participation_status
      when 'opted_out' then 'You have opted out of campus placements.'
      when 'on_hold'   then 'Your college has placed a hold on your placements. Contact your placement office.'
      else 'You are not currently eligible to apply. Contact your coordinator.'
    end;
    raise exception '%', v_refusal using errcode = 'check_violation';
  end if;

  -- --------------------------------------------- what the company asked for
  -- Degrees and branches are link tables, so "no rows" is the one case that
  -- must NOT refuse: an empty list means ANY degree, never no degree (R2). The
  -- same shape the campus gate above already uses.
  if exists (select 1 from drive_eligible_degrees dd where dd.drive_id = d.id)
     and not exists (
       select 1 from drive_eligible_degrees dd
        where dd.drive_id = d.id and dd.degree_id = s.degree_id
     ) then
    raise exception 'This drive is not open to your degree.'
      using errcode = 'check_violation';
  end if;

  -- 0137: the branch tick binds the students who run the degree that owns it.
  -- No degrees ticked means the branches are the whole targeting, so they bind
  -- everyone; degrees ticked beside a branch that belongs to none of them bind
  -- only their own.
  if exists (select 1 from drive_eligible_branches bb where bb.drive_id = d.id)
     and (
       not exists (select 1 from drive_eligible_degrees dd where dd.drive_id = d.id)
       or exists (
         select 1 from drive_eligible_branches bb
           join branches br on br.id = bb.branch_id
          where bb.drive_id = d.id and br.degree_id = s.degree_id
       )
     )
     and not exists (
       select 1 from drive_eligible_branches bb
        where bb.drive_id = d.id and bb.branch_id = s.branch_id
     ) then
    raise exception 'This drive is not open to your branch.'
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

  -- Same shape, different storage: passing years are an array on the drive
  -- rather than a link table, and an empty array is the same silence.
  if array_length(d.eligible_passing_years, 1) is not null
     and not (s.passing_year = any (d.eligible_passing_years)) then
    raise exception 'This drive is not open to your passing year.'
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

  -- --------------------------------------------- the college standing bars
  select latest.cgpa,
         latest.current_arrears,
         (select max(m.history_of_arrears)
            from student_semesters m
           where m.student_id = new.student_id and m.status = 'verified')
    into verified_cgpa, verified_arrears, verified_history
    from student_semesters latest
   where latest.student_id = new.student_id
     and latest.status = 'verified'
   order by latest.semester_number desc
   limit 1;

  if verified_cgpa is not null then
    cgpa_value       := verified_cgpa;
    standing_arrears := verified_arrears;
    arrear_history   := coalesce(verified_history, 0);
  else
    cgpa_value       := coalesce(s.overall_cgpa, 0);
    standing_arrears := coalesce(s.current_arrears, 0);
    arrear_history   := coalesce(s.history_of_arrears, 0);
  end if;

  if d.min_overall_cgpa is not null and cgpa_value < d.min_overall_cgpa then
    raise exception 'This drive requires a CGPA of at least %, and yours is %.',
      d.min_overall_cgpa, cgpa_value
      using errcode = 'check_violation';
  end if;

  if d.arrears_policy in ('no_standing', 'no_history') and standing_arrears > 0 then
    raise exception 'This drive asks for no standing arrears, and you have %.', standing_arrears
      using errcode = 'check_violation';
  end if;

  if d.arrears_policy = 'no_history' and arrear_history > 0 then
    raise exception 'This drive asks for no history of arrears, and yours has %.', arrear_history
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
  if d.drive_type is not null
     and cardinality(s.drive_type_preferences) > 0
     and not (d.drive_type = any (s.drive_type_preferences)) then
    raise exception
      'This drive''s drive type is not among the ones you asked for in your preferences.'
      using errcode = 'check_violation';
  end if;

  -- R4 — the internship cap, PLAIN internship drives only
  if d.drive_type = 'internship' and exists (
       select 1 from offers o
        where o.student_id = new.student_id
          and o.drive_type in ('internship', 'internship_convertible')
     ) then
    raise exception 'You have already accepted an internship offer.'
      using errcode = 'check_violation';
  end if;

  -- R3/R5 — the ladder.
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

