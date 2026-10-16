-- 0119 — The eligibility gates the override could not be trusted to respect
--
-- `enforce_application_gates` (0041, last restated in 0056) checked the drive's
-- status, the window, the SRF, participation, campus targeting and the 10th/12th
-- bars, and then:
--
--     if d.open_to_all_override then return new; end if;
--
-- Everything BELOW that line was the ladder and the preferences, which R5a says
-- the override exists to bypass. Everything the company actually asked for —
-- `min_overall_cgpa`, `arrears_policy`, `drive_eligible_degrees`,
-- `drive_eligible_branches`, `eligible_passing_years` — was never checked at
-- apply time AT ALL, for any student, override or not. Those five rules existed
-- in one place only: `evaluateEligibility` in the browser. A crafted POST went
-- straight through.
--
-- So the answer to "should an open-to-all drive reach a student who fails the
-- criteria?" (2026-10-15) is: on screen no, in the database yes. The publish
-- screen counts an audience with those rules applied, ticked or not, and the
-- database then admitted people outside it. Worse, on a prestige drive the
-- override made the hole total, because it returned before any of it.
--
-- This moves all four gates ABOVE the short-circuit, which is where the domain
-- already has them (src/domain/visibility.ts: eligibility, then the override).
-- `drives_student_read` stays coarse on purpose — what a student may LIST is not
-- what a student may WIN, and a read policy that returns fewer rows is a
-- support ticket, not a safeguard. The apply gate is the one that has to be
-- right.
--
-- Arrears and CGPA are judged on the LATEST VERIFIED semester, not on what the
-- student typed last (§7.2, src/domain/academics.ts) — an unchecked number cannot
-- decide whether somebody may apply, and the semester rows a student writes
-- themselves arrive `pending`. Until a coordinator verifies any line, the figures
-- the coordinator imported for the roster stand in, exactly as the browser does:
-- locking out a cohort nobody has checked yet is a worse answer than judging it
-- on the number the college gave us.
--
-- Mirrors src/domain/eligibility.ts and src/domain/academics.ts; change both or
-- neither. The full function is restated because CREATE OR REPLACE cannot patch
-- a body. Tests: src/db/apply-guard.test.ts.

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

  if exists (select 1 from drive_eligible_branches bb where bb.drive_id = d.id)
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
  -- `eligible_passing_years` has been asked by every drive since 0004 and
  -- checked by nobody until now — the batch that graduates is exactly what a
  -- recruiter names, and a 2025 student applying to a 2026-only drive takes a
  -- seat the company did not offer.
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

  -- ------------------------------------------------------- the CGPA and arrears
  -- `cgpa` and `current_arrears` are NOT NULL on a semester row, so a null here
  -- means the student has no verified line at all rather than a zeroed one.
  -- Arrear HISTORY is the max over every verified semester, not just the latest
  -- one: a backlog cleared in semester 3 is still on the record (`academics.ts`
  -- takes the same maximum).
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

  -- `no_history` is strictly stronger than `no_standing`: it forbids cleared
  -- backlogs as well as live ones (decision Q6).
  if d.arrears_policy in ('no_standing', 'no_history') and standing_arrears > 0 then
    raise exception 'This drive asks for no standing arrears, and you have %.', standing_arrears
      using errcode = 'check_violation';
  end if;

  if d.arrears_policy = 'no_history' and arrear_history > 0 then
    raise exception 'This drive asks for no history of arrears, and yours has %.', arrear_history
      using errcode = 'check_violation';
  end if;

  -- R5a: the override bypasses the preference gates below — never the ones
  -- above. Everything the company asked for is now checked BEFORE this line, so
  -- a prestige drive widens WHO MAY ASK, not WHO MAY QUALIFY.
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

-- =============================================================================
-- The same audience, seen from the drive's side
-- =============================================================================
--
-- The gate above decides who may APPLY. This trigger decides who the drive is
-- mailed to when it goes live, and the two had drifted apart three ways:
--
--   1. It read `students.overall_cgpa`, `current_arrears` and
--      `history_of_arrears` — the imported roster — where the gate reads the
--      latest VERIFIED semester and falls back to the roster only until a
--      coordinator verifies anything (§7.2). A student whose transcript says
--      6.00 under a 7.5 bar was mailed an invitation the database then refused.
--   2. It never applied the area preference, the drive-type preference, the
--      internship cap or the ladder — the four gates below R5a's short-circuit
--      — so it mailed students who had asked not to be shown this kind of
--      drive, and students already placed at this rung or higher.
--   3. It did not know the override existed, so on a prestige drive it kept
--      those four exclusions to itself instead of mailing the widened audience
--      the gate admits.
--
-- What is deliberately NOT mirrored: the application window. A drive is
-- published ahead of its window on purpose, and the "new drive" mail is what
-- tells the cohort it is coming. Eligibility is mirrored; timing is not.
--
-- Mirrors the function above; change both or neither. Proven to agree by
-- src/db/apply-guard.test.ts, which compares who is mailed against who is
-- admitted for the same students.

create or replace function notify_eligible_students_on_drive_live()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_student_rec record;
  v_notification_id uuid;
  v_drive_title text;
  v_body text;
  v_ctc_display text;
  v_students_notified integer := 0;
