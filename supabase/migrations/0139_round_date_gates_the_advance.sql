-- 0139: a round whose own date has not arrived cannot be advanced out of
--
-- 2026-11-06 ("advance to next rount should be only on time"): the Rounds &
-- results screen now refuses "Advance to Round N" until the round being LEFT
-- has passed its own date, in src/domain/round-timing.ts. A greyed button is a
-- courtesy — it can be clicked past by anything that calls the API directly,
-- and a stale tab in a second browser window does exactly that. This is the
-- same rule where it cannot be talked out of.
--
-- schedule_round_participants() is called by ONE thing: the advance
-- (rounds-repository.ts -> results-view.ts). It is told the round the students
-- ARRIVE in, so the round being left behind is the one before it on the same
-- drive — drive_rounds has `unique (drive_id, sequence)`, so there is at most
-- one.
--
-- Two rules the domain already keeps, kept here:
-- - A round with NO date is never blocked. Most drives were built before
--   `round_scheduled_at` (0053) existed, and an absent fact is not evidence.
-- - Round 1 has no predecessor, so the shortlist's automatic scheduling into
--   Round 1 (0043) is untouched.
--
-- Nothing else changes: the two inserts are the ones 0101 made atomic, in the
-- order they ran, with the same rows.

create or replace function schedule_round_participants(
  p_round_id uuid,
  p_application_ids uuid[],
  p_added_by uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  -- The refusal, already in the words the coordinator would have read on
  -- screen. Null when nothing is holding the advance back.
  v_hold text;
begin
  select
    format(
      'Round %s (%s) is scheduled for %s and has not been held yet — advance it once that time has passed.',
      prior.sequence,
      prior.name,
      to_char(
        prior.round_scheduled_at at time zone 'Asia/Kolkata',
        'DD Mon YYYY, FMHH12:MI AM'
      )
    )
    into v_hold
  from drive_rounds target
  join drive_rounds prior
    on prior.drive_id = target.drive_id
   and prior.sequence = target.sequence - 1
  where target.id = p_round_id
    and prior.round_scheduled_at is not null
    and prior.round_scheduled_at > now();

  if v_hold is not null then
    raise exception '%', v_hold using errcode = 'check_violation';
  end if;

  insert into round_participants (round_id, application_id, added_by)
  select p_round_id, unnest(p_application_ids), p_added_by;

  insert into attendance (round_id, application_id, status)
  select p_round_id, unnest(p_application_ids), 'scheduled'::attendance_status;
end;
$$;
