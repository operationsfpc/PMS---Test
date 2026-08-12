-- Approving a registration form also confirms the certificates that came with
-- it. Asked for 2026-08-06, after A37 was put to the client:
--
--   "make approving the registration form also confirm the certificates that
--    came with it, and keep the standing queue for later uploads."
--
-- This SUPERSEDES half of A37. 0038 made every certificate a separate
-- decision, so a coordinator processing a new student did two jobs: approve
-- the form, then work through that student's certificates one at a time. The
-- initial batch now rides along with the approval, exactly as the semester
-- lines have since 0031. Anything uploaded afterwards still lands `pending`
-- and still goes to /cpc/certificates - that is the "standing queue" half,
-- and it is what makes a certificate earned in the final semester verifiable
-- at all.
--
-- 🔴 THE CONDITION THIS DEPENDS ON, stated because it is the whole risk:
-- approval may only verify these rows because the verification queue now puts
-- each certificate NEXT TO ITS DOCUMENT, the way it already does for semester
-- marksheets. That screen change ships WITH this migration, not after it.
-- Without it, one click would certify files the coordinator was never shown -
-- which is precisely the hole that made semester verification meaningless
-- before 0023, and the reason this was pushed back on before being built.
--
-- Deliberately NOT swept up:
--   * a certificate already REJECTED - a coordinator looked at it and refused
--     it, and an approval elsewhere on the form must not quietly reverse that
--   * a certificate already VERIFIED - nothing to do, and re-stamping it would
--     rewrite who checked it
--   * anybody else's certificates
--
-- Modelled on verify_semesters_on_srf_approval (0031), including SECURITY
-- DEFINER and for the same reason: `staff_decides_certificates` scopes a
-- coordinator to their own campus via my_student_ids(), and this runs inside
-- their own UPDATE on a student they have already been allowed to decide.
-- Leaving it INVOKER would make approval depend on a second, differently
-- shaped permission check passing at the same instant. The trigger only ever
-- touches certificates belonging to the row being approved.

create or replace function verify_certificates_on_srf_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.srf_status = 'srf_approved' and old.srf_status is distinct from 'srf_approved' then
    update student_certificates
       set status      = 'verified',
           -- `certificate_verified_has_verifier` (0038) insists a verified
           -- certificate names who verified it. The decider is the
           -- coordinator who just approved; falling back to the caller covers
           -- a correction made directly rather than through the queue.
           verified_by = coalesce(new.srf_decided_by, auth.uid()),
           verified_at = coalesce(new.srf_decided_at, now())
     where student_id = new.id
       and status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists verify_certificates_on_srf_approval on students;

create trigger verify_certificates_on_srf_approval
  after update on students
  for each row execute function verify_certificates_on_srf_approval();

-- No backfill. Production holds zero certificates (checked before 0038
-- shipped), so there is nothing to sweep up - and retro-verifying a
-- certificate on a coordinator's behalf would assert they had checked a
-- document they were never shown, which is the one thing this migration's
-- comment above refuses to do.

comment on function verify_certificates_on_srf_approval is
  'Approving an SRF confirms the certificates submitted with it (2026-08-06). Later uploads stay pending for /cpc/certificates.';
