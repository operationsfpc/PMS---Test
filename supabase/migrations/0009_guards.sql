-- Guards that RLS cannot express: login allowlist, field locking, irreversibility.

-- Login is restricted to addresses already on the roster or on staff.
-- A Google sign-in with any other Gmail address is refused at the database.
create or replace function enforce_login_allowlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- A student on the college roster, or a staff member an Admin invited.
  if exists (select 1 from students where lower(email) = lower(new.email))
     or exists (select 1 from staff_invitations where lower(email) = lower(new.email)) then
    return new;
  end if;
  raise exception
    'Address % is not registered. Ask your placement coordinator for an invitation.',
    new.email
    using errcode = 'check_violation';
end;
$$;

create trigger enforce_login_allowlist
  before insert on auth.users
  for each row execute function enforce_login_allowlist();

-- Binds the claimed account to the rostered student record.
create or replace function claim_student_record() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update students
     set auth_user_id = new.id,
         srf_status = case when srf_status = 'invited' then 'registered' else srf_status end
   where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end;
$$;

create trigger claim_student_record
  after insert on auth.users
  for each row execute function claim_student_record();

-- Materialises the staff profile from the invitation on first sign-in.
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

  update staff_invitations set accepted_at = now() where email = invite.email;
  return new;
end;
$$;

create trigger accept_staff_invitation
  after insert on auth.users
  for each row execute function accept_staff_invitation();

-- Decision Q4: students may never change verified academic data.
-- Coordinators may, directly and instantly; the change is audit-logged.
create or replace function protect_verified_academics() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- FAIL CLOSED. Students have no `profiles` row, so role lookup returns NULL
  -- for them; keying the guard off the role would let every student through.
  -- Identify the actor positively instead.

  -- Trusted server context (migrations, service role, admin tooling). Student
  -- requests always carry a JWT, and RLS already blocks anonymous writes.
  if auth.uid() is null then
    return new;
  end if;

  -- Staff: not linked to any student record.
  if not exists (select 1 from students where auth_user_id = auth.uid()) then
    return new;
  end if;

  if new.tenth_percentage   is distinct from old.tenth_percentage
  or new.twelfth_percentage is distinct from old.twelfth_percentage
  or new.overall_cgpa       is distinct from old.overall_cgpa
  or new.current_arrears    is distinct from old.current_arrears
  or new.history_of_arrears is distinct from old.history_of_arrears
  or new.degree_id          is distinct from old.degree_id
  or new.branch_id          is distinct from old.branch_id
  or new.roll_number        is distinct from old.roll_number
  or new.srf_status         is distinct from old.srf_status
  or new.participation_status is distinct from old.participation_status then
    raise exception 'Verified academic data can only be changed by a placement coordinator'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger protect_verified_academics
  before update on students
  for each row execute function protect_verified_academics();

-- PRD 6.1: a rejected PIF is closed permanently. A fresh PIF must be raised.
create or replace function enforce_drive_transitions() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'A rejected PIF is final and cannot be reopened. Raise a fresh PIF.'
      using errcode = 'check_violation';
  end if;

  -- An on-hold drive can never be published (decision Q4 on holds).
  if new.status = 'live' and new.on_hold then
    raise exception 'A drive on hold cannot be published.'
      using errcode = 'check_violation';
  end if;

  -- offer_category is the Delivery Head's decision and is final once approved.
  if old.status not in ('draft', 'submitted')
     and old.offer_category is not null
     and new.offer_category is distinct from old.offer_category then
    raise exception 'Offer category is set by the Delivery Head and cannot be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger enforce_drive_transitions
  before update on drives
  for each row execute function enforce_drive_transitions();

-- PRD 16.1: opting out is irreversible.
create or replace function enforce_opt_out_irreversible() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.participation_status = 'opted_out' and new.participation_status <> 'opted_out' then
    raise exception 'Opting out is irreversible; the student cannot rejoin placements.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_opt_out_irreversible
  before update on students
  for each row execute function enforce_opt_out_irreversible();
