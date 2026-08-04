-- An invitation must be actionable whenever it is written, not only when a
-- Google account happens to be created.
--
-- THE BUG THIS FIXES, observed in production 2026-08-04:
--   0009's accept_staff_invitation is AFTER INSERT ON auth.users. Google
--   sign-in inserts that row exactly once, ever. So for anyone who had already
--   signed in, a NEW invitation was inert: no profile was created, and
--   resolveAuthState finds neither a profile nor a student record, returns
--   signed-out, and bounces them back to /login with nothing to explain it.
--
--   0015 made this reachable. Removing a staff member deletes their profile and
--   invitation, but the browser cannot delete the auth.users row, so re-inviting
--   the same person produced an account that could never sign in again.
--
-- THE RULE, stated once: a staff invitation for an address that already has an
-- account is accepted immediately. Acceptance is idempotent and driven by the
-- invitation, which is the thing an Admin actually controls.
--
-- 0009's trigger stays: it covers the ordinary case where the invitation comes
-- first and the account second. The two are complementary and both idempotent.

create or replace function accept_invitation_for_existing_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  account_id uuid;
begin
  select id into account_id from auth.users where lower(email) = lower(new.email);

  -- The ordinary case: invited first, signs in later. 0009 handles that.
  if account_id is null then
    return new;
  end if;

  -- `do update` rather than `do nothing`: an existing profile on the old role
  -- is exactly the situation a re-invitation is meant to correct.
  insert into profiles (id, email, full_name, role)
  values (account_id, new.email, new.full_name, new.role)
  on conflict (id) do update
    set role      = excluded.role,
        full_name = excluded.full_name;

  insert into staff_campus_assignments (profile_id, campus_id)
  select account_id, sci.campus_id
    from staff_campus_invitations sci
   where lower(sci.email) = lower(new.email)
  on conflict do nothing;

  -- Only ever fires on `role`, so this write cannot re-enter the trigger.
  update staff_invitations
     set accepted_at = now()
   where email = new.email and accepted_at is null;

  return new;
end;
$$;

create trigger accept_invitation_for_existing_account
  after insert or update of role on staff_invitations
  for each row execute function accept_invitation_for_existing_account();
