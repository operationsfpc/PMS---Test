-- 0101: Atomic participant scheduling with attendance rows
--
-- Problem: scheduleParticipants() in rounds-repository.ts inserts into
-- round_participants first, then into attendance. If the attendance insert
-- fails (network error, constraint violation), participants are scheduled but
-- have no attendance rows - they cannot be marked present or absent.
--
-- Fix: a single function that does both inserts in one transaction. Either
-- both succeed or neither does.

create or replace function schedule_round_participants(
  p_round_id uuid,
  p_application_ids uuid[],
  p_added_by uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into round_participants (round_id, application_id, added_by)
  select p_round_id, unnest(p_application_ids), p_added_by;

  insert into attendance (round_id, application_id, status)
  select p_round_id, unnest(p_application_ids), 'scheduled'::attendance_status;
end;
$$;
