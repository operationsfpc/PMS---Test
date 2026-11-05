-- ============================================================================
-- 0137 — A branch tick binds only the degree it belongs to
--
-- THE FLAW. The publish screen ticks whole programmes — "BCA", "B.Sc — AI and
-- ML" — and the two link tables flatten that into a degree list and a branch
-- list. Both gates then read those lists as one AND, so a degree ticked BESIDE
-- another degree's branches refuses every student of it: none of the ticked
-- branches can be theirs, and a non-empty branch list admits nobody whose branch
-- is not named — not even a student with no branch at all. The degree tick did
-- nothing.
--
-- This is what emptied the test project's audience on 2026-11-05. Every open
-- drive ticks B.Sc branches beside BCA and MCA, so BCA and MCA students see no
-- drives and are never notified, while the publish screen counts an audience
-- that agrees with the ticks. The report was "student 124 received no drives".
--
-- THE RULE, in words: a ticked branch narrows the students who run the degree
-- that owns it, and nobody else. A branch tick with NO degree tick still binds
-- every student, because then the specialisation is the whole targeting — that
-- is the tightening 0119 was written for, and it holds.
--
-- src/domain/eligibility.ts already carries this rule, with the same wording,
-- and the student's list and the publish screen's audience count are both
-- computed from it. The database is the one place that can still refuse an
-- application the browser just offered, and it decides who is notified. Both
-- have to say the same thing, or the student sees the drive and is refused on
-- Apply.
--
-- WHAT CHANGES VISIBLY
--   Nothing on the screens — they already show the audience this rule gives.
--   This makes the database agree with them, so a student is not refused after
--   being offered the drive, and a drive going live notifies the programmes its
--   ticks name instead of only the one whose branches were listed. Students
--   already notified stay notified; nothing here re-sends.
--
-- HOW TO RUN
--   Supabase Dashboard -> the TEST project (jpejihmcbgerekyiikgb) -> SQL Editor
--   -> paste -> Run. Both bodies are the ones deployed there today, read out
--   with pg_get_functiondef and restated with ONLY the branch block changed, so
--   nothing else in them drifts. Verification SELECTs at the bottom.
--
--   Checked against the database on 2026-11-05: the untouched half of the gate
--   body is byte-for-byte its stored prosrc. The notifier was originally applied
--   from a CRLF file, so its stored body carries CR before every LF; pasting
--   this normalises those to LF and nothing else. That cannot change a sentence
--   a student reads — every string the notifier builds is a single-line literal
--   with explicit E'\n' escapes, so no CR was ever inside the text it stores.
--
-- WHY IT REFUSES TO RUN ANYWHERE ELSE
--   These bodies were read out of TEST, and prod's copies are not the same file
--   — prod is behind the repo on several migrations. Pasting this there would
--   not fix the branch rule; it would roll the rest of both functions back to
--   what test happens to hold. So the guard below stops before the first write
--   unless this is the test project's database.
--
-- UNDO  scripts/undo-0137-branch-tick.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Ask the database who it is
-- ---------------------------------------------------------------------------
-- The SQL editor shows no project ref and current_database() is 'postgres'
-- everywhere, so the person pasting cannot answer "which project is this tab?"
-- from inside the editor. KG College's own test code, holding the small test
-- roster, is the signature only test has — the same shape
-- scripts/seed-10-colleges-test.sql checks for. 3 at KG-1 now, 4 before that
-- seed moved Radhika C M to SDNB.
do $$
declare
  n_campuses    integer;
  n_kg_students integer;
begin
  select count(*) into n_campuses from campuses;
  select count(*) into n_kg_students
    from students s
    join campuses c on c.id = s.campus_id
   where c.code = 'KG-1';

  if not exists (select 1 from campuses where code = 'KG-1') then
    raise exception
      'Refused: no KG-1 campus among the % campuses here, so this is not the TEST project '
      '(jpejihmcbgerekyiikgb). The two gate functions below were read out of test and would '
      'overwrite whatever this database has. Nothing was written. Switch the Dashboard to '
      'the test project and run it again.',
      n_campuses
      using errcode = 'check_violation';
  end if;

  if n_kg_students not in (3, 4) then
    raise exception
      'Refused: KG-1 holds % students here, not the 3 or 4 the TEST project was seeded '
      'with, and there are % campuses. Nothing was written.',
      n_kg_students, n_campuses
      using errcode = 'check_violation';
  end if;

  if not exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and proname = 'enforce_application_gates'
     )
  then
    raise exception
      'Refused: enforce_application_gates is not here, so 0119 has not been applied to this '
      'database yet. Apply the migrations before this one first.'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The gate that refuses an application
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_application_gates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. The notifier that decides who is told about a drive
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_eligible_students_on_drive_live()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  for v_student_rec in
    select distinct s.id, s.full_name, s.email
      from students s
     where s.srf_status = 'srf_approved'
       and s.participation_status = 'active'
       and (
         not exists (select 1 from drive_target_campuses dtc where dtc.drive_id = new.id)
         or exists (
           select 1 from drive_target_campuses dtc
            where dtc.drive_id = new.id
              and dtc.campus_id = s.campus_id
         )
       )
       and (
         not exists (select 1 from drive_eligible_degrees ded where ded.drive_id = new.id)
         or exists (
           select 1 from drive_eligible_degrees ded
            where ded.drive_id = new.id
              and ded.degree_id = s.degree_id
         )
       )
       -- 0137: the exact mirror of the branch gate in enforce_application_gates.
       -- A ticked branch narrows only the students who run the degree that owns
       -- it, so a branch list belonging to none of the ticked degrees narrows
       -- nobody — and the notifier must not stay silent about a drive those
       -- students are then admitted to.
       and (
         not exists (select 1 from drive_eligible_branches deb where deb.drive_id = new.id)
         or (
           exists (select 1 from drive_eligible_degrees ded where ded.drive_id = new.id)
           and not exists (
             select 1 from drive_eligible_branches deb
               join branches br on br.id = deb.branch_id
              where deb.drive_id = new.id
                and br.degree_id = s.degree_id
           )
         )
         or exists (
           select 1 from drive_eligible_branches deb
            where deb.drive_id = new.id
              and deb.branch_id = s.branch_id
         )
       )
       and (
         array_length(new.eligible_passing_years, 1) is null
         or s.passing_year = any(new.eligible_passing_years)
       )
       and (
         new.min_overall_cgpa is null
         or s.overall_cgpa >= new.min_overall_cgpa
       )
       and (
         new.min_tenth_percentage is null
         or s.tenth_percentage >= new.min_tenth_percentage
       )
       and (
         new.min_twelfth_percentage is null
         or s.twelfth_percentage >= new.min_twelfth_percentage
       )
       -- Fixed: use actual enum values ('no_standing', 'no_history', 'flexible')
       and (
         new.arrears_policy = 'flexible'
         or (new.arrears_policy = 'no_history' and s.current_arrears = 0 and s.history_of_arrears = 0)
         or (new.arrears_policy = 'no_standing' and s.current_arrears = 0)
       )
       -- Dedup guard: skip students who already have a drive_published notification for this drive
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
      v_body := v_body || '**Application Deadline:** ' || to_char(new.application_end, 'DD Mon YYYY, HH12:MI AM') || E'\n';
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
$function$;

