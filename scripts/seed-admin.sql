-- =============================================================================
-- Seed Admin: thanush@faceprep.in
-- Compatible with the New Schema (Consolidated Migrations 0001 - 0080)
-- Run this in the Supabase SQL Editor
-- =============================================================================

-- 1. Remove from student roster if present (enforces 0040 one_email_one_person rule)
delete from public.students 
where lower(btrim(email)) = 'thanush@faceprep.in';

-- 2. Seed into staff_invitations allowlist as Admin
insert into public.staff_invitations (email, full_name, role)
values ('thanush@faceprep.in', 'Thanush Krishna', 'admin')
on conflict (email) do update
  set role = 'admin',
      full_name = 'Thanush Krishna';

-- 3. If an auth.users record already exists for this email, sync directly to profiles
insert into public.profiles (id, email, full_name, role, is_active)
select 
  u.id,
  'thanush@faceprep.in',
  'Thanush Krishna',
  'admin'::public.app_role,
  true
from auth.users u
where lower(btrim(u.email)) = 'thanush@faceprep.in'
on conflict (id) do update
  set role = 'admin'::public.app_role,
      full_name = 'Thanush Krishna',
      is_active = true;

-- 4. Mark invitation as accepted if the profile exists
update public.staff_invitations
   set accepted_at = coalesce(accepted_at, now())
 where lower(btrim(email)) = 'thanush@faceprep.in'
   and exists (
     select 1 from public.profiles 
     where lower(btrim(email)) = 'thanush@faceprep.in'
   );
