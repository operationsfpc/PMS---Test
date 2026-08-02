-- Campus assignments chosen at invitation time.
--
-- staff_campus_assignments references profiles(id), but a profile does not
-- exist until the invitee first signs in - 0009's accept_staff_invitation
-- materialises it. So an Admin who picks campuses while inviting has nowhere
-- to put them. They are staged against the invited email here and applied by
-- the same trigger.
--
-- Without this, a CPC signs in successfully, is scoped to no campus, and sees
-- an application with nothing in it.

create table staff_campus_invitations (
  email      text not null,
  campus_id  uuid not null references campuses(id) on delete cascade,
  primary key (email, campus_id)
);

alter table staff_campus_invitations enable row level security;

create policy read_staff_campus_invitations
  on staff_campus_invitations for select using (is_admin());

create policy write_staff_campus_invitations
  on staff_campus_invitations for all using (is_admin()) with check (is_admin());

grant select, insert, update on staff_campus_invitations to authenticated;

-- Extends 0009's trigger. Redefined in full rather than patched, so the whole
-- behaviour is readable in one place.
create or replace function accept_staff_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  invite staff_invitations%rowtype;
begin
  select * into invite from staff_invitations where lower(email) = lower(new.email);
  if not found then
    return new;
  end if;

  insert into profiles (id, email, full_name, role)
  values (new.id, invite.email, invite.full_name, invite.role)
  on conflict (id) do nothing;

  -- Apply whatever campuses the Admin staged at invitation time.
  insert into staff_campus_assignments (profile_id, campus_id)
  select new.id, sci.campus_id
    from staff_campus_invitations sci
   where lower(sci.email) = lower(new.email)
  on conflict do nothing;

  update staff_invitations set accepted_at = now() where email = invite.email;
  return new;
end;
$$;
