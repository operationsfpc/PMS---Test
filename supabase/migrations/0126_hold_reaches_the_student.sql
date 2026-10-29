-- 0126_hold_reaches_the_student.sql
--
-- 0125 gave a Campus Manager the hold and 0124 the status that carries it. This
-- is the half the request was actually about: "no notification can get to the
-- student".
--
-- WHY EDITS WERE NEEDED AT ALL. A fourth state is caught for free by any gate
-- that asks `participation_status = 'active'` (or `<> 'active'`) — that is the
-- apply gate (0119), the drive-live fan-out (0119) and the reminders (0114), and
-- none of them were touched here. It is NOT caught by a gate that asks
-- `= 'opted_out'`, which is a list of one. Five live functions asked that, and
-- every one of them would have gone on talking to a held student as if nothing
-- had happened.
--
-- WHAT CHANGED, one rule everywhere: the question is now "is this student in
-- placements", answered `participation_status = 'active'`, which is the same
-- shape the two gates that were already right have always used. So the whole
-- set is greppable as one pattern, and a fifth status added later is refused by
-- all of them at once rather than remembered by each.
--
--   enqueue_notification_email    every student email in the product (0111)
--   round_details_reach_students  round schedule notification     (0075)
--   shortlist_reaches_student     shortlist notification          (0075)
--   round_result_reaches_student  cleared / not selected          (0075)
--   meeting_slot_reaches_student  personal slot + link            (0075)
--   offer_reaches_student         offer extended                  (0089)
--   notify_absent_student         marked absent                   (0057)
--   shortlist_respects_opt_out    the WRITE guard, not mail       (0043)
--   enforce_application_gates     refusal sentence only           (0119)
--
-- The last two are the ones to read twice:
--
--   shortlist_respects_opt_out is widened with the mail. A held student who can
--     still be shortlisted is scheduled into Round 1 and given an attendance
--     row; only the notice is missing. The override it names — an explicit
--     `opt_out_override_reason` — still works, and the sentence now says which
--     state it is refusing, because "this student has opted out" is a lie about
--     somebody the college held.
--
--   enforce_application_gates refused a held student with "You have opted out of
--     campus placements or are not currently eligible." That has always been a
--     guess at three different facts. It now names the student's own state, in
--     the same words src/features/student/apply-repository.ts uses, so the
--     screen and the database cannot tell the student two different stories.
--
-- ONE CONSEQUENCE THAT IS NOT ABOUT HOLDS, stated rather than slipped in:
--   `disbarred` students were mailed until now, because disbarment is neither
--   active nor opted_out and no gate ever asked about it. A student barred by
--   Central for absences was being sent "You are shortlisted for X" for a drive
--   the apply gate refuses them. Reading the rule as `= 'active'` fixes that at
--   the same time. If the intent is that a disbarred student keeps receiving
--   mail, this is the line to change — and src/db/held-student-mail.test.ts is
--   the test that will fail when it does.
--
-- CHECKED AND DELIBERATELY NOT CHANGED:
--   0009:141 enforce_opt_out_irreversible — fires only when LEAVING opted_out,
--     so `on_hold -> active` on release is legal. That is what makes Release
--     work, and it must stay exactly as it is.
--   0076 student lifecycle mail (roster invitation, SRF approval) and 0048's
--     SRF rejection notice skip only opted_out, and they should. Those are about
--     the student's own registration, which a college hold does not cancel; a
--     held student whose form was just approved needs to know. Making them
--     active-only would also send a hold-order "you have been held" mail, which
--     is not what this feature decided — the hold is read on screen, not mailed.
--   0064 placement_totals buckets `opted_out` separately from the eligible
--     denominator. A hold is releasable and temporary, so the batch total must
--     not move when a manager presses Hold and move back when they press
--     Release; a held student stays in `eligible`, exactly as a disbarred
--     student already does. The held count belongs on the roster, not in the
--     placement percentage.
--   0112/0113/0114/0115 — every one of those inserts into email_deliveries with
--     a STAFF recipient (KAM, campus CPC, principal/dean, Delivery Head); they
--     join students only to compose the sentence. Nothing here reaches them.
--   0020:86, 0009:93, 0074:81 — `is distinct from old.participation_status`,
--     which is a change detector, not a filter.
--
-- Mirrors: src/domain/visibility.ts and src/features/student/apply-repository.ts
-- both need an `on_hold` reading of the same rule (tasks 119/123). Tests:
-- src/db/held-student-mail.test.ts, and src/db/hold-gate.test.ts for the table.

