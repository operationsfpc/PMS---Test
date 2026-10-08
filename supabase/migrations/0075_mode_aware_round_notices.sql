-- 0075_mode_aware_round_notices.sql
--
-- 1. Mode-aware round notifications:
--    - When mode is virtual, include interview link (if provided).
--    - When mode is physical (on_campus or physical_outside_campus), include venue (if provided).
--    - Never show interview links on physical rounds.
--    - Notify when venue changes.
--    - Append standardized "Please report on time."
--
-- 2. Shortlist & Round Cleared notifications:
--    - Clarify round data and next steps: "Soon you will get notified for round details. Please report on time."
--
-- 3. Individual meeting slots:
--    - Append "Please report on time."

-- 1. round_details_reach_students
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
     and s.participation_status <> 'opted_out';

  return new;
end;
$$;

drop trigger if exists round_details_reach_students on drive_rounds;
create trigger round_details_reach_students
  after update on drive_rounds
  for each row execute function round_details_reach_students();

-- 2. shortlist_reaches_student
create or replace function shortlist_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first_round uuid;
  v_company     text;
  v_student     uuid;
  v_opted_out   boolean;
begin
  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted_out
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

    -- D7: an opted-out student gets NO notification, overridden or not.
    if not v_opted_out then
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

drop trigger if exists shortlist_reaches_student on shortlist_entries;
create trigger shortlist_reaches_student
  after insert or update on shortlist_entries
  for each row execute function shortlist_reaches_student();

-- 3. round_result_reaches_student
create or replace function round_result_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student  uuid;
  v_company  text;
  v_sequence integer;
  v_opted    boolean;
begin
  if new.result not in ('selected', 'rejected') then
    return new;  -- waitlisted / on_hold are interim states, not outcomes
  end if;
  if tg_op = 'UPDATE' and old.result = new.result then
    return new;  -- re-saving the same result is not news
  end if;

  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
   where a.id = new.application_id;

  select sequence into v_sequence from drive_rounds where id = new.round_id;

  if v_opted then
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

drop trigger if exists round_result_reaches_student on round_results;
create trigger round_result_reaches_student
  after insert or update on round_results
  for each row execute function round_result_reaches_student();

-- 4. meeting_slot_reaches_student
create or replace function meeting_slot_reaches_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student  uuid;
  v_company  text;
  v_sequence integer;
  v_opted    boolean;
begin
  if new.meeting_link is not distinct from old.meeting_link
     and new.participant_scheduled_at is not distinct from old.participant_scheduled_at then
    return new;
  end if;
  if new.meeting_link is null and new.participant_scheduled_at is null then
    return new;  -- clearing a slot is housekeeping, not news
  end if;

  select a.student_id, d.company_name, r.sequence,
         s.participation_status = 'opted_out'
    into v_student, v_company, v_sequence, v_opted
    from applications a
    join drives d on d.id = a.drive_id
    join students s on s.id = a.student_id
    join drive_rounds r on r.id = new.round_id
   where a.id = new.application_id;

  if v_opted then
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

drop trigger if exists meeting_slot_reaches_student on round_participants;
create trigger meeting_slot_reaches_student
  after update on round_participants
  for each row execute function meeting_slot_reaches_student();