begin
  if new.status <> 'live' or (tg_op = 'update' and old.status is not distinct from 'live') then
    return new;
  end if;

  if new.ctc_min_lpa is not null and new.ctc_max_lpa is not null then
    if new.ctc_min_lpa = new.ctc_max_lpa then
      v_ctc_display := new.ctc_min_lpa::text || ' LPA';
    else
      v_ctc_display := new.ctc_min_lpa::text || ' - ' || new.ctc_max_lpa::text || ' LPA';
    end if;
  else
    v_ctc_display := 'As per policy';
  end if;

  v_drive_title := new.company_name || ' — ' || coalesce(new.role_title, 'Placement Opportunity');

  -- `latest` and `hist` are the two figures §7.2 takes from the transcript: the
  -- newest verified semester, and the worst arrear history across every
  -- verified one — a backlog cleared in semester 3 is still on the record.
  for v_student_rec in
    select s.id, s.full_name
      from students s
      left join lateral (
        select m.cgpa, m.current_arrears
          from student_semesters m
         where m.student_id = s.id and m.status = 'verified'
         order by m.semester_number desc
         limit 1
      ) latest on true
      left join lateral (
        select max(m.history_of_arrears) as history_of_arrears
          from student_semesters m
         where m.student_id = s.id and m.status = 'verified'
      ) hist on true
     where s.srf_status = 'srf_approved'
       and s.participation_status = 'active'

       -- --------------------------------------------- what the company asked for
       and (
         not exists (select 1 from drive_target_campuses dtc where dtc.drive_id = new.id)
         or exists (
           select 1 from drive_target_campuses dtc
            where dtc.drive_id = new.id and dtc.campus_id = s.campus_id
         )
       )
       and (
         not exists (select 1 from drive_eligible_degrees ded where ded.drive_id = new.id)
         or exists (
           select 1 from drive_eligible_degrees ded
            where ded.drive_id = new.id and ded.degree_id = s.degree_id
         )
       )
       and (
         not exists (select 1 from drive_eligible_branches deb where deb.drive_id = new.id)
         or exists (
           select 1 from drive_eligible_branches deb
            where deb.drive_id = new.id and deb.branch_id = s.branch_id
         )
       )
       and (
         array_length(new.eligible_passing_years, 1) is null
         or s.passing_year = any (new.eligible_passing_years)
       )

       -- ------------------------------------------------- the school marks bars
       and (
         new.min_tenth_percentage is null
         or (s.tenth_percentage is not null and s.tenth_percentage >= new.min_tenth_percentage)
       )
       and (
         new.min_twelfth_percentage is null
         or (s.twelfth_percentage is not null
             and s.twelfth_percentage >= new.min_twelfth_percentage)
       )

       -- ---------------------------------------------------- the CGPA and arrears
       and (
         new.min_overall_cgpa is null
         or coalesce(latest.cgpa, s.overall_cgpa, 0) >= new.min_overall_cgpa
       )
       and (
         new.arrears_policy = 'flexible'
         or coalesce(latest.current_arrears, s.current_arrears, 0) = 0
       )
       and (
         new.arrears_policy <> 'no_history'
         or case when latest.cgpa is not null
                 then coalesce(hist.history_of_arrears, 0)
                 else coalesce(s.history_of_arrears, 0)
            end = 0
       )

       -- R5a: below this line is the audience the override widens — which is
       -- exactly why it has to be skipped here as well as in the gate.
       and (
         new.open_to_all_override
         or (
              ------------------------------------------------------ the area
              (
                new.role_category is null
                or not exists (
                  select 1 from student_role_preferences p where p.student_id = s.id
                )
                or exists (
                  select 1 from student_role_preferences p
                   where p.student_id = s.id and p.category = new.role_category
                )
              )
              -- ------------------------------------------------- the drive type
              and (
                new.drive_type is null
                or coalesce(cardinality(s.drive_type_preferences), 0) = 0
                or new.drive_type = any (s.drive_type_preferences)
              )
              -- ------------------------------------------------ internship cap
              and (
                new.drive_type <> 'internship'
                or not exists (
                  select 1 from offers o
                   where o.student_id = s.id
                     and o.drive_type in ('internship', 'internship_convertible')
                )
              )
              -- ------------------------------------------------------ the ladder
              and (
                new.drive_type not in ('placement', 'internship_convertible')
                or new.offer_category is null
                or not exists (
                  select 1 from offers o
                   where o.student_id = s.id
                     and o.drive_type in ('placement', 'internship_convertible')
                     and o.offer_category is not null
                     and case o.offer_category
                           when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
                         end
                       >= case new.offer_category
                           when 'regular' then 1 when 'dream' then 2 when 'super_dream' then 3
                         end
                )
              )
         )
       )

       -- Dedup guard: skip students already notified about this drive.
       and not exists (
         select 1 from notifications n
          where n.student_id = s.id
            and n.kind = 'drive_published'
            and n.drive_id = new.id
       )
  loop
    v_body := 'A new placement drive is now open for applications at your campus.' || E'\n\n' ||
              '**Company:** ' || new.company_name || E'\n' ||
              '**Role:** ' || coalesce(new.role_title, 'Not specified') || E'\n' ||
              '**CTC Range:** ' || v_ctc_display || E'\n';

    if new.application_end is not null then
      v_body := v_body || '**Application Deadline:** ' ||
                to_char(new.application_end, 'DD Mon YYYY, HH12:MI AM') || E'\n';
    end if;

    v_body := v_body || E'\n' || 'Log in to the portal to view full details and submit your application.';

    insert into notifications (student_id, kind, title, body, drive_id)
    values (
      v_student_rec.id,
      'drive_published',
      'New Drive: ' || v_drive_title,
      v_body,
      new.id
    )
    returning id into v_notification_id;

    v_students_notified := v_students_notified + 1;
  end loop;

  raise notice 'Drive % went live: notified % eligible students', new.id, v_students_notified;

  return new;
end;
$$;
