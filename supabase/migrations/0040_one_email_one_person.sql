-- One email identifies one person. Asked for 2026-08-06:
-- "can you block an email id from being entered twice? student + student as
--  well as student+staff"
--
-- This is P8's ROOT CAUSE, not a tidiness rule. `sainaveen@faceprep.in` was on
-- the student roster AND held a staff profile, on one Google account. Everyone
-- signs in with their address, so that is one identity wearing two hats, and
-- `protect_verified_academics` (0009) identifies a student by exactly that
-- address. The result: the only campus placement coordinator could not approve
-- ANY registration form, and had the certificate feature been used by them,
-- they could have verified their own.
--
-- Two separate gaps are closed here.
--
--   1. student-vs-student was already `unique` (0003) but CASE-SENSITIVE, so
--      `Priya@gmail.com` and `priya@gmail.com` were two different people to
--      Postgres and one person to Google. Same for profiles and invitations.
--   2. student-vs-staff was not checked anywhere at all.
--
-- 🔴 A staff INVITATION and the PROFILE it becomes are ONE person, not two.
-- That pair is the normal state of every staff member - all six in production
-- have it - so the cross-table rule deliberately compares students against
-- staff, and never staff against staff.
--
-- Checked against production before writing this: 0 non-canonical addresses,
-- 0 case-duplicates in any of the three tables, 0 student/staff overlap. So
-- there is nothing to backfill and no existing row these constraints break.

-- ---------------------------------------------------------------------------
-- 1. Canonical storage. Identity is the normalised address, so that is what
--    gets stored - otherwise the row read back differs from the row matched.
-- ---------------------------------------------------------------------------
create or replace function normalise_email() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

create trigger normalise_student_email
  before insert or update of email on students
  for each row execute function normalise_email();

create trigger normalise_profile_email
  before insert or update of email on profiles
  for each row execute function normalise_email();

create trigger normalise_invitation_email
  before insert or update of email on staff_invitations
  for each row execute function normalise_email();

-- ---------------------------------------------------------------------------
-- 2. Case-insensitive uniqueness within each table.
--
--    The existing `unique` columns stay: they are a subset of these, and
--    dropping a constraint to replace it with a weaker-looking index is how
--    a window gets left open during a migration.
-- ---------------------------------------------------------------------------
create unique index one_person_per_email_students    on students           (lower(btrim(email)));
create unique index one_person_per_email_profiles    on profiles           (lower(btrim(email)));
create unique index one_person_per_email_invitations on staff_invitations  (lower(btrim(email)));

-- ---------------------------------------------------------------------------
-- 3. A student and a staff member are different people.
--
--    Postgres cannot express this as a constraint - it spans tables - so it is
--    a trigger on each side. Both raise `unique_violation` (23505) so the
--    application layer can treat it exactly like any other duplicate.
-- ---------------------------------------------------------------------------
create or replace function refuse_staff_email_for_student() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from profiles p where lower(btrim(p.email)) = new.email)
     or exists (select 1 from staff_invitations i where lower(btrim(i.email)) = new.email)
  then
    raise exception
      '% is already a staff account. One person is either a student or staff, never both.', new.email
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

create or replace function refuse_student_email_for_staff() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from students s where lower(btrim(s.email)) = new.email) then
    raise exception
      '% is already on the student roster. One person is either a student or staff, never both.', new.email
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

-- AFTER the normalising trigger, so `new.email` is already canonical when
-- compared. Trigger order within the same timing is alphabetical, and
-- `normalise_*` sorts before `refuse_*` on every one of these tables - stated
-- because it is load-bearing and silent if it ever stops being true.
create trigger refuse_staff_email_for_student
  before insert or update of email on students
  for each row execute function refuse_staff_email_for_student();

create trigger refuse_student_email_for_staff_profile
  before insert or update of email on profiles
  for each row execute function refuse_student_email_for_staff();

create trigger refuse_student_email_for_staff_invitation
  before insert or update of email on staff_invitations
  for each row execute function refuse_student_email_for_staff();

comment on function refuse_staff_email_for_student is
  'P8 root cause (2026-08-06): one address is one identity, because sign-in is by address.';
