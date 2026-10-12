-- 0099: Atomic round removal with renumbering
--
-- Problem: removeRound() in results-view.ts reads all rounds, deletes one,
-- then renumbers the rest sequentially. Two coordinators removing rounds at
-- the same time both read the same list, both delete, both renumber based on
-- stale data - the second renumbering can violate the unique constraint on
-- (drive_id, sequence) or produce gaps.
--
-- Fix: a single function that deletes and renumbers in one transaction. The
-- renumbering uses a window function to assign new sequences based on the
-- post-delete state, so it is always correct.

create or replace function remove_drive_round(p_round_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_drive_id uuid;
begin
  select drive_id into v_drive_id from drive_rounds where id = p_round_id;
  if v_drive_id is null then
    raise exception 'Round not found';
  end if;

  delete from drive_rounds where id = p_round_id;

  update drive_rounds
  set sequence = new_seq
  from (
    select id, row_number() over (order by sequence) as new_seq
    from drive_rounds
    where drive_id = v_drive_id
  ) as renumbered
  where drive_rounds.id = renumbered.id
    and drive_rounds.sequence <> renumbered.new_seq;
end;
$$;