commit;

-- ---------------------------------------------------------------------------
-- 3. The rule is in both functions
-- ---------------------------------------------------------------------------
-- Both flags true. A false one means that function was not replaced, so the
-- statement that made it raise is still holding the transaction open.
select proname,
       prosrc like '%br.degree_id = s.degree_id%' as branch_tick_scoped_to_its_degree
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('enforce_application_gates', 'notify_eligible_students_on_drive_live')
 order by proname;

-- ---------------------------------------------------------------------------
-- 4. Whom the flattened targeting was shutting out
-- ---------------------------------------------------------------------------
-- Every drive that ticks branches owned by a DIFFERENT degree beside a ticked
-- degree, with the headcount that other degree carries. Until this file those
-- students were refused by a branch list they can never appear in.
select d.company_name,
       d.role_title,
       d.status,
       dg.name as degree_ticked,
       (
         select string_agg(distinct br.name, ', ')
           from drive_eligible_branches deb
           join branches br on br.id = deb.branch_id
          where deb.drive_id = d.id
       ) as branches_ticked,
       count(s.id) filter (where s.participation_status = 'active') as students_of_that_degree
  from drives d
  join drive_eligible_degrees ded on ded.drive_id = d.id
  join degrees dg on dg.id = ded.degree_id
  left join students s on s.degree_id = dg.id
 where exists (
         select 1 from drive_eligible_branches deb
           join branches br on br.id = deb.branch_id
          where deb.drive_id = d.id and br.degree_id <> dg.id
       )
 group by d.id, d.company_name, d.role_title, d.status, dg.name
 order by d.company_name, d.role_title, dg.name;

-- ---------------------------------------------------------------------------
-- 5. Whom each live drive reaches under the new rule
-- ---------------------------------------------------------------------------
-- The degrees that used to read zero are the ones to look for here. A drive
-- still reading zero for a degree it ticks is a campus, passing-year, CGPA or
-- arrear bar doing the refusing, not the branch list.
select d.company_name,
       d.role_title,
       dg.name as degree,
       count(*) filter (
         where s.srf_status = 'srf_approved'
           and s.participation_status = 'active'
           and d.application_start <= now() and d.application_end >= now()
           and (
             not exists (select 1 from drive_target_campuses tc where tc.drive_id = d.id)
             or exists (
               select 1 from drive_target_campuses tc
                where tc.drive_id = d.id and tc.campus_id = s.campus_id
             )
           )
           and (
             not exists (select 1 from drive_eligible_degrees ded where ded.drive_id = d.id)
             or exists (
               select 1 from drive_eligible_degrees ded
                where ded.drive_id = d.id and ded.degree_id = s.degree_id
             )
           )
           and (
             not exists (select 1 from drive_eligible_branches deb where deb.drive_id = d.id)
             or (
               exists (select 1 from drive_eligible_degrees ded where ded.drive_id = d.id)
               and not exists (
                 select 1 from drive_eligible_branches deb
                   join branches br on br.id = deb.branch_id
                  where deb.drive_id = d.id
                    and br.degree_id = s.degree_id
               )
             )
             or exists (
               select 1 from drive_eligible_branches deb
                where deb.drive_id = d.id and deb.branch_id = s.branch_id
             )
           )
       ) as students_reached_by_this_rule,
       count(*) as students_of_that_degree
  from drives d
  join drive_eligible_degrees ded on ded.drive_id = d.id
  join degrees dg on dg.id = ded.degree_id
  join students s on s.degree_id = dg.id
 where d.status = 'live'
 group by d.id, d.company_name, d.role_title, dg.name
 order by d.company_name, d.role_title, dg.name;
