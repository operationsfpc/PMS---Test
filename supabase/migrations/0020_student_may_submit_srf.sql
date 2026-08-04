-- The registration form could never be submitted.
--
-- Reported from UAT 2026-08-05: "the student registration form is still not
-- getting submitted successfully". It never could, since 0009.
--
-- protect_verified_academics refuses ANY student change to tenth_percentage,
-- twelfth_percentage or srf_status. The SRF writes all three in one statement,
-- so every submission raised 'Verified academic data can only be changed by a
-- placement coordinator' and the student saw a generic failure.
--
-- The guard is still exactly right in intent (decision Q4): a student must
-- never be able to edit marks a coordinator has checked, and must never be
-- able to approve themselves. It was simply drawn one step too wide, because
-- it never distinguished DECLARING marks from CHANGING VERIFIED ones.
--
-- The line this migration draws:
--
--   before verification  - the student's own declaration. They typed these
--                          figures; nobody has checked them; they may correct
--                          them and send the form in.
--   after  srf_approved  - the coordinator's data. Locked, because every
--                          eligibility decision has already been made against
--                          it (R5 reads the latest VERIFIED semester, but the
--                          A28 fallback still reads these columns).
--
-- srf_status stays the coordinator's in every direction but one: a student may
-- move their OWN form to 'srf_submitted', and only from a state that has not
-- been approved. They can never write 'srf_approved' or 'srf_rejected'.

create or replace function protect_verified_academics() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_student boolean;
begin
  -- FAIL CLOSED. Students have no `profiles` row, so a role lookup returns
  -- NULL for them; keying the guard off the role would let every student
  -- through. Identify the actor positively instead.

  -- Trusted server context (migrations, service role, admin tooling). Student
  -- requests always carry a JWT, and RLS already blocks anonymous writes.
  if auth.uid() is null then
    return new;
  end if;

  is_student := exists (select 1 from students where auth_user_id = auth.uid());

  -- Staff: not linked to any student record.
  if not is_student then
    return new;
  end if;

  -- ---------------------------------------------------------------- status
  -- The one transition a student owns: sending their own form for checking.
  -- Everything else about srf_status remains the coordinator's.
  if new.srf_status is distinct from old.srf_status then
    if not (
      new.srf_status = 'srf_submitted'
      and old.srf_status in ('invited', 'registered', 'srf_rejected')
    ) then
      raise exception 'Verified academic data can only be changed by a placement coordinator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ----------------------------------------------------------------- marks
  -- Their own declaration until it is approved, and never afterwards.
  if old.srf_status = 'srf_approved' then
    if new.tenth_percentage   is distinct from old.tenth_percentage
    or new.twelfth_percentage is distinct from old.twelfth_percentage then
      raise exception 'Verified academic data can only be changed by a placement coordinator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- --------------------------------------------------- never the student's
  -- Identity and standing come from the roster and from verification, never
  -- from the form. overall_cgpa and the arrear columns are the coordinator's
  -- figures: the student declares theirs per semester, in student_semesters,
  -- where an unverified line can never decide eligibility.
  if new.overall_cgpa       is distinct from old.overall_cgpa
  or new.current_arrears    is distinct from old.current_arrears
  or new.history_of_arrears is distinct from old.history_of_arrears
  or new.degree_id          is distinct from old.degree_id
  or new.branch_id          is distinct from old.branch_id
  or new.roll_number        is distinct from old.roll_number
  or new.participation_status is distinct from old.participation_status then
    raise exception 'Verified academic data can only be changed by a placement coordinator'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;
