-- 0100: Atomic batch attendance save
--
-- Problem: attendance-page.tsx saves attendance one student at a time in a
-- loop. If the network fails partway through, some students have attendance
-- recorded and others don't. The error message says "Some entries may not
-- have been recorded" but the coordinator has no way to know which ones.
--
-- Fix: a single function that takes an array of (application_id, status) pairs
-- and updates them all in one transaction. Either all succeed or none do.

create or replace function save_batch_attendance(
  p_round_id uuid,
  p_entries jsonb,
  p_marked_by uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  -- Each entry is {"applicationId": "...", "status": "..."}
  update attendance a
  set status = (entry->>'status')::attendance_status,
      marked_by = p_marked_by,
      marked_at = now()
  from jsonb_array_elements(p_entries) as entry
  where a.round_id = p_round_id
    and a.application_id = (entry->>'applicationId')::uuid;
end;
$$;
