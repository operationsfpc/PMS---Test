-- =============================================================================
-- Seed Admin: thanush@faceprep.in
-- Run this in the Supabase SQL Editor
-- =============================================================================

-- 1. Ensure email is not on the student roster (due to one_email_one_person rule in 0040)
delete from public.students where lower(email) = 'thanush@faceprep.in';

-- 2. Add to staff invitations allowlist as admin
insert into public.staff_invitations (email, full_name, role, accepted_at)
values (
  'thanush@faceprep.in',
  'Thanush Krishna',
  'admin',
  case when exists (select 1 from auth.users where lower(email) = 'thanush@faceprep.in') then now() else null end
)
on conflict (email) do update
  set role = 'admin',
      full_name = 'Thanush Krishna';

-- 3. If an auth.users record already exists for this email, sync to profiles directly
insert into public.profiles (id, email, full_name, role, is_active)
select 
  u.id,
  'thanush@faceprep.in',
  'Thanush Krishna',
  'admin'::app_role,
  true
from auth.users u
where lower(u.email) = 'thanush@faceprep.in'
on conflict (id) do update
  set role = 'admin'::app_role,
      full_name = 'Thanush Krishna',
      is_active = true;

-- 4. Mark the invitation accepted if the profile exists
update public.staff_invitations
   set accepted_at = now()
 where lower(email) = 'thanush@faceprep.in'
   and exists (select 1 from public.profiles where lower(email) = 'thanush@faceprep.in');
