-- 0131_hold_extension.sql
--
-- Extending a live hold's review date.
--
-- A hold's `ends_at` has been a review date since 0130 made it mandatory —
-- never a switch, never a release. But the dialog forces the manager to name
-- one at placement time, and a fee dispute that outlives the date it was
-- guessed at needs somewhere to go that is not "release it and place a new
-- one". Re-placing would close and reopen the same block, lose the audit
-- thread between the two rows, and — worse — flip participation_status off
-- and back on, which the notifier half of 0126 would read as two decisions.
--
-- So: one function that moves the date forward, by the same person who placed
-- the hold, under the same rules as 0125's place/release:
--
--   - Campus Manager only, and only at a college they sit on.
--   - The hold must be CONFIRMED and unreleased. A pending request is the
--     student's words, not a decision; extending one would mean nothing.
--   - The new date must fall strictly AFTER the current one. This is an
--     extension, not a second opinion about the old one — pulling a review
--     earlier is what Release is for, and the record should say which
--     happened.
--
-- There is no note parameter: `student_holds` has no column for one, the
-- reason the student is shown must stay the reason it was placed with, and
-- `audit_holds` (0125:265) already lands the actor and the new `ends_at` in
-- audit_log on this update. Inventing a place to store prose nobody reads is
-- how audit trails rot.

create or replace function extend_student_hold(
  p_hold_id uuid,
  p_ends_at date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid;
  h     student_holds;
begin
  select id into actor from profiles where id = auth.uid() and is_active;
  if actor is null then
    raise exception 'A hold is extended by a signed-in staff member.'
      using errcode = '42501';
  end if;

  if current_app_role() <> 'campus_manager' then
    raise exception 'Only a Campus Manager may extend a placement hold.'
      using errcode = '42501';
  end if;

  select * into h from student_holds where id = p_hold_id for update;

  if h.id is null then
    -- The same answer release gives a manager reading another college's id:
    -- not "no such hold", because the sentence would confirm it exists.
    raise exception 'No such hold.';
  end if;

  if not (h.student_id in (
        select s.id from students s where s.campus_id in (select my_campus_ids()))) then
    raise exception 'You may only extend a hold at a college you are assigned to.'
      using errcode = '42501';
  end if;

  if h.released_at is not null then
    raise exception 'This hold was already released on %.', h.released_at::date;
  end if;

  if h.confirmed_at is null then
    raise exception 'This request has not been confirmed, so there is no hold to extend.';
  end if;

  if p_ends_at is null then
    raise exception 'Say the review date the hold is extended to.';
  end if;

  if p_ends_at <= h.ends_at then
    raise exception 'The new review date must fall after the current one (%).', h.ends_at;
  end if;

  update student_holds
     set ends_at = p_ends_at
   where id = p_hold_id;

  return h.student_id;
end;
$$;

grant execute on function extend_student_hold to authenticated;
