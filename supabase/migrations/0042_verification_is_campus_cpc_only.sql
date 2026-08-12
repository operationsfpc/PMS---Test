-- 0042 — Verification belongs to the campus placement coordinator alone (D3,
-- confirmed 2026-08-12).
--
-- "Certificate verification, student verification will only be done by the
-- campus placement coordinator. It will not be done by the Central PC."
--
-- The Central CPC (and the is_operator() umbrella generally) ran both queues
-- while the campus seat was empty. The seat is filled now, and the client
-- keeps it that way. Accepted consequence, recorded in the approved spec: if
-- the seat is ever empty, verification HALTS until an Admin fills it. That is
-- the client's stated preference over a quiet fallback that erodes the rule.

-- ------------------------------------------------- registration decisions
-- A trigger rather than a policy: the is_operator() write policy on students
-- covers many legitimate central-CPC writes (participation, disbarment), so
-- narrowing THE DECISION needs to name the decision, not the table.
create or replace function verification_is_campus_cpc_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Trusted server context (migrations, service role). Real coordinator
  -- requests always carry a JWT.
  if auth.uid() is null then
    return new;
  end if;

  if new.srf_status is distinct from old.srf_status
     and new.srf_status in ('srf_approved', 'srf_rejected')
     and current_app_role() is distinct from 'campus_placement_coordinator' then
    raise exception
      'Registration forms are verified by the campus placement coordinator.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger verification_is_campus_cpc_only
  before update on students
  for each row execute function verification_is_campus_cpc_only();

-- ---------------------------------------------------- certificate decisions
-- 0038 let operators decide org-wide. Now: the campus coordinator, for their
-- own campus's students, and nobody else. RLS is a filter, so a central CPC's
-- UPDATE simply matches nothing — same shape as every other refused write.
drop policy staff_decides_certificates on student_certificates;

create policy campus_cpc_decides_certificates
  on student_certificates for update
  using (
    current_app_role() = 'campus_placement_coordinator'
    and student_id in (select my_student_ids())
  )
  with check (
    current_app_role() = 'campus_placement_coordinator'
    and student_id in (select my_student_ids())
  );
