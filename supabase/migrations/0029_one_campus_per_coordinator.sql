-- A Campus Placement Coordinator is mapped to ONE campus.
--
-- Confirmed 2026-08-05: "remember that a placement coordinator is for one
-- campus alone. this has to be mapped by admin while mapping their role."
--
-- This mapping is not a label on a screen. It is the whole of a coordinator's
-- authority: `my_student_ids()` reads this table to decide whose marksheets
-- they may verify and whose registration they may approve. A second row
-- silently widens that over students who belong to another coordinator, and
-- nothing anywhere would report it.
--
-- The rule lives in `src/domain/staff.ts` and the admin screen applies it. It
-- is enforced here as well because the screen is not the only thing that can
-- write to this table - a roster fix-up, an import, or a feature written next
-- year can too, and none of them will remember this conversation.
--
-- Campus Managers and Key Account Managers genuinely span campuses, so the
-- rule is deliberately scoped to the coordinator alone.

create or replace function enforce_one_campus_per_coordinator() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select role from profiles where id = new.profile_id) = 'campus_placement_coordinator'
     and exists (
       select 1 from staff_campus_assignments
        where profile_id = new.profile_id
          and campus_id is distinct from new.campus_id
     )
  then
    raise exception
      'A placement coordinator works with one campus. Move them instead of adding a second.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- BEFORE INSERT OR UPDATE: moving a coordinator is legitimate and must keep
-- working - delete the old row, insert the new one - so only a SECOND
-- concurrent campus is refused, never a change of campus.
drop trigger if exists enforce_one_campus_per_coordinator on staff_campus_assignments;

create trigger enforce_one_campus_per_coordinator
  before insert or update on staff_campus_assignments
  for each row execute function enforce_one_campus_per_coordinator();