-- ---------------------------------------------------------------------------
-- The outbox. Every notification addressed to a student becomes an email here,
-- so this is the one place that decides whether the student hears at all.
-- ---------------------------------------------------------------------------
create or replace function enqueue_notification_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email  text;
  v_active boolean;
  v_campus_id uuid;
  v_cc_emails text[];
begin
  -- Get student email, whether they are still in placements, and campus
  SELECT email, (participation_status = 'active'), campus_id
    INTO v_email, v_active, v_campus_id
    FROM students WHERE id = NEW.student_id;

  -- `coalesce(..., false)` is load-bearing twice over. A notification with no
  -- student_id (every staff notification) selects no row, so v_active is NULL,
  -- and `not NULL` is NULL — which would sail past this guard and enqueue mail
  -- to nobody. The same trap 0064 names for placement_totals.
  IF not coalesce(v_active, false) OR v_email IS NULL OR trim(v_email) = '' THEN
    RETURN NEW;
  END IF;

  -- Resolve CC recipients based on notification kind
  v_cc_emails := resolve_cc_recipients(NEW.kind, v_campus_id, NEW.drive_id);

  -- Insert with CC
  INSERT INTO email_deliveries (notification_id, recipient_email, cc_emails, status)
  VALUES (NEW.id, lower(trim(v_email)), v_cc_emails, 'queued');

  RETURN NEW;
END;
$$;

comment on function enqueue_notification_email is
  'Stages notification in email_deliveries with To and CC recipients; students not in placements are skipped';

-- ---------------------------------------------------------------------------
-- The four round notices. Each writes a `notifications` row, which the outbox
-- above would now refuse to mail — but the in-app bell reads that row directly,
-- so "nothing at all" has to be decided here too.
-- ---------------------------------------------------------------------------
create or replace function round_details_reach_students() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company text;
  v_body    text;
