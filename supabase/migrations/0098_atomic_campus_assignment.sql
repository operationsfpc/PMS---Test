-- 0098: Atomic campus assignment replacement
--
-- Problem: setCampuses() in staff-repository.ts deletes all assignments, then
-- inserts new ones. If the insert fails after the delete commits, the staff
-- member has no campuses at all. This is an admin operation, but leaving
-- someone with no campuses when the admin meant to reassign them is confusing.
--
-- Fix: a single function that does both in one transaction. Postgres guarantees
-- atomicity within a function, so either both succeed or neither does.

create or replace function set_staff_campus_assignments(
  p_profile_id uuid,
  p_campus_ids uuid[]
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from staff_campus_assignments where profile_id = p_profile_id;
  insert into staff_campus_assignments (profile_id, campus_id)
  select p_profile_id, unnest(p_campus_ids);
end;
$$;

create or replace function set_staff_campus_invitations(
  p_email text,
  p_campus_ids uuid[]
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from staff_campus_invitations where email = p_email;
  insert into staff_campus_invitations (email, campus_id)
  select p_email, unnest(p_campus_ids);
end;
$$;
