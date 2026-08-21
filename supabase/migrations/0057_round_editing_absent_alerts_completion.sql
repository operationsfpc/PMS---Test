-- 0057 — 21/08 batches B & C (mockups M1–M3 approved):
--
-- B2: the Central CPC may rename or REMOVE a drive's rounds — companies
--     eliminate rounds mid-drive. But a round with any recorded fact
--     (scheduled students, attendance, results) is history, and history
--     does not get edited: the 0055 freeze principle, extended to a
--     round's name and existence. Mirrors src/domain/round-editing.ts;
--     change both or neither.
--
-- C6: a student marked ABSENT hears about it the moment it is recorded —
--     the 0043 in-app notification pattern. Opted-out students get nothing
--     (D7), same as every other notification.
--
-- C3 (answer 3b): completing a drive early demands a typed reason; it
--     lives on the row so the audit log and the drive record both carry it.

-- ------------------------------------------ C3: the early-completion reason

alter table drives add column if not exists completed_reason text;

comment on column drives.completed_reason is
  'Why the Central CPC completed the drive before every applicant had a '
  'final outcome. NULL on a drive that completed in the ordinary way.';

-- --------------------------------------- B2: rename/remove freeze trigger

create or replace function enforce_round_editing() returns trigger
language plpgsql set search_path = public as $$
declare
  v_round_id uuid;
  v_freeze   text;
begin
  v_round_id := coalesce(old.id, new.id);

  -- Only a NAME change or a DELETE is judged here. 0055 already freezes the
  -- logistics (venue/link/schedule) at the first recorded fact; sequence
  -- renumbering after a removal must stay possible, and 0055's rule already
  -- governs everything else worth protecting.
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then
    return new;
  end if;

  select case
           when exists (select 1 from round_results r where r.round_id = v_round_id)
             then 'results are recorded in this round'
           when exists (select 1 from attendance a
                         where a.round_id = v_round_id and a.status <> 'scheduled')
             then 'attendance is recorded in this round'
           when exists (select 1 from round_participants p where p.round_id = v_round_id)
             then 'students are scheduled into this round'
         end
    into v_freeze;

  if v_freeze is not null then
    if tg_op = 'DELETE' then
      raise exception 'This round cannot be removed — %.', v_freeze
        using errcode = 'check_violation';
    end if;
    raise exception 'This round cannot be renamed — %.', v_freeze
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger enforce_round_editing_update
  before update on drive_rounds
  for each row execute function enforce_round_editing();

create trigger enforce_round_editing_delete
  before delete on drive_rounds
  for each row execute function enforce_round_editing();

-- ------------------------------------------------- C6: the absent alert

create or replace function notify_absent_student() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_student   uuid;
  v_company   text;
  v_round     text;
  v_opted_out boolean;
begin
  -- Fire only when a row BECOMES absent — re-saving an absent row is not
  -- a second absence, and neither is confirming a different status.
  if new.status <> 'absent' or (tg_op = 'UPDATE' and old.status = 'absent') then
    return new;
  end if;

  select a.student_id, d.company_name, s.participation_status = 'opted_out'
    into v_student, v_company, v_opted_out
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
  if v_student is null or v_opted_out then
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

create trigger notify_absent_student
  after insert or update on attendance
  for each row execute function notify_absent_student();