begin
  if new.round_mode is not distinct from old.round_mode
     and new.round_scheduled_at is not distinct from old.round_scheduled_at
     and new.round_interview_link is not distinct from old.round_interview_link
     and new.venue is not distinct from old.venue then
    return new;  -- renames and proofs are not schedule news
  end if;

  select company_name into v_company from drives where id = new.drive_id;

  v_body := 'Round ' || new.sequence || ' (' || new.name || ') of ' || v_company
    || case when new.round_scheduled_at is not null
            then ' is scheduled for '
              || to_char(new.round_scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
              || ' IST'
            else ' has updated details' end
    || case when new.round_mode is not null
            then '. Mode: ' || replace(new.round_mode, '_', ' ') else '' end
    || case when new.round_mode = 'virtual' and new.round_interview_link is not null and length(trim(new.round_interview_link)) > 0
            then '. Join at: ' || trim(new.round_interview_link)
            when new.round_mode in ('on_campus', 'physical_outside_campus') and new.venue is not null and length(trim(new.venue)) > 0
            then '. Venue: ' || trim(new.venue)
            else '' end
    || '. Please report on time.';

  insert into notifications (student_id, kind, title, body)
  select a.student_id, 'round_scheduled',
         v_company || ' — Round ' || new.sequence || ' schedule', v_body
    from round_participants rp
    join applications a on a.id = rp.application_id
    join students s on s.id = a.student_id
   where rp.round_id = new.id
     and s.participation_status = 'active';

  return new;
end;
$$;

create or replace function shortlist_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first_round uuid;
  v_company     text;
  v_student     uuid;
  v_out_of_placements boolean;
begin
  select a.student_id, d.company_name, s.participation_status <> 'active'
    into v_student, v_company, v_out_of_placements
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select dr.id into v_first_round
    from drive_rounds dr
    join applications a on a.drive_id = dr.drive_id
   where a.id = new.application_id
   order by dr.sequence
   limit 1;

  if new.included and (tg_op = 'INSERT' or not old.included) then
    -- Schedule Round 1. A drive published before rounds existed has none;
    -- the notification still goes, and scheduling happens on the attendance
    -- screen as before.
    if v_first_round is not null then
      insert into round_participants (round_id, application_id, added_by)
      values (v_first_round, new.application_id, new.decided_by)
      on conflict (round_id, application_id) do nothing;

      insert into attendance (round_id, application_id, status)
      values (v_first_round, new.application_id, 'scheduled')
      on conflict (round_id, application_id) do nothing;
    end if;

    -- D7: a student out of placements gets NO notification, overridden or not —
    -- and since 0125 that includes one their college has held.
    if not v_out_of_placements then
      insert into notifications (student_id, kind, title, body)
      values (
        v_student,
        'shortlisted',
        'You are shortlisted for ' || v_company,
        'You are on the shortlist for ' || v_company ||
        '. Soon you will get notified for round details. Please report on time.'
      );
    end if;
  end if;

  -- Un-including takes back an untouched Round 1 slot. Anything already
  -- marked or decided stays: history is not rewritten by a checkbox.
  if not new.included and tg_op = 'UPDATE' and old.included and v_first_round is not null then
    delete from attendance
     where round_id = v_first_round
       and application_id = new.application_id
       and status = 'scheduled'
       and marked_by is null
       and not exists (select 1 from round_results r
                        where r.round_id = v_first_round
                          and r.application_id = new.application_id);
    delete from round_participants rp
     where rp.round_id = v_first_round
       and rp.application_id = new.application_id
       and not exists (select 1 from attendance att
                        where att.round_id = v_first_round
                          and att.application_id = new.application_id);
  end if;

  return new;
end;
$$;

create or replace function round_result_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student  uuid;
  v_company  text;
  v_sequence integer;
  v_out_of_placements boolean;
begin
  if new.result not in ('selected', 'rejected') then
    return new;  -- waitlisted / on_hold are interim states, not outcomes
  end if;
  if tg_op = 'UPDATE' and old.result = new.result then
    return new;  -- re-saving the same result is not news
  end if;

  select a.student_id, d.company_name, s.participation_status <> 'active'
    into v_student, v_company, v_out_of_placements
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select sequence into v_sequence from drive_rounds where id = new.round_id;

  if v_out_of_placements then
    return new;
  end if;

  if new.result = 'selected' then
    insert into notifications (student_id, kind, title, body)
    values (
      v_student,
      'round_cleared',
      'You cleared Round ' || v_sequence || ' of ' || v_company,
      'Well done — you advance from Round ' || v_sequence || ' of ' || v_company ||
      '. Soon you will get notified for round details. Please report on time.'
    );
  else
    insert into notifications (student_id, kind, title, body)
    values (
      v_student,
      'round_not_selected',
      'Round ' || v_sequence || ' of ' || v_company || ': not selected',
      'You were not selected in Round ' || v_sequence || ' of ' || v_company || '.'
    );
  end if;

  return new;
end;
$$;

create or replace function meeting_slot_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student  uuid;
  v_company  text;
  v_sequence integer;
  v_out_of_placements boolean;
begin
  if new.meeting_link is not distinct from old.meeting_link
     and new.participant_scheduled_at is not distinct from old.participant_scheduled_at then
    return new;
  end if;
  if new.meeting_link is null and new.participant_scheduled_at is null then
    return new;  -- clearing a slot is housekeeping, not news
  end if;

  select a.student_id, d.company_name, r.sequence,
         s.participation_status <> 'active'
    into v_student, v_company, v_sequence, v_out_of_placements
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
    join drive_rounds r on r.id = new.round_id
   where a.id = new.application_id;

  if v_out_of_placements then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (
    v_student,
    'meeting_link',
    v_company || ' — your Round ' || v_sequence || ' slot',
    'Your Round ' || v_sequence || ' of ' || v_company
      || case when new.participant_scheduled_at is not null
              then ' is at '
                || to_char(new.participant_scheduled_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
                || ' IST'
              else '' end
      || case when new.meeting_link is not null
              then '. Your meeting link: ' || new.meeting_link else '' end
      || '. Please report on time.'
  );

  return new;
end;
$$;

-- An offer on a held student. Most often this is the 'self_placed' hold doing
-- exactly what it says: the manager already knows about the offer, and the
-- student does not need the portal announcing it back to them.
create or replace function offer_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_out_of_placements boolean;
begin
  if new.source <> 'on_campus' then
    return new;
  end if;

  select participation_status <> 'active' into v_out_of_placements
    from students where id = new.student_id;
  if v_out_of_placements then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body, drive_id)
  values (
    new.student_id,
    'offer',
    'Offer from ' || new.company_name,
    case
      when new.offer_category = 'internship'
        then 'Congratulations — ' || new.company_name || ' has made you an internship offer.'
      when new.offer_category is not null
        then 'Congratulations — ' || new.company_name || ' has made you an offer ('
             || replace(new.offer_category::text, '_', ' ') || ').'
      else 'Congratulations — ' || new.company_name || ' has made you an offer.'
    end,
    new.drive_id
  );

  return new;
end;
$$;

create or replace function notify_absent_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student   uuid;
  v_company   text;
  v_round     text;
  v_out_of_placements boolean;
begin
  -- Fire only when a row BECOMES absent — re-saving an absent row is not
  -- a second absence, and neither is confirming a different status.
  if new.status <> 'absent' or (tg_op = 'UPDATE' and old.status = 'absent') then
    return new;
  end if;

  select a.student_id, d.company_name, s.participation_status <> 'active'
    into v_student, v_company, v_out_of_placements
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select coalesce(dr.name, 'Round ' || dr.sequence)
    into v_round
    from drive_rounds dr
   where dr.id = new.round_id;

  -- The application row is gone or unreadable: nothing to say, nobody to say
  -- it to. Never fail the attendance write over its own side effect.
  if v_student is null or v_out_of_placements then
    return new;
  end if;

  insert into notifications (student_id, kind, title, body)
  values (
    v_student,
    'absent',
    'Marked absent — ' || coalesce(v_company, 'a drive'),
    'You were marked absent for ' || coalesce(v_round, 'a round') || ' of the ' ||
    coalesce(v_company, 'drive') || ' drive. Absences across drives are counted ' ||
    'and repeated absence is reviewed. Contact your placement coordinator if ' ||
    'this is a mistake.'
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The shortlist write guard. The function keeps its 0043 name — renaming it
-- would mean dropping and recreating the trigger for a word — but it no longer
-- answers only to opt-out. A held student who can be shortlisted is scheduled
-- into Round 1 with no notice, which is the silent half-state this repo has
-- been closing all month.
-- ---------------------------------------------------------------------------
create or replace function shortlist_respects_opt_out() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  if new.included
     and (tg_op = 'INSERT' or old.included is distinct from new.included
          or old.opt_out_override_reason is distinct from new.opt_out_override_reason) then
    select participation_status::text into v_state
      from students s
      join applications a on a.student_id = s.id
     where a.id = new.application_id
       and s.participation_status <> 'active';

    if v_state is not null
       and (new.opt_out_override_reason is null
            or length(trim(new.opt_out_override_reason)) = 0) then
      raise exception
        'This student % and cannot be shortlisted. Overriding needs an explicit reason.',
        (case v_state
          when 'opted_out' then 'has opted out of placements'
          when 'on_hold'   then 'is on a hold placed by their college'
          else 'is ' || replace(v_state, '_', ' ')
        end)
      using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The apply gate. Same gates in the same order — the full body is restated
-- because CREATE OR REPLACE cannot patch a body, and 0119's header is the
-- record of why every one of them sits where it does. Only the participation
-- sentence changes: it used to guess, and it now says which of the three
-- states the student is actually in.
--
-- The three sentences match REFUSALS in src/features/student/apply-repository.ts
-- word for word, so the student's screen and the row-level refusal cannot
-- disagree.
-- ---------------------------------------------------------------------------
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
