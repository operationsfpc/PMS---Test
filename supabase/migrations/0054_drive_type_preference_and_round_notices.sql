-- 0054 — UAT 2026-08-19:
--
-- D1: the student's DRIVE TYPE preference (placement / internship /
--     internship-convertible). A preference, not a sanction — it sits BELOW
--     R5a's override in the apply gate, exactly where the role-category area
--     sits, and an empty list means "no opinion", never "nothing".
--     Q6: no approval needed — the student changes it and new drives follow;
--     old applications carry their apply-time snapshot (R7) and never move.
--
-- F6: a round's schedule reaches its participants, and a per-student meeting
--     link reaches THAT student — in-app notifications, the 0043 pattern.

-- ------------------------------------------------------ D1: the preference

alter table students
  add column if not exists drive_type_preferences drive_type[] not null default '{}';

-- The gate, rebuilt from 0050 with ONE new preference block. The full
-- function is restated because CREATE OR REPLACE cannot patch a body.
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

-- --------------------------------------------- F6: the schedule notifies

-- The round's own details changed: every participating student hears, with
-- the mode, the time (IST) and the shared link when one exists. Security
-- definer, like every notifying trigger since 0043.
create or replace function round_details_reach_students() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company text;
  v_body    text;
begin
  if new.round_mode is not distinct from old.round_mode
     and new.round_scheduled_at is not distinct from old.round_scheduled_at
     and new.round_interview_link is not distinct from old.round_interview_link then
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
    || case when new.round_interview_link is not null
            then '. Join at: ' || new.round_interview_link else '' end
    || '.';

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

-- A per-student slot: that student alone hears, with THEIR link.
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
      || '.'
  );

  return new;
end;
$$;

drop trigger if exists meeting_slot_reaches_student on round_participants;
create trigger meeting_slot_reaches_student
  after update on round_participants
  for each row execute function meeting_slot_reaches_student();
